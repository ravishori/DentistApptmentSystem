import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skipTransform';

/** Return the handler's value as-is (no `{ success, data, timestamp, path }` envelope), e.g. health probes. */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
