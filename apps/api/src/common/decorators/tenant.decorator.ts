import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';

/**
 * The clinic (tenant) of the VERIFIED caller. Fails closed.
 *
 * It used to read `request.tenantId`, which nothing ever sets (the middleware and JWT strategy set `clinicId`), so it was
 * always `undefined` — and a Prisma `where: { clinicId: undefined }` silently drops the filter and matches EVERY clinic.
 * The controllers that use it (treatments, users, tenant) are not mounted in AppModule today, so this was latent; it
 * must be correct before any of them is mounted.
 */
export function resolveTenantId(request: { user?: { clinicId?: string }; clinicId?: string }): string {
  const id = request.user?.clinicId ?? request.clinicId;
  if (!id) throw new ForbiddenException('Clinic context is required');
  return id;
}

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => resolveTenantId(ctx.switchToHttp().getRequest()),
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
