/**
 * Frontend error handling, tested from the API workspace (the web app has no test runner; these modules are
 * dependency-free TypeScript by design). Covers: the shared API error parser, retry policy, submit guard, form payload
 * builders validated against the REAL API DTOs, the axios client (request ids, timeout, single-flight refresh with
 * rotated refresh tokens, no masking of failures) and structural checks that error boundaries / error states exist.
 * Rendering of React components is NOT covered (no DOM test environment is installed); see the status report.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ValidationPipe } from '@nestjs/common';
import { createSubmitGuard, describeApiError, fieldErrors, newRequestId, parseApiError, shouldRetryQuery } from '../../web/src/lib/api-error';
import { buildBookingPayload, buildPatientPayload } from '../../web/src/lib/payloads';
import { CreatePatientDto } from './modules/patients/dto/patient.dto';
import { BookAppointmentDto } from './modules/appointments/dto/book-appointment.dto';

const WEB = path.resolve(__dirname, '../../web/src');
const server = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ isAxiosError: true, response: { status, data: body, headers } });
const envelope = (status: number, code: string, message: string | string[], extra: Record<string, unknown> = {}) =>
  server(status, { success: false, statusCode: status, message, requestId: 'req-abcdef12', error: { code, message, requestId: 'req-abcdef12', ...extra } });

describe('parseApiError', () => {
  it('network failure (no response)', () => {
    expect(parseApiError({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error', request: {} })).toMatchObject({ kind: 'network', retryable: true, message: expect.stringMatching(/Cannot reach the server/) });
  });
  it.each([[{ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' }], [{ name: 'TimeoutError', message: 'The operation timed out' }]])('timeout %#', (e) => {
    expect(parseApiError(e).kind).toBe('timeout');
  });
  it('validation (400) keeps the safe server text and exposes field issues', () => {
    const i = parseApiError(envelope(400, 'VALIDATION_FAILED', ['email must be an email', 'password too short'], { details: [{ field: 'email', message: 'email must be an email' }, { field: 'password', message: 'password too short' }] }));
    expect(i).toMatchObject({ kind: 'validation', status: 400, code: 'VALIDATION_FAILED', requestId: 'req-abcdef12' });
    expect(i.message).toContain('email must be an email');
    expect(fieldErrors(i)).toEqual({ email: ['email must be an email'], password: ['password too short'] });
  });
  it.each([
    [401, 'unauthenticated', /session has expired/i], [403, 'forbidden', /permission/i], [404, 'not_found', /./], [409, 'conflict', /./],
    [429, 'rate_limited', /Too many/i], [502, 'unavailable', /temporarily unavailable/i], [503, 'unavailable', /temporarily unavailable/i], [504, 'unavailable', /./], [500, 'server', /Something went wrong/i],
  ])('status %i → %s', (status, kind, msg) => {
    const i = parseApiError(envelope(status, 'X', ''));
    expect(i.kind).toBe(kind); expect(i.message).toMatch(msg); expect(i.status).toBe(status);
  });
  it('4xx shows the server text (authored to be safe); 5xx NEVER shows server text, SQL or paths', () => {
    expect(parseApiError(envelope(409, 'CONFLICT', 'Slot already booked')).message).toBe('Slot already booked');
    const leaky = server(500, { message: 'PrismaClientKnownRequestError: SELECT * FROM patients at C:\\app\\x.ts', error: { message: 'SELECT * FROM patients' } });
    const i = parseApiError(leaky);
    expect(i.message).not.toMatch(/SELECT|Prisma|C:\\/);
    expect(describeApiError(leaky)).not.toMatch(/SELECT|Prisma|C:\\/);
  });
  it('rate limit and outage carry retry guidance from the body or the Retry-After header', () => {
    expect(parseApiError(envelope(429, 'RATE_LIMITED', 'x', { retryable: true, retryAfterSeconds: 60 })).retryAfterSeconds).toBe(60);
    expect(parseApiError(server(503, {}, { 'retry-after': '5' })).retryAfterSeconds).toBe(5);
    expect(describeApiError(envelope(429, 'RATE_LIMITED', 'x', { retryAfterSeconds: 30 }))).toMatch(/Try again in 30s/);
  });
  it('support reference: request id from body, nested error or header; unsafe ids are ignored', () => {
    expect(parseApiError(server(500, {}, { 'x-request-id': 'hdr-12345678' })).requestId).toBe('hdr-12345678');
    expect(parseApiError(server(500, { requestId: '<script>x</script>' })).requestId).toBeUndefined();
    expect(describeApiError(envelope(500, 'INTERNAL_ERROR', 'x'))).toMatch(/\(ref req-abcd/);
  });
  it('is total: odd inputs never throw and never look like success', () => {
    for (const v of [null, undefined, 42, 'str', {}, { response: {} }, { response: { status: 'x' } }, { response: { status: 500, data: 'html page' } }, { response: { status: 400, data: { error: { details: 'nope' } } } }]) {
      const i = parseApiError(v);
      expect(i.message).toBeTruthy(); expect(['unknown', 'server', 'validation']).toContain(i.kind);
    }
  });
  it('limits oversized server text and detail lists', () => {
    const i = parseApiError(envelope(400, 'X', 'x'.repeat(5000), { details: Array.from({ length: 500 }, (_, n) => ({ field: `f${n}`, message: 'm'.repeat(1000) })) }));
    expect(i.message.length).toBeLessThanOrEqual(301); expect(i.details).toHaveLength(50); expect(i.details[0].message.length).toBeLessThanOrEqual(201);
  });
});

describe('retry policy and submit guard', () => {
  it('retries only transient failures, at most twice, never client errors', () => {
    for (const e of [{ isAxiosError: true, code: 'ERR_NETWORK', request: {} }, server(503, {}), server(500, {}), server(429, {})]) { expect(shouldRetryQuery(0, e)).toBe(true); expect(shouldRetryQuery(1, e)).toBe(true); expect(shouldRetryQuery(2, e)).toBe(false); }
    for (const s of [400, 401, 403, 404, 409, 422]) expect(shouldRetryQuery(0, server(s, {}))).toBe(false);
  });
  it('the submit guard runs one action at a time and releases after success or failure', async () => {
    const guard = createSubmitGuard(); let calls = 0; let release!: () => void;
    const first = guard.run(() => { calls++; return new Promise<string>((r) => { release = () => r('done'); }); });
    expect(guard.pending).toBe(true);
    expect(await guard.run(async () => { calls++; return 'second'; })).toBeUndefined();   // double click ignored
    release(); expect(await first).toBe('done'); expect(calls).toBe(1); expect(guard.pending).toBe(false);
    await expect(guard.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(guard.pending).toBe(false);
    expect(await guard.run(async () => 'again')).toBe('again');
  });
  it('request ids are unique and satisfy the server-side acceptance pattern', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/);
  });
});

describe('form payloads are accepted by the real API DTOs (they used to be rejected with 400)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const check = async (payload: object, metatype: any) => pipe.transform(payload, { type: 'body', metatype });

  it('REGRESSION: the raw add-patient form values (gender "MALE", empty optionals) are rejected', async () => {
    const raw = { fullName: 'Asha', phone: '+91 98765 43210', email: '', dateOfBirth: '', gender: 'MALE', bloodGroup: '', address: '' };
    await expect(check(raw, CreatePatientDto)).rejects.toMatchObject({ status: 400 });
  });
  it('buildPatientPayload fixes it: lower-case gender, empty optionals dropped, phone without spaces', async () => {
    const payload = buildPatientPayload({ fullName: ' Asha Rao ', phone: '+91 98765-43210', email: '', dateOfBirth: '', gender: 'FEMALE', bloodGroup: '', address: '' });
    expect(payload).toEqual({ fullName: 'Asha Rao', phone: '+919876543210', gender: 'female' });
    await expect(check(payload, CreatePatientDto)).resolves.toMatchObject({ fullName: 'Asha Rao', gender: 'female' });
    const full = buildPatientPayload({ fullName: 'A', phone: '9876543210', email: 'a@b.co', dateOfBirth: '1990-05-01', gender: 'OTHER', bloodGroup: 'AB+', address: '1 Main St' });
    await expect(check(full, CreatePatientDto)).resolves.toBeDefined();
  });
  it('REGRESSION: slot times from the slot list ("09:00:00") are rejected as startTime', async () => {
    await expect(check({ patientId: '44444444-4444-4444-8444-444444444444', dentistId: '55555555-5555-4555-8555-555555555555', date: '2031-06-16', startTime: '09:00:00', type: 'consultation' }, BookAppointmentDto)).rejects.toMatchObject({ status: 400 });
  });
  it('buildBookingPayload fixes it and keeps only meaningful optionals', async () => {
    const payload = buildBookingPayload({ patientId: '44444444-4444-4444-8444-444444444444', startTime: '09:00:00', type: 'root_canal', chiefComplaint: '  ', estimatedCost: '' }, '55555555-5555-4555-8555-555555555555', '2031-06-16');
    expect(payload).toEqual({ patientId: '44444444-4444-4444-8444-444444444444', dentistId: '55555555-5555-4555-8555-555555555555', date: '2031-06-16', startTime: '09:00', type: 'root_canal', bookedVia: 'web' });
    await expect(check(payload, BookAppointmentDto)).resolves.toMatchObject({ startTime: '09:00' });
    const withExtras = buildBookingPayload({ patientId: '44444444-4444-4444-8444-444444444444', startTime: '10:30', type: 'cleaning', chiefComplaint: 'pain', estimatedCost: '1500' }, '55555555-5555-4555-8555-555555555555', '2031-06-16');
    expect(withExtras).toMatchObject({ chiefComplaint: 'pain', estimatedCost: 1500 });
    await expect(check(withExtras, BookAppointmentDto)).resolves.toBeDefined();
  });
});

describe('axios client (apps/web/src/lib/api.ts)', () => {
  const store: Record<string, string> = {};
  const g = globalThis as any;
  let api: any; let API_TIMEOUT_MS: number;
  let calls: Array<{ url: string; headers: Record<string, string> }>;
  let handler: (req: { url: string; headers: any; data: any }) => { status: number; data?: any } | Promise<{ status: number; data?: any }>;

  beforeAll(async () => {
    g.window = { location: { href: '/' } };
    g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, clear: () => { for (const k of Object.keys(store)) delete store[k]; } };
    const mod = await import('../../web/src/lib/api');
    api = mod.api; API_TIMEOUT_MS = mod.API_TIMEOUT_MS;
    api.defaults.adapter = async (config: any) => {
      const hdr = config.headers.toJSON ? config.headers.toJSON() : config.headers;
      calls.push({ url: config.url, headers: hdr });
      const r = await handler({ url: config.url, headers: hdr, data: config.data });
      const res = { status: r.status, statusText: String(r.status), data: r.data, headers: {}, config, request: {} };
      if (r.status >= 200 && r.status < 300) return res;
      throw Object.assign(new Error(`Request failed with status code ${r.status}`), { isAxiosError: true, config, response: res, name: 'AxiosError' });
    };
  });
  afterAll(() => { delete g.window; delete g.localStorage; });
  beforeEach(() => { calls = []; for (const k of Object.keys(store)) delete store[k]; g.window.location.href = '/'; });

  it('every request has a unique X-Request-Id, the bearer token and a hard timeout', async () => {
    store.access_token = 'AT1'; handler = () => ({ status: 200, data: { data: 1 } });
    await api.get('/a'); await api.get('/b');
    expect(calls[0].headers['X-Request-Id']).not.toBe(calls[1].headers['X-Request-Id']);
    expect(calls[0].headers['X-Request-Id']).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/);
    expect(calls[0].headers.Authorization).toBe('Bearer AT1');
    expect(API_TIMEOUT_MS).toBeGreaterThan(0); expect(api.defaults.timeout).toBe(API_TIMEOUT_MS);
  });
  it('failures are rejected (never turned into empty data) and carry a safe parsed description', async () => {
    handler = () => ({ status: 503, data: { error: { code: 'DB_UNAVAILABLE', message: 'The database is temporarily unavailable.', requestId: 'req-abcdef12', retryable: true, retryAfterSeconds: 5 } } });
    const err: any = await api.get('/patients').catch((e: unknown) => e);
    expect(err.response.status).toBe(503);
    expect(err.apiError).toMatchObject({ kind: 'unavailable', code: 'DB_UNAVAILABLE', requestId: 'req-abcdef12', retryable: true });
  });
  it('401 → refresh once, STORE THE ROTATED REFRESH TOKEN, replay the request with the new access token', async () => {
    store.access_token = 'OLD'; store.refresh_token = 'RT1';
    let first = true;
    handler = (req) => {
      if (String(req.url).endsWith('/auth/refresh')) return { status: 200, data: { data: { accessToken: 'NEW', refreshToken: 'RT2' } } };
      if (first) { first = false; return { status: 401, data: {} }; }
      return { status: 200, data: { data: 'ok' } };
    };
    // the refresh call goes through global axios.post, not the instance: route it through the same adapter
    const axios = (await import('axios')).default; axios.defaults.adapter = api.defaults.adapter;
    const r = await api.get('/patients');
    expect(r.data.data).toBe('ok');
    expect(store.access_token).toBe('NEW'); expect(store.refresh_token).toBe('RT2');
    expect(calls.filter((c) => String(c.url).endsWith('/auth/refresh'))).toHaveLength(1);
    expect(calls.at(-1)!.headers.Authorization).toBe('Bearer NEW');
  });
  it('parallel 401s share ONE refresh call (a second refresh with the rotated-away token would log the user out)', async () => {
    store.access_token = 'OLD'; store.refresh_token = 'RT1';
    let refreshCalls = 0; const seen401 = new Set<string>();
    handler = async (req) => {
      if (String(req.url).endsWith('/auth/refresh')) { refreshCalls++; await new Promise((r) => setTimeout(r, 20)); return { status: 200, data: { data: { accessToken: 'NEW', refreshToken: 'RT2' } } }; }
      if (req.headers.Authorization === 'Bearer OLD') { seen401.add(req.url); return { status: 401, data: {} }; }
      return { status: 200, data: { data: req.url } };
    };
    const axios = (await import('axios')).default; axios.defaults.adapter = api.defaults.adapter;
    const results = await Promise.all(['/a', '/b', '/c', '/d'].map((u) => api.get(u)));
    expect(results.map((r: any) => r.data.data)).toEqual(['/a', '/b', '/c', '/d']);
    expect(refreshCalls).toBe(1); expect(seen401.size).toBe(4);
  });
  it('refresh failure clears the session and sends the user to /login; the original error still rejects', async () => {
    store.access_token = 'OLD'; store.refresh_token = 'BAD';
    handler = (req) => (String(req.url).endsWith('/auth/refresh') ? { status: 401, data: {} } : { status: 401, data: {} });
    const axios = (await import('axios')).default; axios.defaults.adapter = api.defaults.adapter;
    await expect(api.get('/patients')).rejects.toBeDefined();
    expect(g.window.location.href).toBe('/login'); expect(store.access_token).toBeUndefined();
  });
  it('a request is replayed at most once (no refresh loop)', async () => {
    store.access_token = 'OLD'; store.refresh_token = 'RT1';
    let n = 0;
    handler = (req) => { if (String(req.url).endsWith('/auth/refresh')) return { status: 200, data: { data: { accessToken: 'NEW', refreshToken: 'RT2' } } }; n++; return { status: 401, data: {} }; };
    const axios = (await import('axios')).default; axios.defaults.adapter = api.defaults.adapter;
    await expect(api.get('/patients')).rejects.toBeDefined();
    expect(n).toBe(2);
  });
  it('auth endpoints never trigger a refresh', async () => {
    store.refresh_token = 'RT1'; handler = () => ({ status: 401, data: {} });
    await expect(api.post('/auth/login', {})).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });
  it('the client no longer re-reports API failures (no response bodies sent to /errors/client, no alert amplification)', () => {
    const src = fs.readFileSync(path.join(WEB, 'lib/api.ts'), 'utf8');
    expect(src).not.toMatch(/reportClientError|responseBody/);
  });
});

describe('structural checks: boundaries and error states exist and are wired', () => {
  const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8');
  it('route-level and global error boundaries and a not-found page exist', () => {
    for (const f of ['app/error.tsx', 'app/global-error.tsx', 'app/not-found.tsx', 'app/(dashboard)/error.tsx']) expect(fs.existsSync(path.join(WEB, f))).toBe(true);
    expect(read('app/error.tsx')).toMatch(/'use client'/);
    expect(read('app/global-error.tsx')).toMatch(/<html/);
    expect(read('app/(dashboard)/error.tsx')).toContain('ErrorState');
    expect(read('app/layout.tsx')).toContain('ErrorBoundary');
  });
  it.each([['patients', 'isError'], ['appointments', 'isError'], ['billing', 'isError'], ['dashboard', 'statsError']])('%s page renders ErrorState on a failed load and no longer shows the empty state for it', (page, flag) => {
    const src = read(`app/(dashboard)/${page}/page.tsx`);
    expect(src).toContain('<ErrorState');
    expect(src).toContain(flag);
    if (page !== 'dashboard') expect(src).toMatch(/!isLoading && !isError && /);
  });
  it('mutations surface parsed errors and forms guard against double submission', () => {
    expect(read('components/appointments/book-modal.tsx')).toMatch(/describeApiError\(e, 'Booking failed'\)/);
    expect(read('components/appointments/book-modal.tsx')).toMatch(/if \(book\.isPending\) return/);
    expect(read('app/(dashboard)/patients/page.tsx')).toMatch(/if \(saving\) return/);
    expect(read('app/(dashboard)/patients/page.tsx')).toContain('buildPatientPayload');
    expect(read('app/providers.tsx')).toMatch(/mutations: \{ retry: false \}/);
  });
});
