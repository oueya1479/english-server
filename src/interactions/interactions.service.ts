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
  private static readonly VALID_CONTENT_TYPES = ['post', 'video_post', 'quote'] as const;
  private readonly logger = new Logger(InteractionsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * content_type이 DB enum에 존재하는 유효한 값인지 검증한다.
   * DTO validation을 우회하는 경우에 대한 방어적 처리.
   */
  private validateContentType(
    contentType: string,
  ): contentType is 'post' | 'video_post' | 'quote' {
    return (
      InteractionsService.VALID_CONTENT_TYPES as readonly string[]
    ).includes(contentType);
  }

  /**
   * Toggle an interaction based on type (follow, like, or bookmark).
   */
  async toggle(userId: string, dto: ToggleInteractionDto) {
    switch (dto.type) {
      case 'follow':
        if (!dto.teacher_id) {
          throw new BadRequestException(
            'teacher_id is required for follow interactions',
          );
        }
        return this.toggleFollow(userId, dto.teacher_id);

      case 'like':
        if (!dto.content_type || !dto.content_id) {
          throw new BadRequestException(
            'content_type and content_id are required for like interactions',
          );
        }
        if (!this.validateContentType(dto.content_type)) {
          throw new BadRequestException(
            `Invalid content_type: "${dto.content_type}". Allowed values: ${InteractionsService.VALID_CONTENT_TYPES.join(', ')}`,
          );
        }
        return this.toggleLike(userId, dto.content_type, dto.content_id);

      case 'bookmark':
        if (!dto.content_type || !dto.content_id) {
          throw new BadRequestException(
            'content_type and content_id are required for bookmark interactions',
          );
        }
        if (!this.validateContentType(dto.content_type)) {
          throw new BadRequestException(
            `Invalid content_type: "${dto.content_type}". Allowed values: ${InteractionsService.VALID_CONTENT_TYPES.join(', ')}`,
          );
        }
        return this.toggleBookmark(userId, dto.content_type, dto.content_id);
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
      this.logger.error(
        `Failed to check follow: ${fetchError.message}`,
        fetchError,
      );
      throw new InternalServerErrorException('Failed to check follow status');
    }

    if (existing) {
      const { error: deleteError } = await this.supabase.client
        .from('follows')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(
          `Failed to delete follow: ${deleteError.message}`,
          deleteError,
        );
        throw new InternalServerErrorException('Failed to remove follow');
      }

      return { active: false };
    }

    const { error: insertError } = await this.supabase.client
      .from('follows')
      .insert({ follower_id: userId, teacher_id: teacherId });

    if (insertError) {
      this.logger.error(
        `Failed to insert follow: ${insertError.message}`,
        insertError,
      );
      throw new InternalServerErrorException('Failed to create follow');
    }

    return { active: true };
  }

  /**
   * Toggle a like on a post or video_post and update the like_count.
   */
  private async toggleLike(
    userId: string,
    contentType: 'post' | 'video_post' | 'quote',
    contentId: string,
  ) {
    const tableName =
      contentType === 'video_post'
        ? 'video_posts'
        : contentType === 'post'
          ? 'posts'
          : null;

    const { data: existing, error: fetchError } = await this.supabase.client
      .from('likes')
      .select('id')
      .eq('user_id', userId)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(
        `Failed to check like: ${fetchError.message}`,
        fetchError,
      );
      throw new InternalServerErrorException('Failed to check like status');
    }

    if (existing) {
      // Delete the like
      const { error: deleteError } = await this.supabase.client
        .from('likes')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(
          `Failed to delete like: ${deleteError.message}`,
          deleteError,
        );
        throw new InternalServerErrorException('Failed to remove like');
      }

      // Decrement like_count on the content table
      if (tableName) {
        await this.updateLikeCount(tableName, contentId, -1);
      }

      // Fetch updated count
      const count = tableName
        ? await this.getLikeCount(tableName, contentId)
        : 0;
      return { active: false, count };
    }

    // Insert the like
    const { error: insertError } = await this.supabase.client
      .from('likes')
      .insert({
        user_id: userId,
        content_type: contentType,
        content_id: contentId,
      });

    if (insertError) {
      this.logger.error(
        `Failed to insert like: ${insertError.message}`,
        insertError,
      );
      throw new InternalServerErrorException('Failed to create like');
    }

    // Increment like_count on the content table
    if (tableName) {
      await this.updateLikeCount(tableName, contentId, 1);
    }

    // Fetch updated count
    const count = tableName
      ? await this.getLikeCount(tableName, contentId)
      : 0;
    return { active: true, count };
  }

  /**
   * Toggle a bookmark on a post or video_post.
   */
  private async toggleBookmark(
    userId: string,
    contentType: 'post' | 'video_post' | 'quote',
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
      this.logger.error(
        `Failed to check bookmark: ${fetchError.message}`,
        fetchError,
      );
      throw new InternalServerErrorException(
        'Failed to check bookmark status',
      );
    }

    if (existing) {
      const { error: deleteError } = await this.supabase.client
        .from('bookmarks')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(
          `Failed to delete bookmark: ${deleteError.message}`,
          deleteError,
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
      this.logger.error(
        `Failed to insert bookmark: ${insertError.message}`,
        insertError,
      );
      throw new InternalServerErrorException('Failed to create bookmark');
    }

    return { active: true };
  }

  /**
   * Update like_count on the content table by delta (+1 or -1).
   * Uses select-then-update pattern with error handling.
   */
  private async updateLikeCount(
    tableName: string,
    contentId: string,
    delta: number,
  ) {
    try {
      const { data: current, error: selectError } =
        await this.supabase.client
          .from(tableName)
          .select('like_count')
          .eq('id', contentId)
          .single();

      if (selectError) {
        this.logger.warn(
          `Failed to get ${tableName} like_count for update: ${selectError.message}`,
        );
        return;
      }

      const newCount = Math.max((current?.like_count ?? 0) + delta, 0);

      const { error: updateError } = await this.supabase.client
        .from(tableName)
        .update({ like_count: newCount })
        .eq('id', contentId);

      if (updateError) {
        this.logger.warn(
          `Failed to update ${tableName} like_count: ${updateError.message}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Unexpected error updating like_count on ${tableName}: ${err}`,
      );
    }
  }

  /**
   * Get the current like_count from the content table.
   */
  private async getLikeCount(
    tableName: string,
    contentId: string,
  ): Promise<number> {
    try {
      const { data, error } = await this.supabase.client
        .from(tableName)
        .select('like_count')
        .eq('id', contentId)
        .single();

      if (error) {
        this.logger.warn(
          `Failed to fetch ${tableName} like_count: ${error.message}`,
        );
        return 0;
      }

      return data?.like_count ?? 0;
    } catch (err) {
      this.logger.warn(
        `Unexpected error fetching like_count from ${tableName}: ${err}`,
      );
      return 0;
    }
  }
}
