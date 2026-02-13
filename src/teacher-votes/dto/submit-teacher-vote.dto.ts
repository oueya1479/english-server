import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsIn } from 'class-validator';

export class SubmitTeacherVoteDto {
  @ApiProperty({ description: 'ID of the teacher to vote on', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  teacherId: string;

  @ApiProperty({
    description: 'Vote type',
    enum: ['up', 'down'],
    example: 'up',
  })
  @IsNotEmpty()
  @IsIn(['up', 'down'])
  voteType: 'up' | 'down';
}
