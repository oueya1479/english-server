import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CountersService } from './counters.service';

@ApiTags('Counters')
@Controller('counters')
export class CountersController {
  constructor(private readonly countersService: CountersService) {}

  @Post('view/:videoId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Increment view count for a video' })
  async incrementViewCount(
    @Param('videoId', ParseUUIDPipe) videoId: string,
  ) {
    return this.countersService.incrementViewCount(videoId);
  }

  @Post('comment-like/:commentId/increment')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Increment like count for a comment' })
  async incrementCommentLikeCount(
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.countersService.incrementCommentLikeCount(commentId);
  }

  @Post('comment-like/:commentId/decrement')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decrement like count for a comment' })
  async decrementCommentLikeCount(
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.countersService.decrementCommentLikeCount(commentId);
  }
}
