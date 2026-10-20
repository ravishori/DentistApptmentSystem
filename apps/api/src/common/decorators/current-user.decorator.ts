import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, AppRequest } from '../types/request.types';

/** Injects the full authenticated user into a controller parameter */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<AppRequest>().user,
);

/** Injects only the tenant's clinicId — shorthand for the most common use-case */
export const ClinicId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<AppRequest>().clinicId,
);

/** Injects the authenticated user's id */
export const UserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<AppRequest>().user?.id,
);
