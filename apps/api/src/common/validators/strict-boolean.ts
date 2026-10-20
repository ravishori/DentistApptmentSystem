import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidationOptions } from 'class-validator';

/**
 * Why this exists: main.ts enables `transformOptions: { enableImplicitConversion: true }`. For a property typed
 * `boolean` that converts with `Boolean(value)`, so the JSON string "false" (or "0", "no", …) silently becomes
 * `true` BEFORE @IsBoolean runs. For consent and access flags (`waOptIn`, `isActive`, `notifySms`, …) that flips
 * the user's intent. Never use plain @IsBoolean() in a DTO — use this instead.
 *
 * Default (JSON bodies): only real booleans pass; everything else is rejected with 400.
 * `{ fromString: true }` (query strings / form posts): additionally maps the EXACT strings "true" / "false";
 *  any other string is still rejected, and "false" can never become true.
 */
export const STRICT_BOOLEAN_KEY = 'app:strict-boolean';

export function IsStrictBoolean(options: { fromString?: boolean } & ValidationOptions = {}) {
  const { fromString, ...validation } = options;
  return applyDecorators(
    // Read the RAW input (obj[key]) so the implicit conversion that already ran cannot leak through
    (target: object, propertyKey: string | symbol) => {
      Transform(({ obj, key }) => {
        const raw = obj[key as string];
        if (typeof raw === 'boolean') return raw;
        if (fromString && raw === 'true') return true;
        if (fromString && raw === 'false') return false;
        return raw;                 // anything else stays as-is and fails @IsBoolean below
      })(target, propertyKey);
      Reflect.defineMetadata(STRICT_BOOLEAN_KEY, true, target, propertyKey);
    },
    IsBoolean(validation),
  );
}
