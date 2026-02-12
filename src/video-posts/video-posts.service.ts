import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../database/supabase.service';
import { StorageService } from '../storage/storage.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateVideoPostDto } from './dto/create-video-post.dto';
import { UpdateVideoPostDto } from './dto/update-video-post.dto';
import { extractStoragePath } from '../common/utils/storage-path';

const VIDEO_POST_SELECT = `
  *,
  english_phrase:english_phrases(*),
  collaborators:video_post_collaborators(
    *,
    teacher:teachers(*)
  )
`;

@Injectable()
export class VideoPostsService {
  private readonly logger = new Logger(VideoPostsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * Parse collaborator_ids from a JSON array string or comma-separated string.
   */
  private parseCollaboratorIds(raw?: string): string[] {
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((id: unknown) => String(id).trim()).filter(Boolean);
      }
    } catch {
      // Not valid JSON, try comma-separated
    }

    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  /**
   * Parse captions from a JSON array string.
   * Validates each item has message (string), x (number 0-1), y (number 0-1).
   * Max 20 items.
   */
  private parseCaptions(
    raw?: string,
  ): Array<{ message: string; x: number; y: number }> | null {
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('captions must be a valid JSON array');
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException('captions must be an array');
    }

    if (parsed.length > 20) {
      throw new BadRequestException('captions must have at most 20 items');
    }

