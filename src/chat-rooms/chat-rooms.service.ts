import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ChatRoomsService {
  private readonly logger = new Logger(ChatRoomsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  async getChatRooms(userId: string) {
    // Get chat rooms with teacher info
    const { data: rooms, error } = await this.supabase.client
      .from('chat_rooms')
      .select(
        `
        id,
        teacher_id,
        last_message_at,
        user_unread_count,
        created_at,
        teacher:teachers(id, name, profile_image_url, is_verified)
      `,
      )
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) {
      this.logger.error(`Failed to get chat rooms: ${error.message}`);
      throw new InternalServerErrorException('Failed to get chat rooms');
    }

    if (!rooms || rooms.length === 0) return [];

    // Get last message for each room
    const roomIds = rooms.map((r) => r.id);
    const { data: lastMessages, error: msgError } = await this.supabase.client
      .from('chat_messages')
      .select('chat_room_id, content, sender_type, created_at')
      .in('chat_room_id', roomIds)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (msgError) {
      this.logger.warn(`Failed to get last messages: ${msgError.message}`);
    }

    // Group last message per room (first occurrence per room = latest)
    const lastMessageMap = new Map<
      string,
      { content: string; sender_type: string }
    >();
    if (lastMessages) {
      for (const msg of lastMessages) {
        if (!lastMessageMap.has(msg.chat_room_id)) {
          lastMessageMap.set(msg.chat_room_id, {
            content: msg.content,
            sender_type: msg.sender_type,
          });
        }
      }
    }

    return rooms.map((room) => {
      const teacher = room.teacher as any;
      const lastMsg = lastMessageMap.get(room.id);
      return {
        id: room.id,
        teacher_id: room.teacher_id,
        teacher_name: teacher?.name ?? null,
        teacher_profile_image_url: teacher?.profile_image_url ?? null,
        teacher_is_verified: teacher?.is_verified ?? false,
        last_message_content: lastMsg?.content ?? null,
        last_message_sender_type: lastMsg?.sender_type ?? null,
        last_message_at: room.last_message_at,
        user_unread_count: room.user_unread_count,
        created_at: room.created_at,
      };
    });
  }

  async getOrCreateChatRoom(userId: string, teacherId: string) {
    // Check if chat room already exists for this user+teacher
    const { data: existing, error: findError } = await this.supabase.client
      .from('chat_rooms')
      .select('*')
      .eq('user_id', userId)
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .maybeSingle();

    if (findError) {
      this.logger.error(
        `Failed to find chat room: ${findError.message}`,
      );
      throw new InternalServerErrorException('Failed to find chat room');
    }

    if (existing) {
      return existing;
    }

    // Create a new chat room
    const { data: newRoom, error: createError } = await this.supabase.client
      .from('chat_rooms')
      .insert({
        user_id: userId,
        teacher_id: teacherId,
        is_active: true,
      })
      .select()
      .single();

    if (createError) {
      this.logger.error(
        `Failed to create chat room: ${createError.message}`,
      );
      throw new InternalServerErrorException('Failed to create chat room');
    }

    return newRoom;
  }

  async syncChatRoom(chatRoomId: string, userId: string) {
    // 1. Verify user owns this chat room
    const { data: room, error: roomError } = await this.supabase.client
      .from('chat_rooms')
      .select('id, user_id')
      .eq('id', chatRoomId)
      .eq('user_id', userId)
      .single();

    if (roomError || !room) {
      throw new NotFoundException('Chat room not found');
    }

    // 2. Fetch recent 50 messages (ordered by created_at ascending)
    const { data: messages, error: msgError } = await this.supabase.client
      .from('chat_messages')
      .select('*')
      .eq('chat_room_id', chatRoomId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (msgError) {
      this.logger.error(`Failed to fetch messages: ${msgError.message}`);
      throw new InternalServerErrorException('Failed to fetch messages');
    }

    // Reverse to chronological order
    const chronologicalMessages = (messages || []).reverse();

    // 3. Check Redis typing state for this room
    let isTyping = false;
    try {
      const typingState = await this.redis.client.get(
        `typing:${chatRoomId}`,
      );
      if (typingState) {
        const parsed = JSON.parse(typingState);
        isTyping = parsed.is_typing && parsed.until > Date.now();
      }
    } catch {
      // Ignore Redis errors for typing state
    }

    // 4. Mark messages as read (reset unread count + mark teacher messages)
    await this.markMessagesAsRead(chatRoomId, userId);

    return {
      messages: chronologicalMessages,
      isTyping,
    };
  }

  async markMessagesAsRead(chatRoomId: string, userId: string) {
    // Reset unread count
    const { error: roomError } = await this.supabase.client
      .from('chat_rooms')
      .update({ user_unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', chatRoomId)
      .eq('user_id', userId);

    if (roomError) {
      this.logger.error(
        `Failed to reset unread count: ${roomError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to mark messages as read',
      );
    }

    // Mark teacher messages as read
    const { error: msgError } = await this.supabase.client
      .from('chat_messages')
      .update({ is_read: true })
      .eq('chat_room_id', chatRoomId)
      .eq('sender_type', 'teacher')
      .eq('is_read', false);

    if (msgError) {
      this.logger.error(
        `Failed to mark messages as read: ${msgError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to mark messages as read',
      );
    }

    return null;
  }
}
