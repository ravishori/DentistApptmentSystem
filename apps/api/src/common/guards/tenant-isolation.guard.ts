import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, AppRequest } from '../types/request.types';

export const SKIP_TENANT_ISOLATION = 'skipTenantIsolation';

/**
 * Skip tenant isolation for a specific route.
 * Only for routes that are explicitly cross-tenant (super_admin tools).
 */
export const SkipTenantIsolation = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@nestjs/common').SetMetadata(SKIP_TENANT_ISOLATION, true);

/**
 * TenantIsolationGuard
 *
 * Verifies that the clinicId embedded in the JWT matches the clinicId resolved
 * by TenantMiddleware. This prevents a user from a clinic A calling an API with
 * a JWT from clinic B (cross-tenant leakage).
 *
 * super_admin bypasses isolation — they operate across all tenants.
 */
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  private readonly logger = new Logger(TenantIsolationGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_ISOLATION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req: AppRequest = ctx.switchToHttp().getRequest();

    // Public routes have no user attached
    if (!req.user) return true;

    const user: AuthenticatedUser = req.user;

    // super_admin can operate across tenants
    if (user.role === UserRole.super_admin) return true;

    // No clinic context yet (token not yet validated) — let JwtAuthGuard handle it
    if (!req.clinicId || !user.clinicId) return true;

    if (req.clinicId !== user.clinicId) {
      this.logger.warn(
        `Tenant isolation violation: user ${user.id} (clinic ${user.clinicId}) ` +
        `attempted access on clinic ${req.clinicId}`,
      );
      throw new ForbiddenException('Cross-tenant access denied');
    }

    return true;
  }
}
