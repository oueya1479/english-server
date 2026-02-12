import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../database/supabase.service';
import { StorageService } from '../storage/storage.service';
import { CreatePostDto } from './dto/create-post.dto';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Parse alt_texts JSON string into an array.
   * Returns an empty array on invalid input.
   */
  private parseAltTexts(raw?: string): string[] {
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not valid JSON
    }

    return [];
  }

  /**
   * Create a new post with optional image uploads.
   */
  async createPost(dto: CreatePostDto, images?: Express.Multer.File[]) {
    // 1. Verify teacher exists
    const { data: teacher, error: teacherError } = await this.supabase.client
      .from('teachers')
      .select('id')
      .eq('id', dto.teacher_id)
      .single();

    if (teacherError || !teacher) {
      throw new NotFoundException(`Teacher ${dto.teacher_id} not found`);
    }

    // 2. Insert post
    const postId = crypto.randomUUID();

    const { data: post, error: postError } = await this.supabase.client
      .from('posts')
      .insert({
        id: postId,
        teacher_id: dto.teacher_id,
        content: dto.content || null,
      })
      .select()
      .single();

    if (postError) {
      this.logger.error(`Failed to create post: ${postError.message}`);
      throw new InternalServerErrorException('Failed to create post');
    }

    // 3. Handle image uploads
    const altTexts = this.parseAltTexts(dto.alt_texts);
    const postImages: any[] = [];

    if (images && images.length > 0) {
      for (let index = 0; index < images.length; index++) {
        const file = images[index];
        if (!file || !file.buffer) continue;

        const ext = file.originalname.split('.').pop() || 'jpg';
        const storagePath = `posts/${postId}/${index}.${ext}`;

        const uploadedPath = await this.storage.uploadFile(
          'images',
          storagePath,
          file.buffer,
          file.mimetype,
        );

        if (!uploadedPath) {
          this.logger.warn(
            `Failed to upload image ${index} for post ${postId}`,
          );
          continue;
        }

        const imageUrl = this.storage.getPublicUrl('images', uploadedPath);

        const { data: postImage, error: imageError } =
          await this.supabase.client
            .from('post_images')
            .insert({
              post_id: postId,
              image_url: imageUrl,
              display_order: index,
              alt_text: altTexts[index] || null,
            })
            .select()
            .single();

        if (imageError) {
          this.logger.error(
            `Failed to insert post_image for post ${postId}: ${imageError.message}`,
          );
          continue;
        }

        postImages.push(postImage);
      }
    }

    return {
      ...post,
      post_images: postImages,
    };
  }
}
