import {
  Injectable, UnauthorizedException, ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { TokenBlacklistService } from '../../cache/token-blacklist.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma:     PrismaService,
    private readonly jwt:        JwtService,
    private readonly config:     ConfigService,
    private readonly cache:      CacheService,
    private readonly blacklist:  TokenBlacklistService,
  ) {}

  // ── Register ──────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const exists = await this.prisma.clinic.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('Email already registered');

    const slug = this.buildSlug(dto.clinicName);

    const clinic = await this.prisma.clinic.create({
      data: {
        slug,
        name:      dto.clinicName,
        ownerName: dto.ownerName,
        email:     dto.email,
        phone:     dto.phone,
        city:      dto.city,
        plan:      'starter',
        subStatus: 'trial',
        trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        clinicId:     clinic.id,
        fullName:     dto.ownerName,
        email:        dto.email,
        phone:        dto.phone,
        passwordHash,
        role:         'clinic_admin',
      },
    });

    return this.buildTokenPair(user, clinic);
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        ...(dto.clinicSlug
          ? { clinic: { slug: dto.clinicSlug } }
          : {}),
      },
      include: { clinic: true },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account deactivated');

    // Brute-force protection
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        `Account locked until ${user.lockedUntil.toISOString()}`,
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      const failCount = user.failedLoginCount + 1;
      const lockedUntil = failCount >= 5
        ? new Date(Date.now() + 15 * 60_000)  // 15 min lock
        : undefined;

      await this.prisma.user.update({
        where: { id: user.id },
        data:  { failedLoginCount: failCount, ...(lockedUntil ? { lockedUntil } : {}) },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset fail counter on success
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.buildTokenPair(user, user.clinic);
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.userSession.findFirst({
      where: {
        refreshToken,
        userId:    payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { include: { clinic: true } } },
    });

    if (!session) throw new UnauthorizedException('Session expired — please login again');

    // Rotate: revoke old, issue new
    await this.prisma.userSession.update({
      where: { id: session.id },
      data:  { revokedAt: new Date() },
    });

    return this.buildTokenPair(session.user, session.user.clinic);
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string, accessToken?: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, refreshToken },
      data:  { revokedAt: new Date() },
    });

    // Immediately revoke the access token so it can't be reused before expiry
    if (accessToken) {
      await this.blacklist.revoke(accessToken);
    }
  }

  // ── Revoke all sessions (password change, suspension) ─────────────────────

  async revokeAllSessions(userId: string) {
    await this.prisma.userSession.updateMany({
      where:  { userId, revokedAt: null },
      data:   { revokedAt: new Date() },
    });
    await this.blacklist.revokeAllForUser(userId);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async buildTokenPair(user: any, clinic: any) {
    const jwtPayload = {
      sub:        user.id,
      email:      user.email,
      role:       user.role,
      clinicId:   clinic.id,
      clinicSlug: clinic.slug,
      clinicName: clinic.name,
    };

    const accessToken = this.jwt.sign(jwtPayload, {
      secret:    this.config.get('jwt.secret'),
      expiresIn: this.config.get('jwt.expiresIn'),
    });

    const refreshToken = this.jwt.sign(
      { sub: user.id },
      { secret: this.config.get('jwt.refreshSecret'), expiresIn: '30d' },
    );

    await this.prisma.userSession.create({
      data: {
        userId:       user.id,
        clinicId:     clinic.id,
        refreshToken,
        expiresAt:    new Date(Date.now() + 30 * 86_400_000),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id, fullName: user.fullName,
        email: user.email, role: user.role,
      },
      clinic: {
        id: clinic.id, slug: clinic.slug,
        name: clinic.name, plan: clinic.plan, subStatus: clinic.subStatus,
      },
    };
  }

  private buildSlug(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${base}-${uuid().slice(0, 6)}`;
  }
}
