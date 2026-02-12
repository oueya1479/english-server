import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { DeleteTeacherDto } from './dto/delete-teacher.dto';

@ApiTags('Teachers')
@ApiBearerAuth()
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a new teacher' })
  @UseInterceptors(FileInterceptor('profile_image'))
  async create(
    @Body() dto: CreateTeacherDto,
    @UploadedFile() profileImage?: Express.Multer.File,
  ) {
    return this.teachersService.createTeacher(dto, profileImage);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a teacher and optionally cascade-delete associated files' })
  async delete(@Body() dto: DeleteTeacherDto) {
    return this.teachersService.deleteTeacher(dto);
  }
}
