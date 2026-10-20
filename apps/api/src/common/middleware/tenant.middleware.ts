import {
  Injectable, NestMiddleware, UnauthorizedException, ForbiddenException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { AppRequest } from '../types/request.types';
import { setContextActor } from '../observability/context-store';

/**
 * TenantMiddleware — resolves and validates the clinic context on every request.
 *
 * Flow:
 *  1. Extract Bearer token from Authorization header.
 *  2. Decode payload — extract clinicId, userId, role.
 *  3. Load clinic from Redis cache (TTL 5 min) or Postgres.
 *  4. Validate clinic is active and subscription is not cancelled.
 *  5. Attach { user, clinicId } to request for downstream use.
 *
 * Public routes (no token) pass through without clinic context.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly jwt:    JwtService,
    private readonly prisma: PrismaService,
    private readonly cache:  CacheService,
    private readonly config: ConfigService,
  ) {}

  async use(req: AppRequest, _res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];

    // ── No token — let JwtAuthGuard reject protected routes later ─────────────
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    // ── Decode (don't verify here — JwtAuthGuard does that) ──────────────────
    let payload: any;
    try {
      payload = this.jwt.decode(token) as any;
    } catch {
      return next();
    }

    if (!payload?.clinicId || !payload?.sub) return next();

    // ── Load clinic (cache-aside) ─────────────────────────────────────────────
    const cacheKey = CacheService.keys.clinicProfile(payload.clinicId);
    let clinic = await this.cache.get<{ id: string; isActive: boolean; subStatus: string; name: string; slug: string }>(cacheKey);

    if (!clinic) {
      clinic = await this.prisma.clinic.findUnique({
        where: { id: payload.clinicId },
        select: { id: true, isActive: true, subStatus: true, name: true, slug: true },
      });
      if (clinic) await this.cache.set(cacheKey, clinic, 300);
    }

    if (!clinic) {
      throw new UnauthorizedException('Clinic not found');
    }

    if (!clinic.isActive) {
      throw new ForbiddenException('Clinic account is deactivated');
    }

    if (clinic.subStatus === 'cancelled') {
      throw new ForbiddenException('Clinic subscription has been cancelled');
    }

    // ── Attach to request ─────────────────────────────────────────────────────
    req.clinicId = clinic.id;
    req.user = {
      id:         payload.sub,
      email:      payload.email,
      role:       payload.role,
      clinicId:   clinic.id,
      clinicSlug: clinic.slug,
      clinicName: clinic.name,
    };

    setContextActor(payload.sub, clinic.id);
    next();
  }
}
