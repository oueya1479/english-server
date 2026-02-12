import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { InteractionsService } from './interactions.service';
import { ToggleInteractionDto } from './dto/toggle-interaction.dto';

@ApiTags('Interactions')
@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({ summary: 'Toggle a follow, like, or bookmark interaction' })
  async toggle(@Body() dto: ToggleInteractionDto) {
    return this.interactionsService.toggle(dto);
  }
}
