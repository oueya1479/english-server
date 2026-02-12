import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('send-message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a user message and trigger AI response' })
  async sendMessage(@Body() dto: SendMessageDto, @Req() req: Request) {
    const userId = (req as any).user.id;
    return this.chatService.processMessage(dto, userId);
  }
}
