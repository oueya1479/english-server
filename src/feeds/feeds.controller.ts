import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { FeedsService } from './feeds.service';
import { GetRandomVideosDto } from './dto/get-random-videos.dto';
import { GetFollowingVideosDto } from './dto/get-following-videos.dto';
import { GetMixmatchPairsDto } from './dto/get-mixmatch-pairs.dto';
import { GetTeacherVideosDto } from './dto/get-teacher-videos.dto';

@ApiTags('Feeds')
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feedsService: FeedsService) {}

  @Get('random-videos')
  @Public()
  @ApiOperation({ summary: 'Get random videos for the main feed' })
  async getRandomVideos(@Query() dto: GetRandomVideosDto) {
    return this.feedsService.getRandomVideos(dto);
  }

  @Get('following-videos')
  @Public()
  @ApiOperation({ summary: 'Get videos from followed teachers' })
  async getFollowingVideos(@Query() dto: GetFollowingVideosDto) {
    return this.feedsService.getFollowingVideos(dto);
  }

  @Get('mixmatch-pairs')
  @Public()
  @ApiOperation({ summary: 'Get mixmatch video pairs' })
  async getMixmatchPairs(@Query() dto: GetMixmatchPairsDto) {
    return this.feedsService.getMixmatchPairs(dto);
  }

  @Get('teacher-videos/:teacherId')
  @Public()
  @ApiOperation({ summary: 'Get videos for a specific teacher' })
  async getTeacherVideos(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() dto: GetTeacherVideosDto,
  ) {
    return this.feedsService.getTeacherVideos(teacherId, dto);
  }

  @Get('teacher-video-count/:teacherId')
  @Public()
  @ApiOperation({ summary: 'Get video count for a specific teacher' })
  async getTeacherVideoCount(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
  ) {
    return this.feedsService.getTeacherVideoCount(teacherId);
  }
}
