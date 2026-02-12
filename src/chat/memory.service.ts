import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { OpenAIService } from '../openai/openai.service';

interface ConversationMemory {
  summary?: string;
  messages_summarized?: number;
  last_summarized_message_id?: string | null;
  factual_memory?: string;
  emotional_memory?: string;
  student_profile?: Record<string, unknown>;
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openai: OpenAIService,
  ) {}

  shouldSummarize(totalMessages: number, summarizedCount: number): boolean {
    return totalMessages - summarizedCount >= 30;
  }

  async summarizeConversation(
    chatRoomId: string,
    existingMemory: ConversationMemory | null,
  ): Promise<void> {
    try {
      let query = this.supabase.client
        .from('chat_messages')
        .select('id, sender_type, content, created_at')
        .eq('chat_room_id', chatRoomId)
        .order('created_at', { ascending: true });

      if (existingMemory?.last_summarized_message_id) {
        const { data: lastMsg } = await this.supabase.client
          .from('chat_messages')
          .select('created_at')
          .eq('id', existingMemory.last_summarized_message_id)
          .single();
        if (lastMsg) {
          query = query.gt('created_at', lastMsg.created_at);
        }
      }

      const { data: newMessages } = await query;
      if (!newMessages || newMessages.length === 0) return;

      const existingFactual = existingMemory?.factual_memory || '';
      const existingEmotional = existingMemory?.emotional_memory || '';

      const summarySystemPrompt = `You are a memory system for an AI English teacher. Analyze the conversation and produce output in EXACTLY this format:

===FACTUAL===
(Bullet points of factual info about the student: name, job, interests, English level, common mistakes, learning goals. Merge with existing facts below.)

===EMOTIONAL===
(Write as the teacher reflecting on this relationship. NOT a report — write like a person recalling how they feel about this student. 2-3 sentences max. Include emotional tone, rapport level, any tension or warmth.)

===PROFILE===
(JSON object with: {"english_level": "beginner/intermediate/advanced", "interests": [...], "communication_style": "...", "learning_preference": "..."})

${existingFactual ? `Previous factual memory:\n${existingFactual}\n` : ''}
${existingEmotional ? `Previous emotional memory:\n${existingEmotional}\n` : ''}
${existingMemory?.summary ? `Previous summary:\n${existingMemory.summary}\n` : ''}

New messages to incorporate:
${newMessages.map((m) => `${m.sender_type}: ${m.content}`).join('\n')}

Keep each section concise. Factual: max 10 bullet points. Emotional: max 3 sentences.`;

      const summaryResponse = await this.openai.chatCompletion(
        [{ role: 'system', content: summarySystemPrompt }],
        { max_tokens: 600, temperature: 0.3 },
      );

      if (!summaryResponse) return;

      let factualMemory = existingFactual;
      let emotionalMemory = existingEmotional;
      let studentProfile = existingMemory?.student_profile || {};

      const factualMatch = summaryResponse.match(
        /===FACTUAL===\s*([\s\S]*?)(?====EMOTIONAL===|$)/,
      );
      const emotionalMatch = summaryResponse.match(
        /===EMOTIONAL===\s*([\s\S]*?)(?====PROFILE===|$)/,
      );
      const profileMatch = summaryResponse.match(
        /===PROFILE===\s*([\s\S]*?)$/,
      );

      if (factualMatch?.[1]) factualMemory = factualMatch[1].trim();
      if (emotionalMatch?.[1]) emotionalMemory = emotionalMatch[1].trim();
      if (profileMatch?.[1]) {
        try {
          const jsonStr = profileMatch[1]
            .trim()
            .replace(/```json?\n?/g, '')
            .replace(/```/g, '');
          studentProfile = JSON.parse(jsonStr);
        } catch {
          /* keep existing profile */
        }
      }

      const totalCount = await this.getMessageCount(chatRoomId);
      const lastMessageId = newMessages[newMessages.length - 1].id;

      await this.supabase.client.from('conversation_memories').upsert(
        {
          chat_room_id: chatRoomId,
          summary: summaryResponse,
          factual_memory: factualMemory,
          emotional_memory: emotionalMemory,
          student_profile: studentProfile,
          messages_summarized: totalCount,
          last_summarized_message_id: lastMessageId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'chat_room_id' },
      );

      this.logger.log(
        `Summarized conversation for chat room ${chatRoomId}: ${totalCount} messages (3-part)`,
      );
    } catch (error) {
      this.logger.error(`Failed to summarize conversation: ${error}`);
    }
  }

  private async getMessageCount(chatRoomId: string): Promise<number> {
    const { count } = await this.supabase.client
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_room_id', chatRoomId);
    return count || 0;
  }
}
