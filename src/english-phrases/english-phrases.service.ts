import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { GetRandomPhrasesDto } from './dto/get-random-phrases.dto';
import { SearchPhrasesDto } from './dto/search-phrases.dto';

@Injectable()
export class EnglishPhrasesService {
  private readonly logger = new Logger(EnglishPhrasesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getRandomPhrases(dto: GetRandomPhrasesDto) {
    const count = dto.count ?? 6;

    const { data, error } = await this.supabase.client
      .from('english_phrases')
      .select('id, english, korean, category');

    if (error) {
      this.logger.error(`Failed to get random phrases: ${error.message}`);
      throw new InternalServerErrorException('Failed to get random phrases');
    }

    if (!data || data.length === 0) return [];

    // Fisher-Yates shuffle for unbiased randomization
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [data[i], data[j]] = [data[j], data[i]];
    }
    return data.slice(0, count);
  }

  async searchPhrases(dto: SearchPhrasesDto) {
    const limit = dto.limit ?? 50;
    const q = dto.q?.trim();

    let query = this.supabase.client
      .from('english_phrases')
      .select('id, english, korean, category');

    if (q) {
      query = query.or(`english.ilike.%${q}%,korean.ilike.%${q}%`);
    }

    const { data, error } = await query.order('english').limit(limit);

    if (error) {
      this.logger.error(`Failed to search phrases: ${error.message}`);
      throw new InternalServerErrorException('Failed to search phrases');
    }

    return data ?? [];
  }
}
