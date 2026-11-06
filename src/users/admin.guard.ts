import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.service.js';

type AdminRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (request.user?.type !== 'admin') {
      throw new ForbiddenException('Administrator access required');
    }
    return true;
  }
}
