import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PERMISSIONS_KEY, Permission } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../types/request.types';

/**
 * Permission matrix per role.
 *
 * super_admin and clinic_admin bypass all checks (handled below).
 * dentist and receptionist each have a specific whitelist.
 */
export const ROLE_PERMISSIONS: Record<string, Set<Permission>> = {
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

/** True when the role holds the permission (owners/admins hold every permission). */
export function roleHasPermission(role: UserRole | string | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === UserRole.super_admin || role === UserRole.clinic_admin) return true;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

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

    // @Public() routes (payment-checkout callback, webhooks) are unauthenticated by design: they carry no user,
    // so a class-level permission must not be evaluated (it used to crash with a TypeError → HTTP 500).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const user: AuthenticatedUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Authentication required');

    // Admins have all permissions
    if (
      user.role === UserRole.super_admin ||
      user.role === UserRole.clinic_admin
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
