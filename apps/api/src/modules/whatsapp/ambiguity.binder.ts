import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { CacheAmbiguityStore, ambiguityStore } from './reminder-delivery';

/**
 * Binds the Redis-backed ambiguity store at startup so that "this reminder's outcome was unknown on provider X, only
 * ever retry X" survives restarts and is shared by every scheduler instance. Without Redis it falls back to the
 * in-memory store (single process only) — logged, because that weakens the duplicate guarantee across restarts.
 */
@Injectable()
export class ReminderAmbiguityBinder implements OnModuleInit {
  private readonly logger = new Logger(ReminderAmbiguityBinder.name);
  constructor(@Optional() private readonly cache?: CacheService) {}

  onModuleInit() {
    if (this.cache) {
      ambiguityStore.use(new CacheAmbiguityStore(this.cache));
    } else {
      this.logger.warn('No cache service: ambiguous-delivery pinning is in-memory only');
    }
  }
}
