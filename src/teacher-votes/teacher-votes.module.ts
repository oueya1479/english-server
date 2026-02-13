import { Module } from '@nestjs/common';
import { TeacherVotesController } from './teacher-votes.controller';
import { TeacherVotesService } from './teacher-votes.service';

@Module({
  controllers: [TeacherVotesController],
  providers: [TeacherVotesService],
})
export class TeacherVotesModule {}
