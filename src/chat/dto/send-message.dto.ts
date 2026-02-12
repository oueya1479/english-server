import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ description: 'Chat room UUID' })
  @IsUUID()
  @IsNotEmpty()
  chat_room_id: string;

  @ApiProperty({ description: 'Message content from the user' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
