import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseService } from '../../database/supabase.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly adminApiKey?: string;

  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    this.adminApiKey = this.configService.get<string>('ADMIN_API_KEY');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    // Admin API key bypass — skip Supabase user verification
    if (this.adminApiKey && token === this.adminApiKey) {
      request.user = { id: 'admin', email: 'admin', role: 'admin' };
      return true;
    }

    const { data, error } = await this.supabaseService.client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = data.user;
    return true;
  }
}
