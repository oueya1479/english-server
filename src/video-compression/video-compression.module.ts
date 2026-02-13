import { Module } from '@nestjs/common';
import { VideoCompressionService } from './video-compression.service';

@Module({
  providers: [VideoCompressionService],
  exports: [VideoCompressionService],
})
export class VideoCompressionModule {}
