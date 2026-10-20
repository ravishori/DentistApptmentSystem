import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * RefreshJwtStrategy — validates the refresh token sent in the request body.
 *
 * Registered as 'jwt-refresh' (not the default 'jwt'), so it's only invoked
 * by endpoints that explicitly call @UseGuards(RefreshJwtGuard).
 */
@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest:    ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration:  false,
      secretOrKey:       config.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string }) {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');
    // Return minimal shape; AuthService does the full DB validation
    return { id: payload.sub, refreshToken };
  }
}
