// Simple console-based logger (drop-in replacement for Winston)
// Compatible interface: winstonLogger.info/error/warn/debug/verbose

const fmt = (level: string, message: any, meta?: any) => {
  const ts  = new Date().toISOString().slice(11, 23);
  const ctx = meta?.context ? ` [${meta.context}]` : '';
  const extra = meta
    ? Object.entries(meta)
        .filter(([k]) => k !== 'context')
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ')
    : '';
  const stack = meta?.stack ? `\n${meta.stack}` : '';
  return `${ts}${ctx} ${level}: ${message}${extra ? ' ' + extra : ''}${stack}`;
};

export const winstonLogger = {
  info:    (msg: any, meta?: any) => console.log(fmt('INFO',    msg, meta)),
  error:   (msg: any, meta?: any) => console.error(fmt('ERROR', msg, meta)),
  warn:    (msg: any, meta?: any) => console.warn(fmt('WARN',   msg, meta)),
  debug:   (msg: any, meta?: any) => console.debug(fmt('DEBUG', msg, meta)),
  verbose: (msg: any, meta?: any) => console.log(fmt('VERBOSE', msg, meta)),
};

export class AppLogger {
  private readonly context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  log(message: any, context?: string) {
    console.log(fmt('INFO', message, { context: context ?? this.context }));
  }

  error(message: any, trace?: string, context?: string) {
    console.error(fmt('ERROR', message, { stack: trace, context: context ?? this.context }));
  }

  warn(message: any, context?: string) {
    console.warn(fmt('WARN', message, { context: context ?? this.context }));
  }

  debug(message: any, context?: string) {
    console.debug(fmt('DEBUG', message, { context: context ?? this.context }));
  }

  verbose(message: any, context?: string) {
    console.log(fmt('VERBOSE', message, { context: context ?? this.context }));
  }
}
