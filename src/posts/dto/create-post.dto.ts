import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({ description: 'UUID of the teacher creating the post' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  teacher_id: string;

  @ApiPropertyOptional({ description: 'Text content of the post' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    description: 'JSON array string of alt texts for each image',
  })
  @IsOptional()
  @IsString()
  alt_texts?: string;
}
