import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/request.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // No @Roles() decorator — any authenticated user passes
    if (!required?.length) return true;

    const user: AuthenticatedUser = ctx.switchToHttp().getRequest().user;

    // super_admin bypasses all role checks
    if (user.role === UserRole.super_admin) return true;

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' is not allowed. Required: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
