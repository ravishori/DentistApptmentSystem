import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { TokenBlacklistService } from '../../../cache/token-blacklist.service';

interface JwtPayload {
  sub:        string;
  email:      string;
  role:       string;
  clinicId:   string;
  clinicSlug: string;
  clinicName: string;
  iat?:       number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma:     PrismaService,
    private readonly blacklist:  TokenBlacklistService,
  ) {
    super({
      jwtFromRequest:    ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration:  false,
      secretOrKey:       config.get<string>('jwt.secret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    // 1. Check individual-token blacklist
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (token && await this.blacklist.isRevoked(token)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // 2. Check user-level revocation (password change, suspension, etc.)
    if (payload.iat) {
      const revokedAt = await this.blacklist.getUserRevocationTime(payload.sub);
      if (revokedAt && payload.iat * 1000 < revokedAt) {
        throw new UnauthorizedException('Session invalidated — please log in again');
      }
    }

    // 3. Verify user still exists and is active
    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: { id: true, isActive: true, email: true, role: true, clinicId: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or deactivated');
    }

    return {
      id:         user.id,
      email:      user.email,
      role:       user.role,
      clinicId:   payload.clinicId,
      clinicSlug: payload.clinicSlug,
      clinicName: payload.clinicName,
    };
  }
}
