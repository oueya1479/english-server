import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      const {
        data: { user },
        error,
      } = await this.supabaseService.client.auth.getUser(token);
      if (error || !user) {
        this.logger.warn(
          `Client ${client.id} auth failed: ${error?.message}`,
        );
        client.disconnect();
        return;
      }

      client.data.userId = user.id;

      // Auto-join user's personal room server-side to avoid race condition.
      // The client's onConnect fires join_user_room immediately, but
      // handleConnection hasn't finished yet so client.data.userId is unset.
      client.join(`user:${user.id}`);

      this.logger.log(`Client ${client.id} connected (user: ${user.id})`);
    } catch (err) {
      this.logger.error(`Connection error: ${err.message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      await this.redisService.client
        .del(`active_room:${userId}`)
        .catch(() => {});
    }
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatRoomId: string },
  ) {
    const room = `room:${data.chatRoomId}`;
    client.join(room);

    // Track active room in Redis
    const userId = client.data?.userId;
    if (userId) {
      await this.redisService.client.set(
        `active_room:${userId}`,
        data.chatRoomId,
        'EX',
        3600,
      );
    }

    this.logger.log(`Client ${client.id} joined ${room}`);
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatRoomId: string },
  ) {
    const room = `room:${data.chatRoomId}`;
    client.leave(room);

    // Clear active room in Redis
    const userId = client.data?.userId;
    if (userId) {
      const activeRoom = await this.redisService.client.get(
        `active_room:${userId}`,
      );
      if (activeRoom === data.chatRoomId) {
        await this.redisService.client.del(`active_room:${userId}`);
      }
    }

    this.logger.log(`Client ${client.id} left ${room}`);
  }

  @SubscribeMessage('join_user_room')
  handleJoinUserRoom(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      client.join(`user:${userId}`);
      this.logger.log(`Client ${client.id} joined user:${userId}`);
    }
  }

  // Service-callable methods

  emitNewMessage(chatRoomId: string, message: any) {
    this.server.to(`room:${chatRoomId}`).emit('new_message', message);
  }

  emitTypingStart(chatRoomId: string) {
    this.server.to(`room:${chatRoomId}`).emit('typing_start');
  }

  emitTypingStop(chatRoomId: string) {
    this.server.to(`room:${chatRoomId}`).emit('typing_stop');
  }

  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  async isUserInRoom(userId: string, chatRoomId: string): Promise<boolean> {
    const activeRoom = await this.redisService.client.get(
      `active_room:${userId}`,
    );
    return activeRoom === chatRoomId;
  }
}
