import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ChatRoomsService } from './chat-rooms.service';
import { CreateChatRoomDto } from './dto/create-chat-room.dto';

@ApiTags('Chat Rooms')
@ApiBearerAuth()
@Controller('chat-rooms')
export class ChatRoomsController {
  constructor(private readonly chatRoomsService: ChatRoomsService) {}

  @Get()
  @ApiOperation({ summary: 'Get chat rooms with details for the authenticated user' })
  async getChatRooms(@Req() req: Request) {
    const userId = (req as any).user.id;
    return this.chatRoomsService.getChatRooms(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Get or create a chat room with a teacher' })
  async getOrCreateChatRoom(
    @Req() req: Request,
    @Body() dto: CreateChatRoomDto,
  ) {
    const userId = (req as any).user.id;
    return this.chatRoomsService.getOrCreateChatRoom(userId, dto.teacher_id);
  }

  @Get(':id/sync')
  @ApiOperation({ summary: 'Sync chat room: fetch messages, typing state, and mark as read' })
  async syncChatRoom(
    @Param('id', ParseUUIDPipe) chatRoomId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id;
    return this.chatRoomsService.syncChatRoom(chatRoomId, userId);
  }

  @Post(':id/mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark messages as read in a chat room' })
  async markMessagesAsRead(
    @Param('id', ParseUUIDPipe) chatRoomId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id;
    return this.chatRoomsService.markMessagesAsRead(chatRoomId, userId);
  }
}
