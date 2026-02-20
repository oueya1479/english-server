import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { SupabaseService } from '../database/supabase.service';
import { ChatGateway } from './chat.gateway';
import { FirebaseService } from '../firebase/firebase.service';
import { RedisService } from '../redis/redis.service';

export interface ChatDeliveryJobData {
  chatRoomId: string;
  userId: string;
  teacherName: string;
  teacherId: string;
  teacherProfileImageUrl: string;
  message: {
    chat_room_id: string;
    sender_type: 'teacher';
    sender_id: string;
    content: string;
  };
  isFirst: boolean;
  isLast: boolean;
}

@Processor('chat-delivery')
export class ChatDeliveryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ChatDeliveryProcessor.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly chatGateway: ChatGateway,
    private readonly firebaseService: FirebaseService,
    private readonly redisService: RedisService,
    @InjectQueue('chat-delivery') private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    // Clean up stale failed/delayed jobs from previous runs
    const failed = await this.queue.getFailed();
    const delayed = await this.queue.getDelayed();
    if (failed.length > 0) {
      await Promise.all(failed.map((j) => j.remove()));
      this.logger.log(`Cleaned ${failed.length} failed jobs`);
    }
    if (delayed.length > 0) {
      await Promise.all(delayed.map((j) => j.remove()));
      this.logger.log(`Cleaned ${delayed.length} stale delayed jobs`);
    }
    this.logger.log('ChatDeliveryProcessor initialized');
  }

  async process(job: Job<ChatDeliveryJobData>): Promise<void> {
    this.logger.log(
      `[Processor] Processing job ${job.id} (name: ${job.name}, delay: ${job.delay})`,
    );

    const {
      chatRoomId,
      userId,
      teacherName,
      teacherId,
      teacherProfileImageUrl,
      message,
      isFirst,
      isLast,
    } = job.data;

    try {
      // Check if user is currently viewing this chat room
      const userInRoom = await this.chatGateway.isUserInRoom(
        userId,
        chatRoomId,
      );

      // 1. Insert message into chat_messages (delivery time IS creation time)
      const { data: savedMessage, error: insertError } =
        await this.supabaseService.client
          .from('chat_messages')
          .insert({
            chat_room_id: message.chat_room_id,
            sender_type: message.sender_type,
            sender_id: message.sender_id,
            content: message.content,
            is_read: userInRoom,
          })
          .select()
          .single();

      if (insertError) {
        this.logger.error(`Failed to insert message: ${insertError.message}`);
        throw insertError;
      }

      // 2. Update chat_rooms metadata
      // NOTE: DB trigger `increment_user_unread_count` auto-increments
      // user_unread_count on every teacher message INSERT.
      // - If user IS in room: reset unread to 0 (counteract the trigger)
      // - If user is NOT in room: trigger handles it, just update last_message_at
      if (userInRoom) {
        const { error: updateError } = await this.supabaseService.client
          .from('chat_rooms')
          .update({
            last_message_at: new Date().toISOString(),
            user_unread_count: 0,
          })
          .eq('id', chatRoomId);

        if (updateError) {
          this.logger.warn(
            `Failed to update chat room: ${updateError.message}`,
          );
        }
      } else {
        const { error: updateError } = await this.supabaseService.client
          .from('chat_rooms')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', chatRoomId);

        if (updateError) {
          this.logger.warn(
            `Failed to update chat room: ${updateError.message}`,
          );
        }
      }

      // 3. Emit new_message via Socket.IO
      this.chatGateway.emitNewMessage(chatRoomId, savedMessage);

      // 4. If last message: emit typing_stop + delete Redis typing state
      if (isLast) {
        this.chatGateway.emitTypingStop(chatRoomId);
        await this.redisService.client.del(`typing:${chatRoomId}`);
      }

      // 5. FCM push only for first message + user NOT in room
      if (isFirst && !userInRoom) {
        try {
          await this.firebaseService.sendPushNotification(
            userId,
            teacherName,
            message.content.length > 100
              ? message.content.substring(0, 97) + '...'
              : message.content,
            {
              chat_room_id: chatRoomId,
              teacher_id: teacherId,
              teacher_image_url: teacherProfileImageUrl,
            },
          );
        } catch (fcmError) {
          this.logger.warn(`FCM push failed: ${fcmError.message}`);
        }
      }

      // 6. Emit chat_room_updated to user's personal channel (with notification data)
      this.chatGateway.emitToUser(userId, 'chat_room_updated', {
        chatRoomId,
        teacherName,
        teacherProfileImageUrl,
        lastMessageContent: message.content,
      });

      this.logger.log(
        `Delivered message for room ${chatRoomId} (first: ${isFirst}, last: ${isLast}, userInRoom: ${userInRoom})`,
      );
    } catch (error) {
      this.logger.error(
        `Delivery failed for room ${chatRoomId}: ${error.message}`,
      );
      throw error;
    }
  }

}
