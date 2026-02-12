import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateChatRoomDto {
  @ApiProperty({ description: 'Teacher UUID to create a chat room with' })
  @IsUUID()
  @IsNotEmpty()
  teacher_id: string;
}
