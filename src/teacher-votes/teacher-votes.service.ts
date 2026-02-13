import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class TeacherVotesService {
  private readonly logger = new Logger(TeacherVotesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Get unverified teachers that the user has not yet voted on.
   */
  async getVotableTeachers(userId: string, limit: number) {
    // Step 1: Get teacher IDs that the user already voted on
    const { data: votedRows, error: votedError } = await this.supabase.client
      .from('teacher_votes')
      .select('teacher_id')
      .eq('user_id', userId);

    if (votedError) {
      this.logger.error(
        `Failed to get voted teachers: ${votedError.message}`,
      );
      throw new InternalServerErrorException('Failed to get votable teachers');
    }

    const votedTeacherIds = (votedRows ?? []).map((row) => row.teacher_id);

    // Step 2: Query unverified active teachers excluding already-voted ones
    let query = this.supabase.client
      .from('teachers')
      .select('id, name, profile_image_url, bio, specialization')
      .eq('is_verified', false)
      .eq('is_active', true)
      .limit(limit);

    if (votedTeacherIds.length > 0) {
      query = query.not('id', 'in', `(${votedTeacherIds.join(',')})`);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(
        `Failed to get votable teachers: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to get votable teachers');
    }

    return data ?? [];
  }

  /**
   * Get the current user's vote for a specific teacher.
   * Returns the vote row if found, or null if the user hasn't voted.
   */
  async getUserVote(userId: string, teacherId: string) {
    const { data, error } = await this.supabase.client
      .from('teacher_votes')
      .select('*')
      .eq('user_id', userId)
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to get user vote: ${error.message}`);
      throw new InternalServerErrorException('Failed to get user vote');
    }

    return data;
  }

  /**
   * Submit a vote (up or down) for a teacher with toggle support.
   *
   * - No existing vote → insert new vote
   * - Existing vote with SAME voteType → delete (toggle cancel), return { cancelled: true }
   * - Existing vote with DIFFERENT voteType → update to new voteType
   */
  async submitVote(
    userId: string,
    teacherId: string,
    voteType: 'up' | 'down',
  ) {
    // Step 1: Check for an existing vote
    const { data: existing, error: fetchError } = await this.supabase.client
      .from('teacher_votes')
      .select('id, vote_type')
      .eq('user_id', userId)
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error(
        `Failed to fetch existing vote: ${fetchError.message}`,
      );
      throw new InternalServerErrorException('Failed to submit vote');
    }

    // Branch 1: No existing vote → insert
    if (!existing) {
      const { data, error } = await this.supabase.client
        .from('teacher_votes')
        .insert({
          user_id: userId,
          teacher_id: teacherId,
          vote_type: voteType,
        })
        .select()
        .single();

      if (error) {
        this.logger.error(`Failed to insert vote: ${error.message}`);
        throw new InternalServerErrorException('Failed to submit vote');
      }

      return data;
    }

    // Branch 2: Same voteType → delete (toggle cancel)
    if (existing.vote_type === voteType) {
      const { error: deleteError } = await this.supabase.client
        .from('teacher_votes')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        this.logger.error(`Failed to delete vote: ${deleteError.message}`);
        throw new InternalServerErrorException('Failed to cancel vote');
      }

      return { cancelled: true };
    }

    // Branch 3: Different voteType → update
    const { data: updated, error: updateError } = await this.supabase.client
      .from('teacher_votes')
      .update({ vote_type: voteType })
      .eq('id', existing.id)
      .select()
      .single();

    if (updateError) {
      this.logger.error(`Failed to update vote: ${updateError.message}`);
      throw new InternalServerErrorException('Failed to update vote');
    }

    return updated;
  }
}
