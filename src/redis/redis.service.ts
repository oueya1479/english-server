import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (redisUrl) {
      this.client = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
      this.client.on('connect', () => this.logger.log('Redis connected'));
      this.client.on('error', (err) => this.logger.error('Redis error', err));
    } else {
      this.logger.warn('REDIS_URL not set, using in-memory fallback');
      this.client = new Redis({ lazyConnect: true });
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /** Acquire a distributed lock. Returns true if acquired. */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Release a distributed lock. */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Cache JSON with TTL. */
  async cacheJson(key: string, data: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  }

  /** Get cached JSON. */
  async getCachedJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  /** Check rate limit. Returns true if allowed. */
  async checkRateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const current = await this.client.incr(key);
    if (current === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return current <= maxRequests;
  }
}
