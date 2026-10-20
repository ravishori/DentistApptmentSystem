import { Logger } from '@nestjs/common';

/** Secrets that must be strong in production. Values are NEVER printed — only names and reasons. */
export const REQUIRED_SECRETS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  // Shared secret for Meta's webhook handshake (GET /whatsapp/webhook). The code default
  // ('dentalease-verify') is public, so anyone could register our endpoint with a forged subscription.
  'WHATSAPP_VERIFY_TOKEN',
] as const;

const MIN_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;

/** Known defaults and the placeholders shipped in .env.example / configuration.ts. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^(your_|change|32_char|secret|password|passw0rd|test|dev|dentalease|example|default)/i,
  /change[-_ ]?(me|this|in)/i,
  /placeholder|example|x{6,}|1234567|qwerty|letmein/i,
];

/** Returns why a secret is unacceptable, or null when it is acceptable. */
export function secretWeakness(value: string | undefined): string | null {
  if (!value) return 'is missing';
  if (value !== value.trim()) return 'has leading/trailing whitespace';
  if (value.length < MIN_LENGTH) return `is shorter than ${MIN_LENGTH} characters`;
  if (new Set(value).size < MIN_DISTINCT_CHARS) return 'has too little variety (looks repetitive)';
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(value))) return 'is a known default/placeholder value';
  return null;
}

/** Throws (aborting boot) when a production secret is missing, weak, a placeholder or reused. */
export function assertProductionSecrets(env: Record<string, unknown>): void {
  const get = (k: string) => (typeof env[k] === 'string' ? (env[k] as string) : undefined);
  const problems: string[] = [];

  for (const name of REQUIRED_SECRETS) {
    const why = secretWeakness(get(name));
    if (why) problems.push(`${name} ${why}`);
  }

  // Distinct secrets: reuse would let a leaked refresh/encryption secret forge access tokens
  const present = REQUIRED_SECRETS.filter((n) => get(n));
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      if (get(present[i]) === get(present[j])) problems.push(`${present[i]} and ${present[j]} must not be identical`);
    }
  }

  if (problems.length) {
    throw new Error(
      `Refusing to start in production — insecure secrets configuration:\n  - ${problems.join('\n  - ')}\n` +
      `Generate each with e.g. \`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\`.`,
    );
  }
}

/**
 * Wired into ConfigModule.forRoot({ validate }). Production fails closed; any other environment
 * boots with a warning (names only) so local development keeps working with .env.example values.
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  if (env.NODE_ENV === 'production') {
    assertProductionSecrets(env);
    return env;
  }
  const logger = new Logger('Config');
  const weak = REQUIRED_SECRETS.filter((n) => secretWeakness(typeof env[n] === 'string' ? (env[n] as string) : undefined));
  if (weak.length) {
    logger.warn(`Weak/missing secrets (${weak.join(', ')}) — acceptable for local development only; startup fails in production`);
  }
  return env;
}
