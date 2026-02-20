import { Module } from '@nestjs/common';
import { EnglishPhrasesController } from './english-phrases.controller';
import { EnglishPhrasesService } from './english-phrases.service';

@Module({
  controllers: [EnglishPhrasesController],
  providers: [EnglishPhrasesService],
})
export class EnglishPhrasesModule {}
