import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { GetRandomVideosDto } from './dto/get-random-videos.dto';
import { GetFollowingVideosDto } from './dto/get-following-videos.dto';
import { GetMixmatchPairsDto } from './dto/get-mixmatch-pairs.dto';
import { GetTeacherVideosDto } from './dto/get-teacher-videos.dto';

const VIDEO_SELECT = `
  id,
  teacher_id,
  description,
  video_url,
  thumbnail_url,
  duration_ms,
  view_count,
  like_count,
  comment_count,
  share_count,
  is_published,
  aspect_ratio,
  video_quality,
  created_at,
  updated_at,
  english_phrase_id,
  language,
  captions,
  teacher:teachers!inner(id, name, profile_image_url, is_verified, bio, specialization),
  collaborators:video_post_collaborators(role, display_order, teacher:teachers(id, name, profile_image_url, is_verified, bio, specialization)),
  english_phrase:english_phrases(id, category, korean, english, description)
`;

@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getRandomVideos(dto: GetRandomVideosDto) {
    const { data, error } = await this.supabase.client.rpc('get_random_videos', {
      p_seed: dto.seed,
      p_limit: dto.limit ?? 10,
      p_offset: dto.offset ?? 0,
    });

    if (error) {
      this.logger.error(`Failed to get random videos: ${error.message}`);
      throw new InternalServerErrorException('Failed to get random videos');
    }

    return data ?? [];
  }

  async getFollowingVideos(dto: GetFollowingVideosDto) {
    const { data, error } = await this.supabase.client.rpc('get_following_videos', {
      p_user_id: dto.user_id,
      p_seed: dto.seed,
      p_limit: dto.limit ?? 10,
      p_offset: dto.offset ?? 0,
    });

    if (error) {
      this.logger.error(`Failed to get following videos: ${error.message}`);
      throw new InternalServerErrorException('Failed to get following videos');
    }

    return data ?? [];
  }

  async getMixmatchPairs(dto: GetMixmatchPairsDto) {
    const limit = dto.pair_limit ?? 5;

    // Step 1: Get phrase IDs that have published ko videos
    const { data: koData, error: koError } = await this.supabase.client
      .from('video_posts')
      .select('english_phrase_id')
      .eq('is_published', true)
      .eq('language', 'ko')
      .not('english_phrase_id', 'is', null);

    if (koError) {
      this.logger.error(`Failed to get ko phrases: ${koError.message}`);
      throw new InternalServerErrorException('Failed to get mixmatch pairs');
    }

    // Step 2: Get phrase IDs that have published en videos
    const { data: enData, error: enError } = await this.supabase.client
      .from('video_posts')
      .select('english_phrase_id')
      .eq('is_published', true)
      .eq('language', 'en')
      .not('english_phrase_id', 'is', null);

    if (enError) {
      this.logger.error(`Failed to get en phrases: ${enError.message}`);
      throw new InternalServerErrorException('Failed to get mixmatch pairs');
    }

    // Step 3: Find phrases with both ko and en videos
    const koIds = new Set(koData.map((r) => r.english_phrase_id));
    const bothIds = [
      ...new Set(
        enData
          .map((r) => r.english_phrase_id)
          .filter((id) => koIds.has(id)),
      ),
    ];

    if (bothIds.length === 0) return [];

    // Shuffle and pick
    const selectedIds = this.shuffle(bothIds).slice(0, limit);

    // Step 4: Get phrase details
    const { data: phrases, error: phraseError } = await this.supabase.client
      .from('english_phrases')
      .select('id, korean, english, category')
      .in('id', selectedIds);

    if (phraseError) {
      this.logger.error(`Failed to get phrases: ${phraseError.message}`);
      throw new InternalServerErrorException('Failed to get mixmatch pairs');
    }

    // Step 5: Get videos for selected phrases (both ko and en)
    const videoSelect = `
      id,
      teacher_id,
      description,
      video_url,
      thumbnail_url,
      duration_ms,
      view_count,
      like_count,
      comment_count,
      share_count,
      aspect_ratio,
      created_at,
      language,
      english_phrase_id,
      captions,
      teacher:teachers(id, name, profile_image_url, is_verified, bio, specialization),
      collaborators:video_post_collaborators(teacher_id, role, display_order, teacher:teachers(id, name, profile_image_url, is_verified, bio, specialization))
    `;

    const { data: videos, error: videoError } = await this.supabase.client
      .from('video_posts')
      .select(videoSelect)
      .in('english_phrase_id', selectedIds)
      .eq('is_published', true)
      .in('language', ['ko', 'en'])
      .order('created_at', { ascending: false });

    if (videoError) {
      this.logger.error(`Failed to get videos: ${videoError.message}`);
      throw new InternalServerErrorException('Failed to get mixmatch pairs');
    }

    // Step 6: Group videos by phrase and language, pick most recent per pair
    const videoMap = new Map<string, { ko: any; en: any }>();
    for (const video of videos ?? []) {
      const phraseId = video.english_phrase_id;
      if (!videoMap.has(phraseId)) {
        videoMap.set(phraseId, { ko: null, en: null });
      }
      const entry = videoMap.get(phraseId)!;
      if (video.language === 'ko' && !entry.ko) entry.ko = video;
      if (video.language === 'en' && !entry.en) entry.en = video;
    }

    // Step 7: Build response
    return (phrases ?? [])
      .map((phrase) => {
        const pair = videoMap.get(phrase.id);
        if (!pair?.ko || !pair?.en) return null;
        return {
          phrase_id: phrase.id,
          korean: phrase.korean,
          english: phrase.english,
          category: phrase.category,
          ko_video: pair.ko,
          en_video: pair.en,
        };
      })
      .filter(Boolean);
  }

  async getTeacherVideos(teacherId: string, dto: GetTeacherVideosDto) {
    const limit = dto.feed_limit ?? 10;
    const offset = dto.feed_offset ?? 0;

    // Get videos where teacher is main or collaborator
    const { data: mainVideos, error: mainError } = await this.supabase.client
      .from('video_posts')
      .select(VIDEO_SELECT)
      .eq('is_published', true)
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false });

    if (mainError) {
      this.logger.error(`Failed to get teacher main videos: ${mainError.message}`);
      throw new InternalServerErrorException('Failed to get teacher videos');
    }

    // Get videos where teacher is a collaborator
    const { data: collabVideoIds, error: collabIdError } =
      await this.supabase.client
        .from('video_post_collaborators')
        .select('video_post_id')
        .eq('teacher_id', teacherId);

    if (collabIdError) {
      this.logger.error(
        `Failed to get collab video IDs: ${collabIdError.message}`,
      );
      throw new InternalServerErrorException('Failed to get teacher videos');
    }

    const collabIds = (collabVideoIds ?? [])
      .map((c) => c.video_post_id)
      .filter((id) => !(mainVideos ?? []).some((v) => v.id === id));

    let collabVideos: any[] = [];
    if (collabIds.length > 0) {
      const { data, error } = await this.supabase.client
        .from('video_posts')
        .select(VIDEO_SELECT)
        .eq('is_published', true)
        .in('id', collabIds)
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error(`Failed to get collab videos: ${error.message}`);
        throw new InternalServerErrorException('Failed to get teacher videos');
      }

      collabVideos = data ?? [];
    }

    // Merge, deduplicate, sort by created_at DESC, apply pagination
    const allVideos = [...(mainVideos ?? []), ...collabVideos].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return allVideos.slice(offset, offset + limit);
  }

  async getTeacherVideoCount(teacherId: string) {
    // Count main videos
    const { count: mainCount, error: mainError } = await this.supabase.client
      .from('video_posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true)
      .eq('teacher_id', teacherId);

    if (mainError) {
      this.logger.error(
        `Failed to get teacher video count: ${mainError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to get teacher video count',
      );
    }

    // Count collab videos (distinct)
    const { data: collabIds, error: collabError } = await this.supabase.client
      .from('video_post_collaborators')
      .select('video_post_id')
      .eq('teacher_id', teacherId);

    if (collabError) {
      this.logger.error(
        `Failed to get collab video count: ${collabError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to get teacher video count',
      );
    }

    // Filter collab videos that are published and not already counted as main
    let additionalCount = 0;
    if (collabIds && collabIds.length > 0) {
      const { count, error } = await this.supabase.client
        .from('video_posts')
        .select('id', { count: 'exact', head: true })
        .eq('is_published', true)
        .in(
          'id',
          collabIds.map((c) => c.video_post_id),
        )
        .neq('teacher_id', teacherId);

      if (error) {
        this.logger.error(
          `Failed to count collab videos: ${error.message}`,
        );
      } else {
        additionalCount = count ?? 0;
      }
    }

    return (mainCount ?? 0) + additionalCount;
  }

  private shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
