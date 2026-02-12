import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SupabaseService } from "../database/supabase.service";
import { RedisService } from "../redis/redis.service";
import { OpenAIService } from "../openai/openai.service";
import { ChatAiService } from "./chat-ai.service";
import { SentimentService, RelationshipState } from "./sentiment.service";
import { RelationshipService } from "./relationship.service";
import { MemoryService } from "./memory.service";
import { ChatGateway } from "./chat.gateway";
import { SendMessageDto } from "./dto/send-message.dto";
import { ChatDeliveryJobData } from "./chat-delivery.processor";

interface Teacher {
  id: string;
  name: string;
  bio: string | null;
  persona_prompt: string | null;
  specialization: string[] | null;
  emotional_range: Record<string, string> | null;
  profile_image_url: string | null;
}

interface ConversationMemory {
  summary: string;
  messages_summarized: number;
  last_summarized_message_id: string | null;
  factual_memory: string;
  emotional_memory: string;
  student_profile: Record<string, unknown>;
}

interface RelationshipEvent {
  event_type: string;
  summary: string;
  emotional_valence: number;
  created_at: string;
}

const CHAT_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "chat_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["messages"],
      additionalProperties: false,
    },
  },
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    private readonly openai: OpenAIService,
    private readonly chatAiService: ChatAiService,
    private readonly sentimentService: SentimentService,
    private readonly relationshipService: RelationshipService,
    private readonly memoryService: MemoryService,
    private readonly chatGateway: ChatGateway,
    @InjectQueue("chat-delivery") private readonly chatDeliveryQueue: Queue,
  ) {}

  /**
   * Process a user message: save to DB, emit via Socket.IO, trigger background AI.
   * Returns immediately after saving the user message.
   */
  async processMessage(
    dto: SendMessageDto,
    userId: string,
  ): Promise<{ userMessage: any }> {
    const { chat_room_id: chatRoomId, content } = dto;

    // 1. Save user message to DB
    const { data: userMessage, error } = await this.supabase.client
      .from("chat_messages")
      .insert({
        chat_room_id: chatRoomId,
        sender_type: "user",
        sender_id: userId,
        content: content,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to save user message: ${error.message}`);
      throw new Error(`Failed to save message: ${error.message}`);
    }

    // 2. Update last_message_at
    await this.supabase.client
      .from("chat_rooms")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", chatRoomId);

    // 4. Trigger background AI processing (no await — fire and forget)
    this.processAiResponse(chatRoomId, userId).catch((err) => {
      this.logger.error(
        `AI processing failed for room ${chatRoomId}: ${err.message}`,
      );
    });

    // 5. Return immediately
    return { userMessage };
  }

  /**
   * Background AI response processing.
   * Acquires lock, debounces, calls AI, schedules BullMQ delayed jobs.
   */
  private async processAiResponse(
    chatRoomId: string,
    userId: string,
  ): Promise<void> {
    const lockKey = `chat_lock:${chatRoomId}`;

    // 1. Acquire distributed lock
    const acquired = await this.redis.acquireLock(lockKey, 60);
    if (!acquired) {
      this.logger.log(`Already processing chat room ${chatRoomId}`);
      return;
    }

    try {
      await this.processChatRoom(chatRoomId, userId);
    } catch (error) {
      this.logger.error(`Error processing chat room: ${error}`);
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  private async processChatRoom(
    chatRoomId: string,
    userId: string,
  ): Promise<void> {
    // 2. Get chat room info
    const { data: chatRoom, error: roomError } = await this.supabase.client
      .from("chat_rooms")
      .select("id, teacher_id, user_id")
      .eq("id", chatRoomId)
      .single();

    if (roomError || !chatRoom) {
      this.logger.error(`Chat room not found: ${chatRoomId}`);
      return;
    }

    const { teacher_id: teacherId } = chatRoom;

    // 3. Server-side debounce (5-second window)
    while (true) {
      await this.sleep(5000);

      const { data: latest } = await this.supabase.client
        .from("chat_messages")
        .select("created_at")
        .eq("chat_room_id", chatRoomId)
        .eq("sender_type", "user")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!latest) break;

      const latestAt = new Date(latest.created_at);
      const fiveSecondsAgo = new Date(Date.now() - 5000);

      if (latestAt > fiveSecondsAgo) {
        continue;
      }
      break;
    }

    // 4. Find unresponded user messages (after last AI/teacher message)
    const { data: lastAi } = await this.supabase.client
      .from("chat_messages")
      .select("created_at")
      .eq("chat_room_id", chatRoomId)
      .eq("sender_type", "teacher")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: userMessages, error: userMsgError } =
      await this.supabase.client
        .from("chat_messages")
        .select("id, content, created_at")
        .eq("chat_room_id", chatRoomId)
        .eq("sender_type", "user")
        .gt("created_at", lastAi?.created_at ?? "1970-01-01")
        .order("created_at", { ascending: true });

    if (userMsgError || !userMessages || userMessages.length === 0) {
      this.logger.log(`No unresponded user messages in ${chatRoomId}`);
      return;
    }

    const combinedContent = userMessages.map((m) => m.content).join("\n");

    // 5. Parallel data fetch
    const [
      teacherResult,
      memoryResult,
      relationshipResult,
      eventsResult,
      historyResult,
    ] = await Promise.all([
      this.fetchTeacher(teacherId),
      this.supabase.client
        .from("conversation_memories")
        .select(
          "summary, messages_summarized, last_summarized_message_id, factual_memory, emotional_memory, student_profile",
        )
        .eq("chat_room_id", chatRoomId)
        .single(),
      this.supabase.client
        .from("relationship_states")
        .select("*")
        .eq("chat_room_id", chatRoomId)
        .single(),
      this.supabase.client
        .from("relationship_events")
        .select("event_type, summary, emotional_valence, created_at")
        .eq("chat_room_id", chatRoomId)
        .order("created_at", { ascending: false })
        .limit(10),
      this.supabase.client
        .from("chat_messages")
        .select("sender_type, content")
        .eq("chat_room_id", chatRoomId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    const teacher = teacherResult;
    if (!teacher) {
      this.logger.error(`Teacher not found: ${teacherId}`);
      return;
    }

    const memory = memoryResult.data as ConversationMemory | null;
    const events = (eventsResult.data || []) as RelationshipEvent[];
    const historyMessages = historyResult.data || [];

    let relState = relationshipResult.data as RelationshipState | null;
    if (!relState) {
      const { data: newState } = await this.supabase.client
        .from("relationship_states")
        .insert({ chat_room_id: chatRoomId })
        .select()
        .single();
      relState = newState as RelationshipState;
    }

    // 6. Sentiment & relationship updates
    const lastUserContent = userMessages[userMessages.length - 1].content || "";
    const { state: timeAdjustedState, timeContext } =
      this.relationshipService.applyTimeEffects(relState!, teacher);
    const sentiment =
      this.sentimentService.classifyUserMessage(lastUserContent);
    let updatedState = this.sentimentService.applyEmotionDelta(
      timeAdjustedState,
      sentiment,
    );
    updatedState = this.relationshipService.updateStreak(updatedState);
    updatedState.user_messages += userMessages.length;

    // 7. Build system prompt
    const systemPrompt = this.chatAiService.buildSystemPrompt(
      teacher,
      memory,
      updatedState,
      events,
      timeContext,
      sentiment,
    );

    // 8. Build messages array for OpenAI
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [{ role: "system", content: systemPrompt }];

    if (historyMessages.length > 0) {
      const chronological = [...historyMessages].reverse();
      for (const msg of chronological) {
        messages.push({
          role: msg.sender_type === "user" ? "user" : "assistant",
          content: msg.content || "",
        });
      }
    }
    messages.push({ role: "user", content: combinedContent });

    // 9. Call OpenAI
    let aiResponse: string;
    try {
      aiResponse =
        (await this.openai.chatCompletion(messages, {
          response_format: CHAT_RESPONSE_FORMAT as any,
        })) || '{"messages":["흠..."]}';
    } catch (openaiError) {
      this.logger.error(`OpenAI call failed: ${openaiError}`);
      aiResponse = '{"messages":["아 잠깐, 다시 한번 말해줄래?"]}';
    }

    // 10. Parse multi-message response
    this.logger.log(`[AI Raw Response] ${aiResponse.substring(0, 300)}`);

    let aiMessages: string[];
    try {
      const parsed = JSON.parse(aiResponse);
      if (parsed.messages && Array.isArray(parsed.messages)) {
        aiMessages = parsed.messages.filter(
          (m: string) => typeof m === "string" && m.trim().length > 0,
        );
      } else if (
        Array.isArray(parsed) &&
        parsed.every((m: unknown) => typeof m === "string")
      ) {
        aiMessages = parsed.filter((m: string) => m.trim().length > 0);
      } else {
        aiMessages = [aiResponse];
      }
    } catch {
      aiMessages = [aiResponse];
    }
    if (aiMessages.length === 0) aiMessages = ["흠..."];
    if (aiMessages.length > 5) aiMessages = aiMessages.slice(0, 5);

    // 11. Schedule BullMQ delayed jobs for AI message delivery
    const initialDelay = 1500; // AI "thinking" time in ms
    let cumulativeDelay = initialDelay;

    // Emit typing_start via Socket.IO
    this.chatGateway.emitTypingStart(chatRoomId);

    // Calculate total typing duration for Redis state
    const interMessageGap = 1500; // pause between message bubbles in ms
    let totalTypingDuration = 0;
    for (let j = 0; j < aiMessages.length; j++) {
      if (j > 0) totalTypingDuration += interMessageGap;
      totalTypingDuration += this.calculateTypingDuration(aiMessages[j]);
    }

    // Store typing state in Redis (with expiry)
    await this.redis.client.set(
      `typing:${chatRoomId}`,
      JSON.stringify({
        is_typing: true,
        until: Date.now() + initialDelay + totalTypingDuration,
      }),
      "EX",
      60,
    );

    const teacherName = teacher.name;
    const teacherProfileImageUrl = teacher.profile_image_url || "";

    for (let i = 0; i < aiMessages.length; i++) {
      const msg = aiMessages[i];
      const typingDuration = this.calculateTypingDuration(msg);

      const jobData: ChatDeliveryJobData = {
        chatRoomId,
        userId,
        teacherName,
        teacherId: teacher.id,
        teacherProfileImageUrl,
        message: {
          chat_room_id: chatRoomId,
          sender_type: "teacher",
          sender_id: teacher.id,
          content: msg,
        },
        isFirst: i === 0,
        isLast: i === aiMessages.length - 1,
      };

      // Add inter-message gap (after first message)
      if (i > 0) {
        cumulativeDelay += interMessageGap;
      }

      cumulativeDelay += typingDuration;

      await this.chatDeliveryQueue.add("deliver-message", jobData, {
        delay: cumulativeDelay,
      });
    }

    // Update total_messages (user messages + AI messages to be delivered)
    updatedState.total_messages += userMessages.length + aiMessages.length;

    // 12. Detect & save relationship events
    const detectedEvents = this.relationshipService.detectEvents(
      lastUserContent,
      sentiment,
      updatedState,
    );
    if (detectedEvents.length > 0) {
      await this.supabase.client.from("relationship_events").insert(
        detectedEvents.map((e) => ({
          chat_room_id: chatRoomId,
          event_type: e.event_type,
          summary: e.summary,
          emotional_valence: e.emotional_valence,
          message_id: userMessages[userMessages.length - 1].id,
        })),
      );
    }

    // 13. Check stage transition
    const newStage =
      this.relationshipService.checkStageTransition(updatedState);
    if (newStage !== updatedState.stage) {
      await this.supabase.client.from("relationship_events").insert({
        chat_room_id: chatRoomId,
        event_type: "milestone",
        summary: `Relationship evolved: ${updatedState.stage} → ${newStage}`,
        emotional_valence: newStage > updatedState.stage ? 3 : -2,
        message_id: userMessages[userMessages.length - 1].id,
      });
      updatedState.stage = newStage;
    }

    // 14. Update question_frequency
    if (historyMessages.length >= 3) {
      const recentAiMsgs = historyMessages
        .filter((m: { sender_type: string }) => m.sender_type === "teacher")
        .slice(0, 3);
      const allHadQuestions = recentAiMsgs.every(
        (m: { content: string }) => m.content && /[?\uff1f]/.test(m.content),
      );
      if (allHadQuestions) {
        updatedState.question_frequency = clamp(
          updatedState.question_frequency - 15,
          10,
          100,
        );
      } else {
        updatedState.question_frequency = clamp(
          updatedState.question_frequency + 3,
          10,
          100,
        );
      }
    }

    // 15. Save updated relationship state
    await this.supabase.client
      .from("relationship_states")
      .update({
        stage: updatedState.stage,
        warmth: updatedState.warmth,
        patience: updatedState.patience,
        enthusiasm: updatedState.enthusiasm,
        trust: updatedState.trust,
        total_messages: updatedState.total_messages,
        user_messages: updatedState.user_messages,
        consecutive_positive: updatedState.consecutive_positive,
        consecutive_negative: updatedState.consecutive_negative,
        rude_count: updatedState.rude_count,
        ghost_count: updatedState.ghost_count,
        last_user_message_at: new Date().toISOString(),
        current_streak_days: updatedState.current_streak_days,
        longest_streak_days: updatedState.longest_streak_days,
        formality: updatedState.formality,
        question_frequency: updatedState.question_frequency,
        updated_at: new Date().toISOString(),
      })
      .eq("chat_room_id", chatRoomId);

    // 16. Check if summary needed
    const totalMessages = await this.getMessageCount(chatRoomId);
    const summarizedCount = memory?.messages_summarized || 0;
    if (totalMessages - summarizedCount >= 30) {
      this.memoryService
        .summarizeConversation(chatRoomId, memory)
        .catch((err) => this.logger.error(`Summarization failed: ${err}`));
    }

    // 17. Check for new messages arrived during processing
    const processedUntil = userMessages[userMessages.length - 1].created_at;
    const { data: newer } = await this.supabase.client
      .from("chat_messages")
      .select("id")
      .eq("chat_room_id", chatRoomId)
      .eq("sender_type", "user")
      .gt("created_at", processedUntil)
      .limit(1);

    if (newer?.length) {
      this.logger.log(
        `New messages arrived during processing, re-processing ${chatRoomId}`,
      );
      // Release lock and re-acquire for recursive call
      await this.redis.releaseLock(`chat_lock:${chatRoomId}`);
      const reAcquired = await this.redis.acquireLock(
        `chat_lock:${chatRoomId}`,
        60,
      );
      if (reAcquired) {
        try {
          await this.processChatRoom(chatRoomId, userId);
        } finally {
          await this.redis.releaseLock(`chat_lock:${chatRoomId}`);
        }
      }
    }
  }

  private calculateTypingDuration(content: string): number {
    const duration = content.length * 50;
    return Math.max(1000, Math.min(5000, duration));
  }

  private async fetchTeacher(teacherId: string): Promise<Teacher | null> {
    const cacheKey = `teacher:${teacherId}`;

    // Check Redis cache first
    const cached = await this.redis.getCachedJson<Teacher>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase.client
      .from("teachers")
      .select(
        "id, name, bio, persona_prompt, specialization, emotional_range, profile_image_url",
      )
      .eq("id", teacherId)
      .single();

    if (error || !data) return null;

    // Cache for 1 hour
    await this.redis.cacheJson(cacheKey, data, 3600);
    return data as Teacher;
  }

  private async getMessageCount(chatRoomId: string): Promise<number> {
    const { count } = await this.supabase.client
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("chat_room_id", chatRoomId);
    return count || 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
