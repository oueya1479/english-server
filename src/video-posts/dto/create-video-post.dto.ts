import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVideoPostDto {
  @ApiProperty({ description: 'UUID of the teacher creating the video post' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  teacher_id: string;

  @ApiPropertyOptional({
    description:
      'Collaborator IDs as a JSON array string or comma-separated string',
  })
  @IsOptional()
  @IsString()
  collaborator_ids?: string;

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

  @ApiPropertyOptional({
    description: 'Aspect ratio of the video',
    default: '9:16',
  })
  @IsOptional()
  @IsString()
  aspect_ratio?: string;

  @ApiPropertyOptional({
    description: 'Video quality',
    default: 'hd',
  })
  @IsOptional()
  @IsString()
  video_quality?: string;

  @ApiPropertyOptional({
    description: 'UUID of the associated English phrase',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  english_phrase_id?: string;

  @ApiPropertyOptional({
    description: 'Language code, must be "ko" or "en"',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description:
      'Captions as a JSON array string, e.g. [{"message":"hello","x":0.5,"y":0.5}]',
  })
  @IsOptional()
  @IsString()
  captions?: string;
}
