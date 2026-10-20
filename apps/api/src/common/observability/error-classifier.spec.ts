import { BadRequestException, ConflictException, ForbiddenException, HttpException, InternalServerErrorException, NotFoundException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { classifyException, ErrorCode } from './error-classifier';

const known = (code: string, meta?: Record<string, unknown>, message = `Invalid prisma.patient.create() invocation: Unique constraint failed on the fields: (\`phone\`) for +919876543210`) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '5.22.0', meta });

describe('HTTP exceptions', () => {
  it.each([
    [new UnauthorizedException('Invalid or expired token'), 401, ErrorCode.UNAUTHENTICATED],
    [new ForbiddenException("Role 'assistant' lacks permission: whatsapp:send"), 403, ErrorCode.FORBIDDEN],
    [new NotFoundException('Patient not found'), 404, ErrorCode.NOT_FOUND],
    [new ConflictException('Slot already booked'), 409, ErrorCode.CONFLICT],
    [new UnprocessableEntityException('bad'), 422, ErrorCode.UNPROCESSABLE],
    [new BadRequestException('Requested slot is not available'), 400, ErrorCode.BAD_REQUEST],
    [new HttpException('x', 413), 413, ErrorCode.PAYLOAD_TOO_LARGE],
  ])('%#: keeps status %i and code %s, no alert', (ex, status, code) => {
    const c = classifyException(ex);
    expect([c.status, c.code, c.alert]).toEqual([status, code, false]);
  });

  it('4xx application messages are passed through (they are written for users) after scrubbing', () => {
    const c = classifyException(new NotFoundException('Patient not found'));
    expect(c.message).toBe('Patient not found');
    expect(classifyException(new BadRequestException('Bad value for user@example.com')).message).toBe('Bad value for [EMAIL]');
  });

  it('validation errors become field-level details', () => {
    const c = classifyException(new BadRequestException(['email must be an email', 'password must be longer than or equal to 8 characters', 'clinicName should not be empty']));
    expect(c.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(c.status).toBe(400);
    expect(c.details).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'password', message: 'password must be longer than or equal to 8 characters' },
      { field: 'clinicName', message: 'clinicName should not be empty' },
    ]);
    expect(Array.isArray(c.message)).toBe(true);
    expect(c.alert).toBe(false);
  });

  it('rate limiting: stable code, friendly text (not "ThrottlerException"), retry guidance', () => {
    const c = classifyException(new ThrottlerException());
    expect(c).toMatchObject({ status: 429, code: ErrorCode.RATE_LIMITED, retryable: true, retryAfterSeconds: 60, alert: false });
    expect(String(c.message)).not.toMatch(/Throttler/);
  });

  it('5xx HttpExceptions NEVER echo their message (it may contain provider/internal detail)', () => {
    const c = classifyException(new InternalServerErrorException('Twilio auth failed for AC' + 'a1'.repeat(16) + ' token=abcdef1234567890abcdef1234567890'));
    expect(c.status).toBe(500);
    expect(c.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(JSON.stringify(c.message)).not.toMatch(/Twilio|token|AC[a-f0-9]/);
    expect(c.alert).toBe(true);
    const u = classifyException(new ServiceUnavailableException('WhatsApp sending is not configured'));
    expect(u).toMatchObject({ status: 503, code: ErrorCode.SERVICE_UNAVAILABLE, retryable: true });
    expect(String(u.message)).not.toMatch(/WhatsApp/);
  });
});

