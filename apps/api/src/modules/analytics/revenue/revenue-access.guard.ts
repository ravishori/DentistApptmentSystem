import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AppRequest } from '../../../common/types/request.types';
import { RevenueAccessService } from './revenue-access.service';

/**
 * Route guard for revenue analytics. Runs AFTER the global JwtAuthGuard/TenantIsolationGuard, so
 * `req.user` is the verified identity. Fails closed: no user, or no owner role / explicit grant → 403.
 * The 403 body is deliberately generic and carries no financial information.
 */
@Injectable()
export class RevenueAccessGuard implements CanActivate {
  constructor(private readonly access: RevenueAccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    // Use the verified clinic from the token — never a clinic id supplied by the client
    const viewer = req.user ? { id: req.user.id, role: req.user.role, clinicId: req.user.clinicId } : null;
    if (!(await this.access.canView(viewer))) {
      throw new ForbiddenException('You do not have access to revenue analytics');
    }
    return true;
  }
}
