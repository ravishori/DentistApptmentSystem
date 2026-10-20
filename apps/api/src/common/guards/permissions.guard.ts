import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PERMISSIONS_KEY, Permission } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../types/request.types';

/**
 * Permission matrix per role.
 *
 * super_admin and clinic_admin bypass all checks (handled below).
 * dentist and receptionist each have a specific whitelist.
 */
const ROLE_PERMISSIONS: Record<string, Set<Permission>> = {
  dentist: new Set<Permission>([
    'patients:read',
    'appointments:read', 'appointments:write',
    'treatments:read',   'treatments:write',
    'billing:read',
    'whatsapp:send',
    'analytics:read',
  ]),

  receptionist: new Set<Permission>([
    'patients:read',     'patients:write',
    'appointments:read', 'appointments:write',
    'treatments:read',
    'billing:read',      'billing:write',
    'whatsapp:send',
    'analytics:read',
  ]),
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // No @RequirePermission() — pass through to RolesGuard
    if (!required?.length) return true;

    const user: AuthenticatedUser = ctx.switchToHttp().getRequest().user;

    // Admins have all permissions
    if (
      user.role === UserRole.super_admin ||
      user.role === UserRole.clinic_admin ||
      (user.role as string) === 'admin'
    ) {
      return true;
    }

    const granted = ROLE_PERMISSIONS[user.role] ?? new Set();
    const missing  = required.filter((p) => !granted.has(p));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Role '${user.role}' lacks permission: ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
