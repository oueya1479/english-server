import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UpdateTeacherDto } from './dto/update-teacher.dto';

@ApiTags('Teachers')
@ApiBearerAuth()
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Get()
  @ApiOperation({ summary: 'List all teachers' })
  async findAll() {
    return this.teachersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a teacher by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.teachersService.findOne(id);
  }

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

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update a teacher' })
  @UseInterceptors(FileInterceptor('profile_image'))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
    @UploadedFile() profileImage?: Express.Multer.File,
  ) {
    return this.teachersService.updateTeacher(id, dto, profileImage);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a teacher and optionally cascade-delete associated files' })
  async delete(@Body() dto: DeleteTeacherDto) {
    return this.teachersService.deleteTeacher(dto);
  }
}
