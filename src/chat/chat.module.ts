import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OpenAIModule } from '../openai/openai.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatAiService } from './chat-ai.service';
import { ChatGateway } from './chat.gateway';
import { ChatDeliveryProcessor } from './chat-delivery.processor';
import { SentimentService } from './sentiment.service';
import { RelationshipService } from './relationship.service';
import { MemoryService } from './memory.service';
import { AntiPatternService } from './anti-pattern.service';

@Module({
  imports: [
    OpenAIModule,
    FirebaseModule,
    BullModule.registerQueue({ name: 'chat-delivery' }),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatAiService,
    ChatGateway,
    ChatDeliveryProcessor,
    SentimentService,
    RelationshipService,
    MemoryService,
    AntiPatternService,
  ],
  exports: [ChatGateway],
})
export class ChatModule {}
