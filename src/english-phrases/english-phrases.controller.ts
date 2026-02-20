import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { EnglishPhrasesService } from './english-phrases.service';
import { GetRandomPhrasesDto } from './dto/get-random-phrases.dto';
import { SearchPhrasesDto } from './dto/search-phrases.dto';

@ApiTags('English Phrases')
@Controller('english-phrases')
export class EnglishPhrasesController {
  constructor(private readonly englishPhrasesService: EnglishPhrasesService) {}

  @Get('random')
  @Public()
  @ApiOperation({ summary: 'Get random English phrases' })
  async getRandomPhrases(@Query() dto: GetRandomPhrasesDto) {
    return this.englishPhrasesService.getRandomPhrases(dto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search English phrases by english or korean text' })
  async searchPhrases(@Query() dto: SearchPhrasesDto) {
    return this.englishPhrasesService.searchPhrases(dto);
  }
}