describe('Prisma / PostgreSQL errors', () => {
  it.each([
    ['P2002', 409, ErrorCode.UNIQUE_VIOLATION, false],
    ['P2003', 409, ErrorCode.FOREIGN_KEY_VIOLATION, false],
    ['P2004', 409, ErrorCode.CONSTRAINT_VIOLATION, false],
    ['P2014', 409, ErrorCode.CONSTRAINT_VIOLATION, false],
    ['P2025', 404, ErrorCode.NOT_FOUND, false],
    ['P2000', 400, ErrorCode.VALIDATION_FAILED, false],
    ['P2011', 400, ErrorCode.VALIDATION_FAILED, false],
    ['P2034', 409, ErrorCode.TRANSACTION_CONFLICT, false],
    ['P1001', 503, ErrorCode.DB_UNAVAILABLE, true],
    ['P1017', 503, ErrorCode.DB_UNAVAILABLE, true],
    ['P1010', 503, ErrorCode.DB_UNAVAILABLE, true],
    ['P1002', 503, ErrorCode.DB_TIMEOUT, true],
    ['P1008', 503, ErrorCode.DB_TIMEOUT, true],
    ['P2024', 503, ErrorCode.DB_TIMEOUT, true],
    ['P2028', 503, ErrorCode.DB_TIMEOUT, true],
    ['P9999', 500, ErrorCode.DATABASE_ERROR, true],
  ])('%s → %i %s (alert=%s)', (code, status, errCode, alert) => {
    const c = classifyException(known(code, { target: ['phone'] }));
    expect([c.status, c.code, c.alert]).toEqual([status, errCode, alert]);
  });

  it('the response text never contains the Prisma message, field values, table or column names', () => {
    for (const code of ['P2002', 'P2003', 'P2025', 'P2000', 'P1001', 'P9999']) {
      const c = classifyException(known(code, { target: ['phone'], field_name: 'patients_clinic_id_fkey' }));
      const text = JSON.stringify([c.message, c.details]);
      expect(text).not.toMatch(/prisma|invocation|phone|9198765|patients_clinic|constraint failed/i);
    }
  });

  it('outages are critical + retryable with guidance; conflicts of data are not alerts', () => {
    expect(classifyException(known('P1001'))).toMatchObject({ severity: 'critical', retryable: true, retryAfterSeconds: 5, subsystem: 'database' });
    expect(classifyException(known('P2002'))).toMatchObject({ severity: 'warning', retryable: false });
    expect(classifyException(known('P2034'))).toMatchObject({ retryable: true });
  });

  it('initialisation / unknown-request / panic / validation errors', () => {
    expect(classifyException(new Prisma.PrismaClientInitializationError("Can't reach database server at `db.internal:5432`", '5.22.0', 'P1001')))
      .toMatchObject({ status: 503, code: ErrorCode.DB_UNAVAILABLE, alert: true });
    expect(classifyException(new Prisma.PrismaClientInitializationError('Timed out fetching a new connection from the pool', '5.22.0')))
      .toMatchObject({ status: 503, code: ErrorCode.DB_TIMEOUT });
    expect(classifyException(new Prisma.PrismaClientUnknownRequestError('connection terminated unexpectedly: terminating connection due to administrator command', { clientVersion: '5.22.0' })))
      .toMatchObject({ status: 503, code: ErrorCode.DB_UNAVAILABLE });
    expect(classifyException(new Prisma.PrismaClientUnknownRequestError('new row for relation "appointments" violates check constraint "chk_time"', { clientVersion: '5.22.0' })))
      .toMatchObject({ status: 409, code: ErrorCode.CONSTRAINT_VIOLATION, alert: false });
    expect(classifyException(new Prisma.PrismaClientUnknownRequestError('weird failure', { clientVersion: '5.22.0' })))
      .toMatchObject({ status: 500, code: ErrorCode.DATABASE_ERROR, alert: true });
    expect(classifyException(new Prisma.PrismaClientRustPanicError('panic at engine', '5.22.0')))
      .toMatchObject({ status: 500, severity: 'critical', alert: true });
    const v = classifyException(new Prisma.PrismaClientValidationError('Invalid `prisma.patient.findMany()` invocation: Unknown arg `fullNmae`', { clientVersion: '5.22.0' }));
    expect(v).toMatchObject({ status: 500, code: ErrorCode.INTERNAL_ERROR, alert: true });
    expect(JSON.stringify(v.message)).not.toMatch(/fullNmae|prisma/);
  });
});

describe('transport errors and everything else', () => {
  it('malformed JSON and oversized bodies (body-parser)', () => {
    expect(classifyException(Object.assign(new SyntaxError('Unexpected token } in JSON at position 12'), { type: 'entity.parse.failed', status: 400 })))
      .toMatchObject({ status: 400, code: ErrorCode.MALFORMED_JSON, alert: false });
    expect(classifyException(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 })))
      .toMatchObject({ status: 413, code: ErrorCode.PAYLOAD_TOO_LARGE, alert: false });
  });
  it('other http-errors 4xx keep their status with a generic message', () => {
    const c = classifyException(Object.assign(new Error('Cannot GET /x with secret'), { status: 404 }));
    expect(c).toMatchObject({ status: 404, code: ErrorCode.NOT_FOUND });
    expect(JSON.stringify(c.message)).not.toMatch(/secret/);
  });
  it('provider (axios) failures are 502 upstream errors, never the provider text', () => {
    const c = classifyException(Object.assign(new Error('Request failed with status code 401: {"error":"invalid key sk_live_abc"}'), { isAxiosError: true }));
    expect(c).toMatchObject({ status: 502, code: ErrorCode.UPSTREAM_ERROR, alert: true, retryable: true });
    expect(JSON.stringify(c.message)).not.toMatch(/sk_live|401/);
  });
  it('Redis outage → 503 CACHE_UNAVAILABLE', () => {
    const e = Object.assign(new Error('Reached the max retries per request limit (which is 20)'), { name: 'MaxRetriesPerRequestError' });
    expect(classifyException(e)).toMatchObject({ status: 503, code: ErrorCode.CACHE_UNAVAILABLE, subsystem: 'cache', alert: true });
  });
  it('socket errors → 503', () => {
    expect(classifyException(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), { code: 'ECONNREFUSED' })))
      .toMatchObject({ status: 503, code: ErrorCode.SERVICE_UNAVAILABLE });
  });
  it.each([[new Error('kaboom at C:\\secret\\path.ts'), 'Error'], ['a thrown string', 'string'], [null, 'object'], [undefined, 'undefined'], [{ weird: true }, 'object'], [42, 'number']])(
    'unknown throwable %# → 500 INTERNAL_ERROR with a generic message and an alert', (thrown: any, _type: string) => {
      const c = classifyException(thrown);
      expect([c.status, c.code, c.alert]).toEqual([500, ErrorCode.INTERNAL_ERROR, true]);
      expect(JSON.stringify(c.message)).not.toMatch(/kaboom|secret|path/);
    });
  it('the classifier never throws, even on hostile objects', () => {
    const hostile = new Proxy({}, { get() { throw new Error('trap'); }, has() { throw new Error('trap'); } });
    expect(() => classifyException(hostile)).not.toThrow();
  });
});
