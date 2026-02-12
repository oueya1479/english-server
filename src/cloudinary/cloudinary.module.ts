import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CloudinaryService } from './cloudinary.service';

@Module({
  imports: [StorageModule],
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
