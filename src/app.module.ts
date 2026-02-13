import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { envValidationSchema } from './common/config/env.validation';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { FirebaseModule } from './firebase/firebase.module';
import { OpenAIModule } from './openai/openai.module';
import { TeachersModule } from './teachers/teachers.module';
import { PostsModule } from './posts/posts.module';
import { VideoPostsModule } from './video-posts/video-posts.module';
import { InteractionsModule } from './interactions/interactions.module';
import { ChatModule } from './chat/chat.module';
import { FeedsModule } from './feeds/feeds.module';
import { ChatRoomsModule } from './chat-rooms/chat-rooms.module';
import { CountersModule } from './counters/counters.module';
import { TeacherVotesModule } from './teacher-votes/teacher-votes.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    // Infrastructure (Global)
    DatabaseModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get('REDIS_URL', 'redis://localhost:6379');
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port) || 6379,
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    // Service modules
    StorageModule,
    CloudinaryModule,
    FirebaseModule,
    OpenAIModule,
    // Feature modules
    TeachersModule,
    PostsModule,
    VideoPostsModule,
    InteractionsModule,
    ChatModule,
    FeedsModule,
    ChatRoomsModule,
    CountersModule,
    TeacherVotesModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
