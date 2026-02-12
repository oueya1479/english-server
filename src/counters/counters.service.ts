import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class CountersService {
  private readonly logger = new Logger(CountersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async incrementViewCount(videoId: string) {
    const { data, error } = await this.supabase.client
      .from('video_posts')
      .select('view_count')
      .eq('id', videoId)
      .single();

    if (error) {
      this.logger.error(`Failed to get video for view count: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to increment view count',
      );
    }

    const { error: updateError } = await this.supabase.client
      .from('video_posts')
      .update({ view_count: (data.view_count ?? 0) + 1 })
      .eq('id', videoId);

    if (updateError) {
      this.logger.error(`Failed to increment view count: ${updateError.message}`);
      throw new InternalServerErrorException(
        'Failed to increment view count',
      );
    }

    return null;
  }

  async incrementCommentLikeCount(commentId: string) {
    const { data, error } = await this.supabase.client
      .from('comments')
      .select('like_count')
      .eq('id', commentId)
      .single();

    if (error) {
      this.logger.error(`Failed to get comment for like count: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to increment comment like count',
      );
    }

    const { error: updateError } = await this.supabase.client
      .from('comments')
      .update({ like_count: (data.like_count ?? 0) + 1 })
      .eq('id', commentId);

    if (updateError) {
      this.logger.error(
        `Failed to increment comment like count: ${updateError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to increment comment like count',
      );
    }

    return null;
  }

  async decrementCommentLikeCount(commentId: string) {
    const { data, error } = await this.supabase.client
      .from('comments')
      .select('like_count')
      .eq('id', commentId)
      .single();

    if (error) {
      this.logger.error(`Failed to get comment for like count: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to decrement comment like count',
      );
    }

    const { error: updateError } = await this.supabase.client
      .from('comments')
      .update({ like_count: Math.max((data.like_count ?? 0) - 1, 0) })
      .eq('id', commentId);

    if (updateError) {
      this.logger.error(
        `Failed to decrement comment like count: ${updateError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to decrement comment like count',
      );
    }

    return null;
  }
}
