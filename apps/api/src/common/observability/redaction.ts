/**
 * Redaction and sanitisation for everything that leaves the process: logs, alert e-mails and HTTP error bodies.
 * Two layers: (1) by KEY (a field called password/token/email/... is replaced wholesale) and
 * (2) by CONTENT (JWTs, bearer tokens, connection URLs, provider keys, e-mail addresses, phone numbers,
 * long secret-looking runs and file-system paths are scrubbed from free text).
 */

const REDACTED = '[REDACTED]';

/** Credentials and secrets: never logged, whatever the value. */
const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|credential|cvv|card|otp|signature|private|session|jwt|refresh|connection|dsn|database_?url|smtp/i;
/** Patient / personal data: never logged, whatever the value. */
const PII_KEY = /^(full|first|last|patient|owner|display)_?name$|email|phone|mobile|^dob$|birth|address|^city$|allerg|medical|diagnos|complaint|^notes?$|clinicalnotes|prescription|aadhaar|^pan$|^ssn$|gender|blood|emergency|insurance|^body$|^payload$/i;

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|authorization|auth)\b\s*[=:]\s*(?:Bearer\s+)?[^\s,;&'"]+/gi, '$1=[REDACTED]'],   // password=...  token: ...
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[JWT]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [TOKEN]'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]*@[^\s'"<>]+/gi, '[URL_WITH_CREDENTIALS]'],          // scheme://user:pass@host
  [/\bpostgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[DB_URL]'],
  [/\bredis(?:s)?:\/\/[^\s'"<>]+/gi, '[REDIS_URL]'],
  [/\brzp_(?:live|test)_[A-Za-z0-9]+/g, '[PAYMENT_KEY]'],
  [/\bAKIA[0-9A-Z]{12,}/g, '[AWS_KEY]'],
  [/\bAC[a-f0-9]{32}\b/g, '[TWILIO_SID]'],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[EMAIL]'],
  [/(?<![\w-])\+?\d[\d\s().-]{8,}\d(?![\w-])/g, '[PHONE]'],
  [/\b[A-Za-z]:\\(?:[^\s\\'"]+\\)*[^\s\\'"]*/g, '[PATH]'],                                // C:\a\b\c.ts
  [/(?<![\w.])\/(?:home|app|usr|var|opt|srv|root|Users|workspace)\/[^\s'"():]+/g, '[PATH]'],
  [/\bnode_modules\/[^\s'"():]+/g, '[PATH]'],
];

/** Long runs that look like keys/hashes (must mix letters and digits so ordinary long words survive). */
function scrubLongTokens(s: string): string {
  return s.replace(/[A-Za-z0-9+/_=]{32,}/g, (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) ? '[SECRET]' : m));
}

/** Scrub free text and cap its length. Never throws. */
export function sanitizeText(input: unknown, max = 300): string {
  let s: string;
  try { s = typeof input === 'string' ? input : input instanceof Error ? input.message : JSON.stringify(input) ?? String(input); } catch { s = String(input); }
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  s = scrubLongTokens(s).replace(/[\r\n\t]+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

export interface RedactOptions { maxDepth?: number; maxKeys?: number; maxItems?: number; maxString?: number }

/** Deep, bounded, cycle-safe redaction of arbitrary context objects. */
export function redact(value: unknown, opts: RedactOptions = {}, depth = 0, seen = new WeakSet<object>()): unknown {
  const { maxDepth = 5, maxKeys = 40, maxItems = 20, maxString = 300 } = opts;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeText(value, maxString);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: sanitizeText(value.message, maxString) };
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value as object)) return '[Circular]';
  if (depth >= maxDepth) return '[MaxDepth]';
  seen.add(value as object);
  if (Array.isArray(value)) {
    const out = value.slice(0, maxItems).map((v) => redact(v, opts, depth + 1, seen));
    if (value.length > maxItems) out.push(`[+${value.length - maxItems} more]`);
    return out;
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (++n > maxKeys) { out['[truncated]'] = `+${Object.keys(value as object).length - maxKeys} keys`; break; }
    out[k] = SECRET_KEY.test(k) || PII_KEY.test(k) ? REDACTED : redact(v, opts, depth + 1, seen);
  }
  return out;
}

/** Internal-only summary of an unknown thrown value (name, code, scrubbed message). */
export function summariseError(err: unknown): { name: string; code?: string; message: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { name: err.name, ...(typeof code === 'string' ? { code } : {}), message: sanitizeText(err.message, 300) };
  }
  return { name: typeof err, message: sanitizeText(err, 300) };
}

/** Stack trace limited to the top frames, with paths and secrets scrubbed. For server logs only, never for clients/e-mail. */
export function sanitizeStack(stack: unknown, maxFrames = 8): string | undefined {
  if (typeof stack !== 'string') return undefined;
  return stack.split('\n').slice(0, maxFrames + 1).map((l) => sanitizeText(l, 200)).join('\n');
}

/** `/api/v1/patients/3f2a…-uuid/documents` → `/api/v1/patients/:id/documents` (route label for logs, metrics and alerts). */
export function templatePath(url: string | undefined): string {
  const path = (url ?? '').split('?')[0];
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:n')
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:token');
}

export const REDACTED_MARK = REDACTED;
