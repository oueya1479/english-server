import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateVideoPostDto {
  @ApiPropertyOptional({ description: 'Description of the video post' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Duration in milliseconds (string, parsed to int)',
  })
  @IsOptional()
  @IsString()
  duration_ms?: string;

  @ApiPropertyOptional({ description: 'Aspect ratio of the video' })
  @IsOptional()
  @IsString()
  aspect_ratio?: string;

  @ApiPropertyOptional({ description: 'Video quality' })
  @IsOptional()
  @IsString()
  video_quality?: string;

  @ApiPropertyOptional({
    description: 'Published status as string ("true" or "false")',
  })
  @IsOptional()
  @IsString()
  is_published?: string;

  @ApiPropertyOptional({
    description:
      'UUID of the associated English phrase (send "null" or "" to clear)',
  })
  @IsOptional()
  @IsString()
  english_phrase_id?: string;

  @ApiPropertyOptional({
    description: 'Language code, must be "ko" or "en"',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description:
      'Collaborator IDs as a JSON array string or comma-separated string',
  })
  @IsOptional()
  @IsString()
  collaborator_ids?: string;

  @ApiPropertyOptional({
    description: 'UUID of the teacher (owner)',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  teacher_id?: string;

  @ApiPropertyOptional({
    description:
      'Captions as a JSON array string, e.g. [{"message":"hello","x":0.5,"y":0.5}]',
  })
  @IsOptional()
  @IsString()
  captions?: string;
}
