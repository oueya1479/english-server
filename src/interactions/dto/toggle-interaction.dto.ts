import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class ToggleInteractionDto {
  @ApiProperty({ enum: ['follow', 'like', 'bookmark'] })
  @IsIn(['follow', 'like', 'bookmark'])
  type: 'follow' | 'like' | 'bookmark';

  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  user_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacher_id?: string;

  @ApiPropertyOptional({ enum: ['post', 'video_post'] })
  @IsOptional()
  @IsIn(['post', 'video_post'])
  content_type?: 'post' | 'video_post';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  content_id?: string;
}
