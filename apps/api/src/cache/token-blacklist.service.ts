import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { errText } from '../common/observability/redaction';

/**
 * TokenBlacklistService
 *
 * Stores revoked access tokens in Redis so they cannot be used even before
 * their natural expiry. Keys expire automatically at the token's exp time.
 *
 * Pattern: "token:blacklist:<jti-or-hash>"  →  "1"  (TTL = remaining token lifetime)
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly jwt:    JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Revoke an access token. Stores its fingerprint in Redis until expiry.
   * Call on logout, password change, or account deactivation.
   */
  async revoke(accessToken: string): Promise<void> {
    try {
      const payload = this.jwt.decode(accessToken) as { sub: string; exp?: number; iat?: number };
      if (!payload?.exp) return;

      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      if (ttl <= 0) return; // already expired — no need to store

      const key = this.buildKey(accessToken);
      await this.redis.set(key, '1', 'EX', ttl);

      this.logger.debug(`Token revoked for user ${payload.sub} (TTL ${ttl}s)`);
    } catch (err) {
      this.logger.warn(`Token revocation failed: ${errText(err)}`);
    }
  }

  /**
   * Revoke all access tokens for a user by storing a "user-level revocation"
   * marker. JwtStrategy checks this and rejects any token issued before the
   * marker was set.
   *
   * Use on: password change, role change, account suspension.
   * TTL matches the max access token lifetime (7d by default).
   */
  async revokeAllForUser(userId: string): Promise<void> {
    const key = `token:revoked:user:${userId}`;
    const ttl = 7 * 24 * 3600; // 7 days — matches JWT_EXPIRES_IN
    await this.redis.set(key, Date.now().toString(), 'EX', ttl);
    this.logger.log(`All tokens revoked for user ${userId}`);
  }

  /** Returns true if the token has been individually revoked. */
  async isRevoked(accessToken: string): Promise<boolean> {
    try {
      const key = this.buildKey(accessToken);
      const result = await this.redis.get(key);
      return result === '1';
    } catch {
      return false; // fail open — don't lock out users on Redis outage
    }
  }

  /**
   * Returns the epoch (ms) at which all tokens for this user were revoked,
   * or null if no user-level revocation is in place.
   */
  async getUserRevocationTime(userId: string): Promise<number | null> {
    try {
      const key   = `token:revoked:user:${userId}`;
      const value = await this.redis.get(key);
      return value ? parseInt(value, 10) : null;
    } catch {
      return null;
    }
  }

  private buildKey(token: string): string {
    // Use last 32 chars of token as fingerprint — short enough for Redis but unique enough
    const fingerprint = token.slice(-32);
    return `token:blacklist:${fingerprint}`;
  }
}
