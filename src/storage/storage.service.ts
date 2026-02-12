import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Upload a file to Supabase Storage.
   * @returns The storage path on success, or null on failure.
   */
  async uploadFile(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      this.logger.error(
        `Failed to upload file to ${bucket}/${path}: ${error.message}`,
      );
      return null;
    }

    return data.path;
  }

  /**
   * Delete one or more files from Supabase Storage.
   * @returns True if all deletions succeeded.
   */
  async deleteFiles(bucket: string, paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;

    const { error } = await this.supabase.client.storage
      .from(bucket)
      .remove(paths);

    if (error) {
      this.logger.error(
        `Failed to delete files from ${bucket}: ${error.message}`,
      );
      return false;
    }

    return true;
  }

  /**
   * Get the public URL for a file in Supabase Storage.
   */
  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.supabase.client.storage
      .from(bucket)
      .getPublicUrl(path);

    return data.publicUrl;
  }
}
