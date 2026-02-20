import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../database/supabase.service';
import { StorageService } from '../storage/storage.service';
import { extractStoragePath } from '../common/utils/storage-path';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { DeleteTeacherDto } from './dto/delete-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

@Injectable()
export class TeachersService {
  private readonly logger = new Logger(TeachersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Parse specialization string into a JSON array.
   * Accepts a JSON array string (e.g. '["grammar","vocab"]')
   * or a comma-separated string (e.g. 'grammar, vocab').
   */
  private parseSpecialization(raw?: string): string[] | null {
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not valid JSON -- fall through to comma-separated parsing
    }

    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * List all teachers.
   */
  async findAll() {
    const { data, error } = await this.supabase.client
      .from('teachers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch teachers: ${error.message}`);
      throw new InternalServerErrorException('Failed to fetch teachers');
    }

    return data;
  }

  /**
   * Get a single teacher by ID.
   */
  async findOne(id: string) {
    const { data, error } = await this.supabase.client
      .from('teachers')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Teacher ${id} not found`);
    }

    return data;
  }

  /**
   * Update a teacher with optional profile image replacement.
   */
  async updateTeacher(
    id: string,
    dto: UpdateTeacherDto,
    profileImage?: Express.Multer.File,
  ) {
    // Verify teacher exists
    const { data: existing, error: fetchError } = await this.supabase.client
      .from('teachers')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException(`Teacher ${id} not found`);
    }

    const updates: Record<string, unknown> = {};

    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.bio !== undefined) updates.bio = dto.bio;
    if (dto.specialization !== undefined) {
      updates.specialization = this.parseSpecialization(dto.specialization);
    }

    // Handle profile image replacement
    if (profileImage) {
      const ext = profileImage.originalname.split('.').pop() || 'jpg';
      const storagePath = `teachers/${id}.${ext}`;

      // Upload new image first (before deleting old one)
      const uploadedPath = await this.storage.uploadFile(
        'images',
        storagePath,
        profileImage.buffer,
        profileImage.mimetype,
      );

      if (!uploadedPath) {
        throw new InternalServerErrorException(
          'Failed to upload profile image',
        );
      }

      // Delete old image only after successful upload (skip if same path)
      const oldPath = extractStoragePath(existing.profile_image_url, 'images');
      if (oldPath && oldPath !== uploadedPath) {
        await this.storage.deleteFiles('images', [oldPath]);
      }

      const publicUrl = this.storage.getPublicUrl('images', uploadedPath);
      updates.profile_image_url = `${publicUrl}?v=${Date.now()}`;
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const { data, error } = await this.supabase.client
      .from('teachers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to update teacher: ${error.message}`);
      throw new InternalServerErrorException('Failed to update teacher');
    }

    return data;
  }

  /**
   * Create a new teacher with an optional profile image.
   */
  async createTeacher(
    dto: CreateTeacherDto,
    profileImage?: Express.Multer.File,
  ) {
    const teacherId = crypto.randomUUID();
    let profileImageUrl: string | null = null;

    // Upload profile image if provided
    if (profileImage) {
      const ext = profileImage.originalname.split('.').pop() || 'jpg';
      const storagePath = `teachers/${teacherId}.${ext}`;

      const uploadedPath = await this.storage.uploadFile(
        'images',
        storagePath,
        profileImage.buffer,
        profileImage.mimetype,
      );

      if (!uploadedPath) {
        throw new InternalServerErrorException(
          'Failed to upload profile image',
        );
      }

      const publicUrl = this.storage.getPublicUrl('images', uploadedPath);
      profileImageUrl = `${publicUrl}?v=${Date.now()}`;
    }

    const specialization = this.parseSpecialization(dto.specialization);

    const { data, error } = await this.supabase.client
      .from('teachers')
      .insert({
        id: teacherId,
        name: dto.name,
        bio: dto.bio || null,
        specialization,
        profile_image_url: profileImageUrl,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create teacher: ${error.message}`);
      throw new InternalServerErrorException('Failed to create teacher');
    }

    return data;
  }

  /**
   * Delete a teacher and optionally cascade-delete all associated storage files.
   */
  async deleteTeacher(dto: DeleteTeacherDto) {
    const { teacher_id, cascade } = dto;

    // Verify teacher exists
    const { data: teacher, error: fetchError } = await this.supabase.client
      .from('teachers')
      .select('id, profile_image_url')
      .eq('id', teacher_id)
      .single();

    if (fetchError || !teacher) {
      throw new NotFoundException(`Teacher ${teacher_id} not found`);
    }

    let deletedFilesCount = 0;

    if (cascade) {
      const imagePathsToDelete: string[] = [];
      const videoPathsToDelete: string[] = [];

      // Collect profile image path
      const profilePath = extractStoragePath(
        teacher.profile_image_url,
        'images',
      );
      if (profilePath) {
        imagePathsToDelete.push(profilePath);
      }

      // Fetch video_posts for this teacher
      const { data: videoPosts } = await this.supabase.client
        .from('video_posts')
        .select('id, video_url, thumbnail_url')
        .eq('teacher_id', teacher_id);

      if (videoPosts) {
        for (const vp of videoPosts) {
          const videoPath = extractStoragePath(vp.video_url, 'videos');
          if (videoPath) videoPathsToDelete.push(videoPath);

          const thumbPath = extractStoragePath(vp.thumbnail_url, 'images');
          if (thumbPath) imagePathsToDelete.push(thumbPath);
        }
      }

      // Fetch posts and their images for this teacher
      const { data: posts } = await this.supabase.client
        .from('posts')
        .select('id, post_images(id, image_url)')
        .eq('teacher_id', teacher_id);

      if (posts) {
        for (const post of posts) {
          const postImages = (post as any).post_images;
          if (Array.isArray(postImages)) {
            for (const img of postImages) {
              const imgPath = extractStoragePath(img.image_url, 'images');
              if (imgPath) imagePathsToDelete.push(imgPath);
            }
          }
        }
      }

      // Delete files from storage buckets
      if (imagePathsToDelete.length > 0) {
        const imageSuccess = await this.storage.deleteFiles(
          'images',
          imagePathsToDelete,
        );
        if (imageSuccess) deletedFilesCount += imagePathsToDelete.length;
      }

      if (videoPathsToDelete.length > 0) {
        const videoSuccess = await this.storage.deleteFiles(
          'videos',
          videoPathsToDelete,
        );
        if (videoSuccess) deletedFilesCount += videoPathsToDelete.length;
      }
    }

    // Delete teacher from DB (CASCADE handles related DB records)
    const { error: deleteError } = await this.supabase.client
      .from('teachers')
      .delete()
      .eq('id', teacher_id);

    if (deleteError) {
      this.logger.error(`Failed to delete teacher: ${deleteError.message}`);
      throw new InternalServerErrorException('Failed to delete teacher');
    }

    return {
      deleted_teacher_id: teacher_id,
      deleted_files: deletedFilesCount,
    };
  }
}
