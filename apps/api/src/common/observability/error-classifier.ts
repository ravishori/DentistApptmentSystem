import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sanitizeText, summariseError } from './redaction';

/**
 * Stable application error codes. Clients may branch on these; they never change meaning once released.
 * The human-readable `message` is for display only.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  BAD_REQUEST = 'BAD_REQUEST',
  MALFORMED_JSON = 'MALFORMED_JSON',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNIQUE_VIOLATION = 'UNIQUE_VIOLATION',
  FOREIGN_KEY_VIOLATION = 'FOREIGN_KEY_VIOLATION',
  CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
  TRANSACTION_CONFLICT = 'TRANSACTION_CONFLICT',
  UNPROCESSABLE = 'UNPROCESSABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  DB_UNAVAILABLE = 'DB_UNAVAILABLE',
  DB_TIMEOUT = 'DB_TIMEOUT',
  CACHE_UNAVAILABLE = 'CACHE_UNAVAILABLE',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export type Severity = 'info' | 'warning' | 'error' | 'critical';
export type Subsystem = 'http' | 'validation' | 'auth' | 'database' | 'cache' | 'upstream' | 'internal';

export interface FieldIssue { field: string; message: string }

export interface ClassifiedError {
  status: number;
  code: ErrorCode;
  /** Safe for clients. For 4xx it is the (scrubbed) application message; for 5xx it is always generic. */
  message: string | string[];
  details?: FieldIssue[];
  retryable: boolean;
  retryAfterSeconds?: number;
  severity: Severity;
  subsystem: Subsystem;
  /** Whether this failure should be considered for an administrator alert. */
  alert: boolean;
  /** Internal only (logs): what actually was thrown, scrubbed. Never returned to clients. */
  cause: { name: string; code?: string; message: string };
}

const GENERIC: Record<number, string> = {
  500: 'Something went wrong on our side. Please try again; if it keeps happening contact support with the reference below.',
  502: 'A connected service returned an error. Please try again shortly.',
  503: 'The service is temporarily unavailable. Please try again in a few moments.',
  504: 'The service took too long to respond. Please try again.',
};
const genericFor = (status: number) => GENERIC[status] ?? GENERIC[500];

const DB_DOWN_CODES = new Set(['P1000', 'P1001', 'P1003', 'P1010', 'P1011', 'P1017']);
const DB_TIMEOUT_CODES = new Set(['P1002', 'P1008', 'P2024', 'P2028']);
const DB_DOWN_TEXT = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|Connection terminated|terminating connection|server closed the connection|too many clients|Can't reach database server|connection pool|Closed|no pg_hba/i;
const DB_TIMEOUT_TEXT = /ETIMEDOUT|timed out|timeout|canceling statement due to (statement )?timeout/i;

function base(status: number, code: ErrorCode, extra: Partial<ClassifiedError> & { cause: ClassifiedError['cause'] }): ClassifiedError {
  return {
    status, code, message: genericFor(status), retryable: false, severity: 'warning', subsystem: 'http', alert: false, ...extra,
  };
}

function dbDown(cause: ClassifiedError['cause'], timeout = false): ClassifiedError {
  return base(503, timeout ? ErrorCode.DB_TIMEOUT : ErrorCode.DB_UNAVAILABLE, {
    message: 'The database is temporarily unavailable. Please try again in a few moments.',
    retryable: true, retryAfterSeconds: 5, severity: 'critical', subsystem: 'database', alert: true, cause,
  });
}

