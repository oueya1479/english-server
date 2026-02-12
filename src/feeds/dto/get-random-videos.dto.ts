import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsUUID, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRandomVideosDto {
  @ApiProperty({ description: 'Random seed for deterministic ordering' })
  @Type(() => Number)
  @IsInt()
  seed: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  current_user_id?: string;
}
