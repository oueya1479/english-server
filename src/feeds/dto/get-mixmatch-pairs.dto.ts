import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetMixmatchPairsDto {
  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pair_limit?: number = 5;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  current_user_id?: string;
}
