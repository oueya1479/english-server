import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly cloudName: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {
    this.cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');

    if (!this.cloudName) {
      this.logger.warn(
        'CLOUDINARY_CLOUD_NAME not set, thumbnail generation will be unavailable',
      );
    }
  }

  /**
   * Generate a video thumbnail via Cloudinary fetch and upload it to Supabase Storage.
   *
   * Uses Cloudinary's video fetch transformation to extract the first frame
   * at 720x1280 in JPEG format, then stores it in the "images" bucket
   * under `thumbnails/{videoPostId}.jpg`.
   *
   * @returns The public URL of the uploaded thumbnail, or null on failure.
   */
  async generateVideoThumbnail(
    videoUrl: string,
    videoPostId: string,
  ): Promise<string | null> {
    if (!this.cloudName) {
      this.logger.warn(
        'Skipping thumbnail generation: CLOUDINARY_CLOUD_NAME not configured',
      );
      return null;
    }

    try {
      const encodedVideoUrl = encodeURIComponent(videoUrl);
      const thumbnailUrl =
        `https://res.cloudinary.com/${this.cloudName}/video/fetch/so_0,w_720,h_1280,c_fill,f_jpg,q_80/${encodedVideoUrl}`;

      const response = await fetch(thumbnailUrl);

      if (!response.ok) {
        this.logger.error(
          `Cloudinary fetch failed for ${videoPostId}: HTTP ${response.status}`,
        );
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const storagePath = `thumbnails/${videoPostId}.jpg`;
      const uploadedPath = await this.storageService.uploadFile(
        'images',
        storagePath,
        buffer,
        'image/jpeg',
      );

      if (!uploadedPath) {
        this.logger.error(
          `Failed to upload thumbnail to storage for ${videoPostId}`,
        );
        return null;
      }

      const publicUrl = this.storageService.getPublicUrl('images', storagePath);
      this.logger.log(`Thumbnail generated for video post ${videoPostId}`);

      return publicUrl;
    } catch (error) {
      this.logger.error(
        `Thumbnail generation failed for ${videoPostId}: ${error}`,
      );
      return null;
    }
  }
}
