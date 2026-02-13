import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ToggleInteractionDto {
  @ApiProperty({ enum: ['follow', 'like', 'bookmark'] })
  @IsIn(['follow', 'like', 'bookmark'])
  type: 'follow' | 'like' | 'bookmark';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacher_id?: string;

  @ApiPropertyOptional({ enum: ['post', 'video_post', 'quote'] })
  @IsOptional()
  @IsIn(['post', 'video_post', 'quote'])
  content_type?: 'post' | 'video_post' | 'quote';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  content_id?: string;
}
