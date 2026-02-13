import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { VideoCompressionModule } from '../video-compression/video-compression.module';
import { VideoPostsController } from './video-posts.controller';
import { VideoPostsService } from './video-posts.service';

@Module({
  imports: [StorageModule, CloudinaryModule, VideoCompressionModule],
  controllers: [VideoPostsController],
  providers: [VideoPostsService],
})
export class VideoPostsModule {}
