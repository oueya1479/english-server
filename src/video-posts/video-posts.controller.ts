import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VideoPostsService } from './video-posts.service';
import { CreateVideoPostDto } from './dto/create-video-post.dto';
import { UpdateVideoPostDto } from './dto/update-video-post.dto';

@ApiTags('Video Posts')
@ApiBearerAuth()
@Controller('video-posts')
export class VideoPostsController {
  constructor(private readonly videoPostsService: VideoPostsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create video post(s) with uploaded video files' })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'videos', maxCount: 5 },
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  async create(
    @Body() dto: CreateVideoPostDto,
    @UploadedFiles()
    files: {
      videos?: Express.Multer.File[];
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    // Combine "videos" and "video" fields for backward compatibility
    const videoFiles = [
      ...(files.videos || []),
      ...(files.video || []),
    ];

    const thumbnailFile = files.thumbnail?.[0];

    return this.videoPostsService.createVideoPost(
      dto,
      videoFiles,
      thumbnailFile,
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update an existing video post' })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'video', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVideoPostDto,
    @UploadedFiles()
    files: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    const videoFile = files.video?.[0];
    const thumbnailFile = files.thumbnail?.[0];

    return this.videoPostsService.updateVideoPost(
      id,
      dto,
      videoFile,
      thumbnailFile,
    );
  }
}