    return parsed.map((item: unknown, index: number) => {
      if (typeof item !== 'object' || item === null) {
        throw new BadRequestException(
          `captions[${index}] must be an object`,
        );
      }

      const obj = item as Record<string, unknown>;

      if (typeof obj.message !== 'string' || obj.message.trim() === '') {
        throw new BadRequestException(
          `captions[${index}].message must be a non-empty string`,
        );
      }

      if (typeof obj.x !== 'number' || obj.x < 0 || obj.x > 1) {
        throw new BadRequestException(
          `captions[${index}].x must be a number between 0 and 1`,
        );
      }

      if (typeof obj.y !== 'number' || obj.y < 0 || obj.y > 1) {
        throw new BadRequestException(
          `captions[${index}].y must be a number between 0 and 1`,
        );
      }

      return { message: obj.message.trim(), x: obj.x, y: obj.y };
    });
  }

  /**
   * Validate that the language is 'ko' or 'en'.
   */
  private validateLanguage(language?: string): void {
    if (language && language !== 'ko' && language !== 'en') {
      throw new BadRequestException(
        `Invalid language "${language}". Must be "ko" or "en".`,
      );
    }
  }

  /**
   * Verify a teacher exists by ID.
   */
  private async verifyTeacherExists(teacherId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('teachers')
      .select('id')
      .eq('id', teacherId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Teacher ${teacherId} not found`);
    }
  }

  /**
   * Verify all collaborator IDs exist as teachers.
   * Returns only the IDs that are valid.
   */
  private async verifyCollaboratorsExist(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.supabase.client
      .from('teachers')
      .select('id')
      .in('id', ids);

    if (error) {
      this.logger.error(`Failed to verify collaborators: ${error.message}`);
      return [];
    }

    return (data || []).map((t) => t.id);
  }

  /**
   * Verify an English phrase exists by ID.
   */
  private async verifyEnglishPhraseExists(phraseId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('english_phrases')
      .select('id')
      .eq('id', phraseId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`English phrase ${phraseId} not found`);
    }
  }

  /**
   * Fetch a complete video post with relations.
   */
  private async fetchVideoPostWithRelations(videoPostId: string) {
    const { data, error } = await this.supabase.client
      .from('video_posts')
      .select(VIDEO_POST_SELECT)
      .eq('id', videoPostId)
      .single();

    if (error) {
      this.logger.error(
        `Failed to fetch video post ${videoPostId}: ${error.message}`,
      );
      return null;
    }

    return data;
  }

  /**
   * Insert collaborator records for a video post.
   */
  private async insertCollaborators(
    videoPostId: string,
    ownerId: string,
    collaboratorIds: string[],
  ): Promise<void> {
    // Insert the owner
    const { error: ownerError } = await this.supabase.client
      .from('video_post_collaborators')
      .insert({
        video_post_id: videoPostId,
        teacher_id: ownerId,
        role: 'owner',
        display_order: 0,
      });

    if (ownerError) {
      this.logger.error(
        `Failed to insert owner collaborator for ${videoPostId}: ${ownerError.message}`,
      );
    }

    // Insert additional collaborators
    for (let i = 0; i < collaboratorIds.length; i++) {
      const { error } = await this.supabase.client
        .from('video_post_collaborators')
        .insert({
          video_post_id: videoPostId,
          teacher_id: collaboratorIds[i],
          role: 'collaborator',
          display_order: i + 1,
        });

      if (error) {
        this.logger.error(
          `Failed to insert collaborator ${collaboratorIds[i]} for ${videoPostId}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Create one or more video posts from uploaded video files.
   */
  async createVideoPost(
    dto: CreateVideoPostDto,
    videoFiles: Express.Multer.File[],
    thumbnailFile?: Express.Multer.File,
  ) {
    // 1. Parse collaborator IDs
    const collaboratorIds = this.parseCollaboratorIds(dto.collaborator_ids);

    // 2. Parse duration
    const durationMs = dto.duration_ms ? parseInt(dto.duration_ms, 10) : null;

    // 3. Parse captions
    const captions = this.parseCaptions(dto.captions);

    // 4. Validate language
    this.validateLanguage(dto.language);

    // 5. Verify teacher exists
    await this.verifyTeacherExists(dto.teacher_id);

    // 6. Verify collaborators exist
    const validCollaboratorIds =
      await this.verifyCollaboratorsExist(collaboratorIds);

    // 7. Verify english_phrase exists
    if (dto.english_phrase_id) {
      await this.verifyEnglishPhraseExists(dto.english_phrase_id);
    }

    // 8. Process each video file
    const createdPosts: any[] = [];

    for (let i = 0; i < videoFiles.length; i++) {
      const file = videoFiles[i];
      if (!file || !file.buffer) continue;

      const videoPostId = crypto.randomUUID();
      const ext = file.originalname.split('.').pop() || 'mp4';
      const storagePath = `${videoPostId}.${ext}`;

      // Upload video to "videos" bucket
      const uploadedPath = await this.storage.uploadFile(
        'videos',
        storagePath,
        file.buffer,
        file.mimetype,
      );

      if (!uploadedPath) {
        this.logger.error(
          `Failed to upload video ${i} for post ${videoPostId}`,
        );
        continue;
      }

      const videoUrl = this.storage.getPublicUrl('videos', uploadedPath);
      let thumbnailUrl: string | null = null;

      // Upload thumbnail (only for the first video)
      if (i === 0 && thumbnailFile && thumbnailFile.buffer) {
        const thumbExt =
          thumbnailFile.originalname.split('.').pop() || 'jpg';
        const thumbPath = `thumbnails/${videoPostId}.${thumbExt}`;

        const uploadedThumbPath = await this.storage.uploadFile(
          'images',
          thumbPath,
          thumbnailFile.buffer,
          thumbnailFile.mimetype,
        );

        if (uploadedThumbPath) {
          thumbnailUrl = this.storage.getPublicUrl('images', uploadedThumbPath);
        }
      }

      // Generate thumbnail via Cloudinary if none was provided or uploaded
      if (!thumbnailUrl) {
        thumbnailUrl = await this.cloudinary.generateVideoThumbnail(
          videoUrl,
          videoPostId,
        );
      }

      // Insert the video post record
      const { data: videoPost, error: postError } = await this.supabase.client
        .from('video_posts')
        .insert({
          id: videoPostId,
          teacher_id: dto.teacher_id,
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl,
          description: dto.description || null,
          duration_ms: durationMs,
          aspect_ratio: dto.aspect_ratio || '9:16',
          video_quality: dto.video_quality || 'hd',
          english_phrase_id: dto.english_phrase_id || null,
          language: dto.language || null,
          ...(captions !== null && { captions }),
        })
        .select()
        .single();

      if (postError) {
        this.logger.error(
          `Failed to insert video post ${videoPostId}: ${postError.message}`,
        );
        continue;
      }

      // Insert collaborators
      await this.insertCollaborators(
        videoPostId,
        dto.teacher_id,
        validCollaboratorIds,
      );

      // Fetch complete post with relations
      const completePost =
        await this.fetchVideoPostWithRelations(videoPostId);
      createdPosts.push(completePost || videoPost);
    }

    if (createdPosts.length === 0) {
      throw new InternalServerErrorException(
        'Failed to create any video posts',
      );
    }

    // Return single object if only one, array if multiple
    return createdPosts.length === 1 ? createdPosts[0] : createdPosts;
  }

  /**
   * Update an existing video post.
   */
  async updateVideoPost(
    videoPostId: string,
    dto: UpdateVideoPostDto,
    videoFile?: Express.Multer.File,
    thumbnailFile?: Express.Multer.File,
  ) {
    // 1. Fetch existing video post
    const { data: existing, error: fetchError } = await this.supabase.client
      .from('video_posts')
      .select('*')
      .eq('id', videoPostId)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException(`Video post ${videoPostId} not found`);
    }

    // 2. Build update object from provided fields only
    const updateData: Record<string, unknown> = {};

    if (dto.description !== undefined) {
      updateData.description = dto.description || null;
    }

    if (dto.duration_ms !== undefined) {
      updateData.duration_ms = parseInt(dto.duration_ms, 10) || null;
    }

    if (dto.aspect_ratio !== undefined) {
      updateData.aspect_ratio = dto.aspect_ratio;
    }

    if (dto.video_quality !== undefined) {
      updateData.video_quality = dto.video_quality;
    }

    if (dto.is_published !== undefined) {
      updateData.is_published = dto.is_published === 'true';
    }

    if (dto.language !== undefined) {
      this.validateLanguage(dto.language);
      updateData.language = dto.language || null;
    }

    if (dto.captions !== undefined) {
      const captions = this.parseCaptions(dto.captions);
      updateData.captions = captions ?? [];
    }

    // 3. Verify teacher exists if teacher_id provided
    if (dto.teacher_id) {
      await this.verifyTeacherExists(dto.teacher_id);
      updateData.teacher_id = dto.teacher_id;
    }

    // 4. Handle english_phrase_id
    if (dto.english_phrase_id !== undefined) {
      if (
        dto.english_phrase_id === null ||
        dto.english_phrase_id === 'null' ||
        dto.english_phrase_id === ''
      ) {
        updateData.english_phrase_id = null;
      } else {
        await this.verifyEnglishPhraseExists(dto.english_phrase_id);
        updateData.english_phrase_id = dto.english_phrase_id;
      }
    }

    // 5. Handle new video file
    if (videoFile && videoFile.buffer) {
      // Delete old video from storage
      const oldVideoPath = extractStoragePath(existing.video_url, 'videos');
      if (oldVideoPath) {
        await this.storage.deleteFiles('videos', [oldVideoPath]);
      }

      // Delete old thumbnail from storage
      const oldThumbPath = extractStoragePath(
        existing.thumbnail_url,
        'images',
      );
      if (oldThumbPath) {
        await this.storage.deleteFiles('images', [oldThumbPath]);
      }

      // Upload new video
      const ext = videoFile.originalname.split('.').pop() || 'mp4';
      const storagePath = `${videoPostId}.${ext}`;

      const uploadedPath = await this.storage.uploadFile(
        'videos',
        storagePath,
        videoFile.buffer,
        videoFile.mimetype,
      );

      if (uploadedPath) {
        const videoUrl = this.storage.getPublicUrl('videos', uploadedPath);
        updateData.video_url = videoUrl;

        // Handle thumbnail for new video
        if (thumbnailFile && thumbnailFile.buffer) {
          const thumbExt =
            thumbnailFile.originalname.split('.').pop() || 'jpg';
          const thumbPath = `thumbnails/${videoPostId}.${thumbExt}`;

          const uploadedThumbPath = await this.storage.uploadFile(
            'images',
            thumbPath,
            thumbnailFile.buffer,
            thumbnailFile.mimetype,
          );

          if (uploadedThumbPath) {
            updateData.thumbnail_url = this.storage.getPublicUrl(
              'images',
              uploadedThumbPath,
            );
          }
        } else {
          // Generate thumbnail via Cloudinary
          const generatedThumb =
            await this.cloudinary.generateVideoThumbnail(
              videoUrl,
              videoPostId,
            );
          if (generatedThumb) {
            updateData.thumbnail_url = generatedThumb;
          }
        }
      }
    } else if (thumbnailFile && thumbnailFile.buffer) {
      // 6. Only thumbnail file provided (no video change) -- replace thumbnail
      const oldThumbPath = extractStoragePath(
        existing.thumbnail_url,
        'images',
      );
      if (oldThumbPath) {
        await this.storage.deleteFiles('images', [oldThumbPath]);
      }

      const thumbExt =
        thumbnailFile.originalname.split('.').pop() || 'jpg';
      const thumbPath = `thumbnails/${videoPostId}.${thumbExt}`;

      const uploadedThumbPath = await this.storage.uploadFile(
        'images',
        thumbPath,
        thumbnailFile.buffer,
        thumbnailFile.mimetype,
      );

      if (uploadedThumbPath) {
        updateData.thumbnail_url = this.storage.getPublicUrl(
          'images',
          uploadedThumbPath,
        );
      }
    }

    // 7. Update video_posts table
    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await this.supabase.client
        .from('video_posts')
        .update(updateData)
        .eq('id', videoPostId);

      if (updateError) {
        this.logger.error(
          `Failed to update video post ${videoPostId}: ${updateError.message}`,
        );
        throw new InternalServerErrorException('Failed to update video post');
      }
    }

    // 8. Handle collaborator_ids update
    if (dto.collaborator_ids !== undefined) {
      const collaboratorIds = this.parseCollaboratorIds(dto.collaborator_ids);
      const validCollaboratorIds =
        await this.verifyCollaboratorsExist(collaboratorIds);

      // Delete all existing collaborators
      const { error: deleteError } = await this.supabase.client
        .from('video_post_collaborators')
        .delete()
        .eq('video_post_id', videoPostId);

      if (deleteError) {
        this.logger.error(
          `Failed to delete existing collaborators for ${videoPostId}: ${deleteError.message}`,
        );
      }

      // Re-insert owner + collaborators
      const ownerId = dto.teacher_id || existing.teacher_id;
      await this.insertCollaborators(
        videoPostId,
        ownerId,
        validCollaboratorIds,
      );
    }

    // 9. Fetch and return updated post with relations
    const updatedPost = await this.fetchVideoPostWithRelations(videoPostId);

    if (!updatedPost) {
      throw new InternalServerErrorException(
        'Failed to fetch updated video post',
      );
    }

    return updatedPost;
  }
}
