import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { ToggleInteractionDto } from './dto/toggle-interaction.dto';

@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Toggle an interaction based on type (follow, like, or bookmark).
   */
  async toggle(dto: ToggleInteractionDto) {
    switch (dto.type) {
      case 'follow':
        if (!dto.teacher_id) {
          throw new BadRequestException(
            'teacher_id is required for follow interactions',
          );
        }
        return this.toggleFollow(dto.user_id, dto.teacher_id);

      case 'like':
        if (!dto.content_type || !dto.content_id) {
          throw new BadRequestException(
            'content_type and content_id are required for like interactions',
          );
        }
        return this.toggleLike(dto.user_id, dto.content_type, dto.content_id);

      case 'bookmark':
        if (!dto.content_type || !dto.content_id) {
          throw new BadRequestException(
            'content_type and content_id are required for bookmark interactions',
          );
        }
        return this.toggleBookmark(
          dto.user_id,
          dto.content_type,
          dto.content_id,
        );
    }
  }

  /**
   * Toggle a follow relationship between a user and a teacher.
   */
  private async toggleFollow(userId: string, teacherId: string) {
    const { data: existing, error: fetchError } = await this.supabase.client
      .from('follows')
      .select('id')
      .eq('follower_id', userId)
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`Failed to check follow: ${fetchError.message}`);
      throw new InternalServerErrorException('Failed to check follow status');
    }

    if (existing) {
      const { error: deleteError } = await this.supabase.client
        .from('follows')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(`Failed to delete follow: ${deleteError.message}`);
        throw new InternalServerErrorException('Failed to remove follow');
      }

      return { active: false };
    }

    const { error: insertError } = await this.supabase.client
      .from('follows')
      .insert({ follower_id: userId, teacher_id: teacherId });

    if (insertError) {
      this.logger.error(`Failed to insert follow: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to create follow');
    }

    return { active: true };
  }

  /**
   * Toggle a like on a post or video_post and update the like_count.
   */
  private async toggleLike(
    userId: string,
    contentType: 'post' | 'video_post',
    contentId: string,
  ) {
    const tableName = contentType === 'video_post' ? 'video_posts' : 'posts';

    const { data: existing, error: fetchError } = await this.supabase.client
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`Failed to check like: ${fetchError.message}`);
      throw new InternalServerErrorException('Failed to check like status');
    }

    if (existing) {
      const { error: deleteError } = await this.supabase.client
        .from('likes')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(`Failed to delete like: ${deleteError.message}`);
        throw new InternalServerErrorException('Failed to remove like');
      }

      // Decrement like_count on the content table
      const { data: current } = await this.supabase.client
        .from(tableName)
        .select('like_count')
        .eq('id', contentId)
        .single();

      const { error: contentError } = await this.supabase.client
        .from(tableName)
        .update({ like_count: Math.max((current?.like_count ?? 0) - 1, 0) })
        .eq('id', contentId);

      if (contentError) {
        this.logger.warn(
          `Failed to decrement like_count: ${contentError.message}`,
        );
      }

      // Fetch updated count
      const { data: updated } = await this.supabase.client
        .from(tableName)
        .select('like_count')
        .eq('id', contentId)
        .single();

      return { active: false, count: updated?.like_count ?? 0 };
    }

    const { error: insertError } = await this.supabase.client
      .from('likes')
      .insert({
        user_id: userId,
        content_type: contentType,
        content_id: contentId,
      });

    if (insertError) {
      this.logger.error(`Failed to insert like: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to create like');
    }

    // Increment like_count on the content table
    const { data: current } = await this.supabase.client
      .from(tableName)
      .select('like_count')
      .eq('id', contentId)
      .single();

    const { error: contentError } = await this.supabase.client
      .from(tableName)
      .update({ like_count: (current?.like_count ?? 0) + 1 })
      .eq('id', contentId);

    if (contentError) {
      this.logger.warn(
        `Failed to increment like_count: ${contentError.message}`,
      );
    }

    // Fetch updated count
    const { data: updated } = await this.supabase.client
      .from(tableName)
      .select('like_count')
      .eq('id', contentId)
      .single();

    return { active: true, count: updated?.like_count ?? 0 };
  }

  /**
   * Toggle a bookmark on a post or video_post.
   */
  private async toggleBookmark(
    userId: string,
    contentType: 'post' | 'video_post',
    contentId: string,
  ) {
    const { data: existing, error: fetchError } = await this.supabase.client
      .from('bookmarks')
      .select('id')
      .eq('user_id', userId)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`Failed to check bookmark: ${fetchError.message}`);
      throw new InternalServerErrorException('Failed to check bookmark status');
    }

    if (existing) {
      const { error: deleteError } = await this.supabase.client
        .from('bookmarks')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(
          `Failed to delete bookmark: ${deleteError.message}`,
        );
        throw new InternalServerErrorException('Failed to remove bookmark');
      }

      return { active: false };
    }

    const { error: insertError } = await this.supabase.client
      .from('bookmarks')
      .insert({
        user_id: userId,
        content_type: contentType,
        content_id: contentId,
      });

    if (insertError) {
      this.logger.error(`Failed to insert bookmark: ${insertError.message}`);
      throw new InternalServerErrorException('Failed to create bookmark');
    }

    return { active: true };
  }
}
