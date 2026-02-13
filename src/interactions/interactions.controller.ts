import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InteractionsService } from './interactions.service';
import { ToggleInteractionDto } from './dto/toggle-interaction.dto';

@ApiTags('Interactions')
@ApiBearerAuth()
@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle a follow, like, or bookmark interaction' })
  async toggle(@Req() req: Request, @Body() dto: ToggleInteractionDto) {
    const userId = (req as any).user.id;
    return this.interactionsService.toggle(userId, dto);
  }
}
