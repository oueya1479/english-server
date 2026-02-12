import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';

@Module({
  imports: [StorageModule],
  controllers: [TeachersController],
  providers: [TeachersService],
})
export class TeachersModule {}
