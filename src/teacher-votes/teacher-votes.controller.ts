import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TeacherVotesService } from './teacher-votes.service';
import { GetVotableTeachersDto } from './dto/get-votable-teachers.dto';
import { SubmitTeacherVoteDto } from './dto/submit-teacher-vote.dto';

@ApiTags('Teacher Votes')
@ApiBearerAuth()
@Controller('teacher-votes')
export class TeacherVotesController {
  constructor(private readonly teacherVotesService: TeacherVotesService) {}

  @Get('votable')
  @ApiOperation({ summary: 'Get unverified teachers available for voting' })
  async getVotableTeachers(
    @CurrentUser('id') userId: string,
    @Query() dto: GetVotableTeachersDto,
  ) {
    return this.teacherVotesService.getVotableTeachers(userId, dto.limit ?? 10);
  }

  @Get(':teacherId/my-vote')
  @ApiOperation({ summary: 'Get current user vote for a specific teacher' })
  async getMyVote(
    @CurrentUser('id') userId: string,
    @Param('teacherId') teacherId: string,
  ) {
    return this.teacherVotesService.getUserVote(userId, teacherId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a vote for an unverified teacher' })
  async submitVote(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitTeacherVoteDto,
  ) {
    return this.teacherVotesService.submitVote(
      userId,
      dto.teacherId,
      dto.voteType,
    );
  }
}
