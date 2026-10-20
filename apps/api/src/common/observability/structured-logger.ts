import { LoggerService } from '@nestjs/common';
import { getRequestContext } from './context-store';
import { redact, sanitizeStack, sanitizeText } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const SERVICE_NAME = process.env.SERVICE_NAME ?? 'dentalease-api';

type Sink = (line: string, level: LogLevel) => void;
const defaultSink: Sink = (line, level) => { (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n'); };
let sink: Sink = defaultSink;

/** Tests (and, if ever needed, a file/stream shipper) replace the output; returns a restore function. */
export function setLogSink(next: Sink): () => void { const prev = sink; sink = next; return () => { sink = prev; }; }

const minLevel = (): number => ORDER[(process.env.LOG_LEVEL as LogLevel) in ORDER ? (process.env.LOG_LEVEL as LogLevel) : 'info'];
const environment = () => process.env.NODE_ENV ?? 'development';

/** Fields reserved by the envelope: caller data can never overwrite them. */
const RESERVED = new Set(['timestamp', 'level', 'service', 'environment', 'event', 'requestId', 'traceId']);

/**
 * Emit ONE structured log record (JSON line). Context is redacted, request/trace ids come from the active request.
 * Never throws: logging must not be able to break a request.
 */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  try {
    if (ORDER[level] < minLevel()) return;
    const ctx = getRequestContext();
    const safe = redact(fields) as Record<string, unknown>;
    for (const k of Object.keys(safe)) if (RESERVED.has(k)) { safe[`ctx_${k}`] = safe[k]; delete safe[k]; }
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(), level, service: SERVICE_NAME, environment: environment(), event,
      requestId: ctx?.requestId, traceId: ctx?.traceId,
      ...(ctx?.userId ? { userId: ctx.userId } : {}), ...(ctx?.clinicId ? { clinicId: ctx.clinicId } : {}),
      ...safe,
    };
    if (process.env.LOG_FORMAT === 'pretty') {
      const { timestamp, level: lv, service, environment: env, event: ev, ...rest } = record;
      sink(`${String(timestamp).slice(11, 23)} ${String(lv).toUpperCase().padEnd(5)} ${ev} ${Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')}`, level);
    } else {
      sink(JSON.stringify(record), level);
    }
  } catch { /* logging must never throw */ }
}

/**
 * NestJS LoggerService: routes every `new Logger(...)` call in the code base (≈40 call sites) through the same
 * structured pipeline, so framework and application logs share one JSON format and carry the request id.
 */
export class StructuredLogger implements LoggerService {
  log(message: unknown, ...rest: unknown[]) { this.emit('info', message, rest); }
  warn(message: unknown, ...rest: unknown[]) { this.emit('warn', message, rest); }
  debug(message: unknown, ...rest: unknown[]) { this.emit('debug', message, rest); }
  verbose(message: unknown, ...rest: unknown[]) { this.emit('debug', message, rest); }
  fatal(message: unknown, ...rest: unknown[]) { this.emit('error', message, rest); }
  error(message: unknown, ...rest: unknown[]) { this.emit('error', message, rest); }

  private emit(level: LogLevel, message: unknown, rest: unknown[]) {
    // Nest passes (message, context) or, for errors, (message, stack, context)
    const strings = rest.filter((r): r is string => typeof r === 'string');
    const context = strings.length ? strings[strings.length - 1] : undefined;
    const stack = level === 'error' && strings.length > 1 ? strings[0] : undefined;
    logEvent(level, 'app.log', {
      context, message: typeof message === 'string' ? sanitizeText(message, 1000) : redact(message),
      ...(stack ? { stack: sanitizeStack(stack) } : {}),
    });
  }
}
