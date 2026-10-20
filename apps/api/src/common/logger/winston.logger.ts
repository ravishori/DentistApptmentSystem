// Compatibility facade. The old "winston" logger printed free-form console text; it now emits the same structured JSON
// records as the rest of the application (see common/observability/structured-logger.ts). Existing call sites keep
// working unchanged; new code should call logEvent(level, 'domain.event', { ...context }) directly.
import { logEvent } from '../observability/structured-logger';
import { sanitizeStack, sanitizeText } from '../observability/redaction';

const toFields = (message: unknown, meta?: Record<string, unknown>) => {
  const { context, stack, ...rest } = (meta ?? {}) as Record<string, unknown>;
  return { context, message: sanitizeText(message, 1000), ...(typeof stack === 'string' ? { stack: sanitizeStack(stack) } : {}), ...rest };
};

export const winstonLogger = {
  info:    (msg: unknown, meta?: Record<string, unknown>) => logEvent('info',  'app.log', toFields(msg, meta)),
  error:   (msg: unknown, meta?: Record<string, unknown>) => logEvent('error', 'app.log', toFields(msg, meta)),
  warn:    (msg: unknown, meta?: Record<string, unknown>) => logEvent('warn',  'app.log', toFields(msg, meta)),
  debug:   (msg: unknown, meta?: Record<string, unknown>) => logEvent('debug', 'app.log', toFields(msg, meta)),
  verbose: (msg: unknown, meta?: Record<string, unknown>) => logEvent('debug', 'app.log', toFields(msg, meta)),
};

export class AppLogger {
  constructor(private readonly context?: string) {}
  log(message: unknown, context?: string)   { winstonLogger.info(message,  { context: context ?? this.context }); }
  error(message: unknown, trace?: string, context?: string) { winstonLogger.error(message, { stack: trace, context: context ?? this.context }); }
  warn(message: unknown, context?: string)  { winstonLogger.warn(message,  { context: context ?? this.context }); }
  debug(message: unknown, context?: string) { winstonLogger.debug(message, { context: context ?? this.context }); }
  verbose(message: unknown, context?: string) { winstonLogger.verbose(message, { context: context ?? this.context }); }
}
