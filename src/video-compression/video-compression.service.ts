import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

export interface CompressedVideo {
  buffer: Buffer;
  mimetype: string;
}

@Injectable()
export class VideoCompressionService implements OnModuleInit {
  private readonly logger = new Logger(VideoCompressionService.name);
  private ffmpegAvailable = false;

  onModuleInit() {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      this.ffmpegAvailable = true;
      this.logger.log('ffmpeg is available — video compression enabled');
    } catch {
      this.ffmpegAvailable = false;
      this.logger.warn(
        'ffmpeg not found — video compression disabled, uploads will use original files',
      );
    }
  }

  async compressVideo(
    buffer: Buffer,
    originalFilename: string,
  ): Promise<CompressedVideo> {
    if (!this.ffmpegAvailable) {
      return { buffer, mimetype: 'video/mp4' };
    }

    let tmpDir: string | null = null;

    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidcompress-'));
      const inputExt = path.extname(originalFilename) || '.mp4';
      const inputPath = path.join(tmpDir, `input${inputExt}`);
      const outputPath = path.join(tmpDir, 'output.mp4');

      await fs.writeFile(inputPath, buffer);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-c:v libx264',
            '-c:a aac',
            '-b:a 128k',
            '-crf 23',
            '-preset fast',
            '-profile:v high',
            '-pix_fmt yuv420p',
            '-movflags +faststart',
          ])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      const compressedBuffer = await fs.readFile(outputPath);

      const originalSize = buffer.length;
      const compressedSize = compressedBuffer.length;
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      if (compressedSize >= originalSize) {
        this.logger.log(
          `Compression not beneficial for ${originalFilename} ` +
            `(${originalSize} -> ${compressedSize} bytes), using original`,
        );
        return { buffer, mimetype: 'video/mp4' };
      }

      this.logger.log(
        `Compressed ${originalFilename}: ${originalSize} -> ${compressedSize} bytes (${ratio}% reduction)`,
      );

      return { buffer: compressedBuffer, mimetype: 'video/mp4' };
    } catch (error) {
      this.logger.error(
        `Video compression failed for ${originalFilename}: ${error}`,
      );
      return { buffer, mimetype: 'video/mp4' };
    } finally {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
