import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MarkMessagesReadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  user_id?: string;
}
