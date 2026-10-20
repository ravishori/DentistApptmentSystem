import { Transform } from 'class-transformer';

/**
 * Stops the global ValidationPipe's implicit conversion from rewriting this property before validation.
 * Without it a JSON number or object sent as a string field (e.g. a password) is coerced to "12345678" or
 * "[object Object]" and then passes @IsString()/@MinLength(). Pair with @IsString() so non-strings are rejected.
 */
export const KeepRaw = () => Transform(({ obj, key }: { obj: any; key: string }) => obj[key]);
