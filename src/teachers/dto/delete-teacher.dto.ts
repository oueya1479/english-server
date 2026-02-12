import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class DeleteTeacherDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  teacher_id: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  cascade?: boolean;
}
