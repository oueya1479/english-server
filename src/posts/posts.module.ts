import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [StorageModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
