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
      useFactory: (cfg: ConfigService) => ({
        type: 'single',
        url:  `redis://:${cfg.get('redis.password')}@${cfg.get('redis.host')}:${cfg.get('redis.port')}`,
      }),
      inject: [ConfigService],
    }),
    JwtModule,
  ],
  providers: [CacheService, TokenBlacklistService],
  exports:   [CacheService, TokenBlacklistService],
})
export class AppCacheModule {}