function fromPrismaKnown(e: Prisma.PrismaClientKnownRequestError, cause: ClassifiedError['cause']): ClassifiedError {
  const c = e.code;
  if (DB_DOWN_CODES.has(c)) return dbDown(cause);
  if (DB_TIMEOUT_CODES.has(c)) return dbDown(cause, true);
  switch (c) {
    case 'P2002': return base(409, ErrorCode.UNIQUE_VIOLATION, { message: 'A record with these values already exists.', subsystem: 'database', cause });
    case 'P2003': return base(409, ErrorCode.FOREIGN_KEY_VIOLATION, { message: 'A related record does not exist, or this record is still in use.', subsystem: 'database', cause });
    case 'P2014': return base(409, ErrorCode.CONSTRAINT_VIOLATION, { message: 'This change would break a required relationship.', subsystem: 'database', cause });
    case 'P2004': return base(409, ErrorCode.CONSTRAINT_VIOLATION, { message: 'The data violates a database rule.', subsystem: 'database', cause });
    case 'P2025': return base(404, ErrorCode.NOT_FOUND, { message: 'The requested record was not found.', subsystem: 'database', cause });
    case 'P2000': return base(400, ErrorCode.VALIDATION_FAILED, { message: 'A value is too long.', subsystem: 'database', cause });
    case 'P2005': case 'P2006': case 'P2007': case 'P2011': case 'P2012': case 'P2013': case 'P2019': case 'P2020':
      return base(400, ErrorCode.VALIDATION_FAILED, { message: 'One or more values are invalid.', subsystem: 'database', cause });
    case 'P2010': {                                   // raw query failed: the PostgreSQL SQLSTATE is in meta.code (or the message)
      const sqlstate = String((e.meta as { code?: unknown } | undefined)?.code ?? /Code:\s*`?(\w{5})/.exec(e.message)?.[1] ?? '');
      if (sqlstate === '23505') return base(409, ErrorCode.UNIQUE_VIOLATION, { message: 'A record with these values already exists.', subsystem: 'database', cause });
      if (sqlstate === '23503') return base(409, ErrorCode.FOREIGN_KEY_VIOLATION, { message: 'A related record does not exist, or this record is still in use.', subsystem: 'database', cause });
      if (sqlstate === '23514') return base(409, ErrorCode.CONSTRAINT_VIOLATION, { message: 'The data violates a database rule.', subsystem: 'database', cause });
      if (sqlstate === '23502' || sqlstate === '22001' || sqlstate.startsWith('22')) return base(400, ErrorCode.VALIDATION_FAILED, { message: 'One or more values are invalid.', subsystem: 'database', cause });
      if (sqlstate === '40001' || sqlstate === '40P01') return base(409, ErrorCode.TRANSACTION_CONFLICT, { message: 'The change conflicted with another update. Please retry.', retryable: true, retryAfterSeconds: 1, subsystem: 'database', cause });
      if (sqlstate === '57014') return dbDown(cause, true);
      if (sqlstate.startsWith('08') || sqlstate === '53300' || sqlstate.startsWith('57P')) return dbDown(cause);
      return base(500, ErrorCode.DATABASE_ERROR, { severity: 'error', subsystem: 'database', alert: true, cause });
    }
    case 'P2034': return base(409, ErrorCode.TRANSACTION_CONFLICT, { message: 'The change conflicted with another update. Please retry.', retryable: true, retryAfterSeconds: 1, subsystem: 'database', cause });
    default: return base(500, ErrorCode.DATABASE_ERROR, { severity: 'error', subsystem: 'database', alert: true, cause });
  }
}

function validationDetails(messages: string[]): FieldIssue[] {
  return messages.slice(0, 50).map((m) => {
    const text = sanitizeText(m, 200);
    const field = /^([A-Za-z_][\w.[\]]*)\s/.exec(text)?.[1] ?? '_';
    return { field, message: text };
  });
}

/** Single place that decides status, code and what the client may see. Pure and exhaustively unit-tested. */
function classifyUnsafe(exception: unknown): ClassifiedError {
  const cause = summariseError(exception);

  // ── Application / Nest HTTP exceptions ──────────────────────────────────────
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse() as unknown;
    const raw = typeof body === 'object' && body !== null ? (body as { message?: unknown }).message : body;
    const asList = Array.isArray(raw) ? raw.map(String) : undefined;
    const text = typeof raw === 'string' ? raw : undefined;

    if (status >= 500) {
      const code = status === 503 ? ErrorCode.SERVICE_UNAVAILABLE : status === 502 || status === 504 ? ErrorCode.UPSTREAM_ERROR : ErrorCode.INTERNAL_ERROR;
      return base(status, code, { retryable: status === 503 || status === 504, retryAfterSeconds: status === 503 ? 5 : undefined, severity: 'error', subsystem: status === 500 ? 'internal' : 'upstream', alert: true, cause });
    }
    if (status === 400 && asList) {
      return base(400, ErrorCode.VALIDATION_FAILED, { message: asList.map((m) => sanitizeText(m, 200)), details: validationDetails(asList), severity: 'info', subsystem: 'validation', cause });
    }
    // Nest re-wraps body-parser failures as a plain BadRequestException carrying the parser's own wording; never show it.
    if (status === 400 && text !== undefined && /JSON|Unexpected (token|end)|unexpected end of/i.test(text) && !/^[A-Z][a-z]+ .*(required|must|should)/.test(text)) {
      return base(400, ErrorCode.MALFORMED_JSON, { message: 'The request body is not valid JSON.', severity: 'info', cause });
    }
    const safe = text !== undefined ? sanitizeText(text, 300) : asList ? asList.map((m) => sanitizeText(m, 200)) : undefined;
    const table: Record<number, [ErrorCode, string, Subsystem]> = {
      400: [ErrorCode.BAD_REQUEST, 'The request could not be processed.', 'http'],
      401: [ErrorCode.UNAUTHENTICATED, 'Please sign in to continue.', 'auth'],
      403: [ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 'auth'],
      404: [ErrorCode.NOT_FOUND, 'The requested resource was not found.', 'http'],
      409: [ErrorCode.CONFLICT, 'This conflicts with the current state of the data.', 'http'],
      413: [ErrorCode.PAYLOAD_TOO_LARGE, 'The request is too large.', 'http'],
      422: [ErrorCode.UNPROCESSABLE, 'The request could not be processed.', 'validation'],
      429: [ErrorCode.RATE_LIMITED, 'Too many requests. Please wait a moment and try again.', 'http'],
    };
    const [code, fallback, subsystem] = table[status] ?? [ErrorCode.BAD_REQUEST, 'The request could not be processed.', 'http'];
    // Throttler's own text ("ThrottlerException: Too Many Requests") is not user-friendly: use ours for 429.
    const message = status === 429 ? fallback : safe ?? fallback;
    return base(status, code, { message, retryable: status === 429, retryAfterSeconds: status === 429 ? 60 : undefined, severity: 'info', subsystem, cause });
  }

  // ── Prisma / PostgreSQL ─────────────────────────────────────────────────────
  if (exception instanceof Prisma.PrismaClientKnownRequestError) return fromPrismaKnown(exception, cause);
  if (exception instanceof Prisma.PrismaClientInitializationError) return dbDown(cause, DB_TIMEOUT_TEXT.test(exception.message) && !DB_DOWN_TEXT.test(exception.message));
  if (exception instanceof Prisma.PrismaClientRustPanicError) {
    return base(500, ErrorCode.DATABASE_ERROR, { severity: 'critical', subsystem: 'database', alert: true, cause });
  }
  if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
    const m = exception.message;
    if (/violates check constraint/i.test(m)) return base(409, ErrorCode.CONSTRAINT_VIOLATION, { message: 'The data violates a database rule.', subsystem: 'database', cause });
    if (DB_DOWN_TEXT.test(m)) return dbDown(cause);
    if (DB_TIMEOUT_TEXT.test(m)) return dbDown(cause, true);
    return base(500, ErrorCode.DATABASE_ERROR, { severity: 'error', subsystem: 'database', alert: true, cause });
  }
  if (exception instanceof Prisma.PrismaClientValidationError) {
    // A query the code built is invalid: a programming error, never the caller's fault.
    return base(500, ErrorCode.INTERNAL_ERROR, { severity: 'error', subsystem: 'database', alert: true, cause });
  }

  // ── Parsers / transport errors (body-parser, http-errors) ───────────────────
  const e = exception as { type?: string; status?: number; statusCode?: number; name?: string; code?: string; isAxiosError?: boolean };
  if (e && typeof e === 'object') {
    if (e.type === 'entity.parse.failed') return base(400, ErrorCode.MALFORMED_JSON, { message: 'The request body is not valid JSON.', severity: 'info', cause });
    if (e.type === 'entity.too.large') return base(413, ErrorCode.PAYLOAD_TOO_LARGE, { message: 'The request is too large.', severity: 'info', cause });
    if (e.type === 'encoding.unsupported' || e.type === 'charset.unsupported') return base(415, ErrorCode.BAD_REQUEST, { message: 'Unsupported content encoding.', severity: 'info', cause });
    const s = e.status ?? e.statusCode;
    if (typeof s === 'number' && s >= 400 && s < 500 && e.name !== 'AxiosError') {
      return base(s, s === 404 ? ErrorCode.NOT_FOUND : ErrorCode.BAD_REQUEST, { message: 'The request could not be processed.', severity: 'info', cause });
    }
    if (e.isAxiosError) return base(502, ErrorCode.UPSTREAM_ERROR, { retryable: true, retryAfterSeconds: 5, severity: 'error', subsystem: 'upstream', alert: true, cause });
    if (e.name === 'MaxRetriesPerRequestError' || (e.name === 'ReplyError' && /LOADING|READONLY|CLUSTERDOWN/.test(String((exception as Error).message)))) {
      return base(503, ErrorCode.CACHE_UNAVAILABLE, { message: 'A supporting service is temporarily unavailable. Please try again shortly.', retryable: true, retryAfterSeconds: 5, severity: 'critical', subsystem: 'cache', alert: true, cause });
    }
    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
      return base(503, ErrorCode.SERVICE_UNAVAILABLE, { retryable: true, retryAfterSeconds: 5, severity: 'error', subsystem: 'upstream', alert: true, cause });
    }
  }

  // ── Anything else ───────────────────────────────────────────────────────────
  return base(500, ErrorCode.INTERNAL_ERROR, { severity: 'error', subsystem: 'internal', alert: true, cause });
}

/** Total function: even a hostile/odd thrown value yields a safe 500 classification. */
export function classifyException(exception: unknown): ClassifiedError {
  try { return classifyUnsafe(exception); } catch {
    return base(500, ErrorCode.INTERNAL_ERROR, { severity: 'error', subsystem: 'internal', alert: true, cause: { name: 'Unclassifiable', message: '' } });
  }
}

export const isServerError = (c: ClassifiedError) => c.status >= 500;
export { HttpStatus };
