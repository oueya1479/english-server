import { Module } from '@nestjs/common';
import { CountersController } from './counters.controller';
import { CountersService } from './counters.service';

@Module({
  controllers: [CountersController],
  providers: [CountersService],
})
export class CountersModule {}
