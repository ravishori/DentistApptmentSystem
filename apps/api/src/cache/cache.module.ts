import { Global, Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CacheService } from './cache.service';
import { TokenBlacklistService } from './token-blacklist.service';

@Global()
@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: (cfg: ConfigService) => {
        const password = cfg.get<string>('redis.password');
        // Without a password the URL must not contain ":undefined@" (it would be sent as the password)
        const auth = password ? `:${encodeURIComponent(password)}@` : '';
        return { type: 'single' as const, url: `redis://${auth}${cfg.get('redis.host')}:${cfg.get('redis.port')}` };
      },
      inject: [ConfigService],
    }),
    JwtModule,
  ],
  providers: [CacheService, TokenBlacklistService],
  exports:   [CacheService, TokenBlacklistService],
})
export class AppCacheModule {}
