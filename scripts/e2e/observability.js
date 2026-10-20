// LIVE end-to-end check of error handling, tracing, health and administrator alerting against the running API,
// a DISPOSABLE database and a LOCAL SMTP sink (scripts/e2e/smtp-sink-server.js). No external mail provider is contacted.
//
// Three phases, driven by an orchestrator that stops/starts the disposable PostgreSQL between them:
//   node observability.js up         database up    : contract, tracing, health, ops endpoints, test alert, malicious input
//   node observability.js down       database DOWN  : safe 503s, readiness 503, one sanitised critical alert
//   node observability.js recovered  database back  : service recovers without restart, no duplicate alerts, recovery notice
// Env: DATABASE_URL (disposable; only used in phase "up"), API_BASE, E2E_SINK_FILE, E2E_STATE (state file path).
process.env.E2E_NO_SECRET = '1';
require('./_guard');
const fs = require('fs');
const BASE = process.env.API_BASE;
const SINK = process.env.E2E_SINK_FILE;
const STATE = process.env.E2E_STATE;
const phase = process.argv[2];
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  [${phase}] ${name}  ->  ${JSON.stringify(got)}${ok ? '' : '  (wanted ' + JSON.stringify(want) + ')'}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, token, body, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { s: r.status, j, text, h: r.headers };
};
const mails = () => (fs.existsSync(SINK) ? fs.readFileSync(SINK, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const waitFor = async (pred, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = pred(); if (v) return v; await sleep(250); } return pred(); };
const NO_LEAK = [/postgres(ql)?:\/\//i, /eyJ[A-Za-z0-9_-]{10,}\./, /Bearer\s+\S{8,}/i, /\bat\s+\S+\s+\(.*:\d+:\d+\)/, /node_modules/, /SELECT\s+.*FROM/i, /C:\\Users/i];

(async () => {
  if (phase === 'up') {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const reg = await call('POST', '/auth/register', null, { clinicName: `Obs ${stamp}`, ownerName: 'Dr Obs', email: `obs${stamp}@e2e.test`, phone: '+919876543210', password: 'Corr3ct-Horse-Battery' });
    check('register works', reg.s, 201);
    const admin = reg.j.data;
    const T = admin.accessToken;
    const state = { token: T, userId: admin.user.id, clinicId: admin.clinic.id, email: `obs${stamp}@e2e.test` };
    fs.writeFileSync(STATE, JSON.stringify(state));

    // ── health
    const live = await call('GET', '/health/live'); check('health/live → 200 un-enveloped', [live.s, live.j?.status, live.j?.success], [200, 'ok', undefined]);
    const ready = await call('GET', '/health/ready'); check('health/ready → 200 database up, nothing else exposed', [ready.s, ready.j?.status, ready.j?.checks, Object.keys(ready.j).sort()], [200, 'ok', { database: 'up', cache: 'up' }, ['checks', 'status', 'timestamp']]);

    // ── contract + tracing
    const id = 'e2e-trace-' + stamp.toString(36);
    const nf = await call('GET', '/patients/00000000-0000-4000-8000-000000000000', T, undefined, { 'X-Request-Id': id });
    check('404 contract with the caller-supplied request id in header and body', [nf.s, nf.j?.error?.code, nf.h.get('x-request-id'), nf.j?.requestId, nf.j?.error?.requestId], [404, 'NOT_FOUND', id, id, id]);
    const bad = await call('GET', '/health/live', null, undefined, { 'X-Request-Id': 'bad id with spaces' });
    check('hostile request id is replaced, not reflected', /^[0-9a-f-]{36}$/.test(bad.h.get('x-request-id')), true);
    const un = await call('GET', '/patients', null); check('401 contract', [un.s, un.j?.error?.code, !!un.j?.requestId], [401, 'UNAUTHENTICATED', true]);
    const val = await call('POST', '/auth/login', null, { email: 'nope', password: 'x' }); check('validation contract lists fields', [val.s, val.j?.error?.code, val.j?.error?.details?.map((d) => d.field)], [400, 'VALIDATION_FAILED', ['email']]);
    const mal = await call('POST', '/auth/login', null, '{"email": "a@b.co", '); check('malformed JSON → 400 MALFORMED_JSON, no parser text', [mal.s, mal.j?.error?.code, /Unexpected|position|SyntaxError/i.test(mal.text)], [400, 'MALFORMED_JSON', false]);
    const big = await call('POST', '/auth/login', null, JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2_000_000) })); check('oversized body → 413 contract', [big.s, big.j?.error?.code], [413, 'PAYLOAD_TOO_LARGE']);

    // ── malicious input never produces a 5xx or leaks internals
    const attacks = [
      call('GET', "/patients?search=' OR 1=1; DROP TABLE patients;--", T),
      call('POST', '/patients', T, { fullName: '<script>alert(1)</script>', phone: '+919000000000' }),
      call('GET', '/patients?search=../../etc/passwd', T),
      call('POST', '/patients', T, { fullName: 'x', phone: { $gt: '' } }),
      call('GET', '/patients/not-a-uuid', T),
    ];
    const res = await Promise.all(attacks);
    check('malicious input → 4xx only', res.map((r) => r.s >= 400 && r.s < 500), [true, true, true, true, true]);
    check('…and no internals in any error body', res.some((r) => NO_LEAK.some((re) => re.test(r.text))), false);

    // ── ops endpoints (platform operator only)
    check('clinic_admin cannot read ops metrics', (await call('GET', '/ops/metrics', T)).s, 403);
    check('clinic_admin cannot send a test alert', (await call('POST', '/ops/alerts/test?wait=true', T)).s, 403);
    check('unauthenticated cannot read ops metrics', (await call('GET', '/ops/metrics', null)).s, 401);
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'super_admin' } });       // role is read from the DB on every request
    const m = await call('GET', '/ops/metrics', T);
    check('super_admin reads metrics: request + error counters present', [m.s, Object.keys(m.j.data.counters).some((k) => k.startsWith('http_requests_total')), Object.keys(m.j.data.counters).some((k) => k.startsWith('errors_total'))], [200, true, true]);
    const st = await call('GET', '/ops/alerts/status?verify=true', T);
    check('alert status: enabled, one recipient, SMTP connection verified, no addresses/secrets exposed', [st.s, st.j.data.enabled, st.j.data.recipientsConfigured, st.j.data.smtpConnection?.ok, /@|smtp\.|password/i.test(JSON.stringify(st.j))], [200, true, 1, true, false]);

    // ── explicit protected test alert: real SMTP exchange with the local sink
    const before = mails().length;
    const ta = await call('POST', '/ops/alerts/test?wait=true', T);
    check('test alert: SMTP server accepted the message', [ta.s, ta.j.data.outcome], [200, 'smtp_accepted']);
    const got = await waitFor(() => mails().slice(before).find((x) => /TEST_ALERT/.test(x.subject)));
    check('sink received the test alert with a labelled subject', [!!got, got && /\[TEST/.test(got.subject)], [true, true]);
    check('test alert contains required fields and no secrets', [['Environment', 'Service', 'Severity', 'Error code', 'Request / trace id', 'Subsystem'].every((f) => got.raw.includes(f)), NO_LEAK.some((re) => re.test(got.raw))], [true, false]);
    await prisma.$disconnect();
  }

  if (phase === 'down') {
    const S = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const T = S.token;
    const live = await call('GET', '/health/live'); check('process still live', live.s, 200);
    const ready = await call('GET', '/health/ready'); check('readiness reports the database DOWN with 503 and no internals', [ready.s, ready.j?.status, ready.j?.checks?.database, ready.h.get('retry-after'), /postgres|5432|55432|password|ECONN|prisma/i.test(ready.text)], [503, 'unavailable', 'down', '5', false]);
    const id = 'e2e-dbdown-' + Date.now().toString(36);
    const r = await call('GET', '/patients', T, undefined, { 'X-Request-Id': id });
    check('authenticated read while the database is down → safe 503 contract', [r.s, r.j?.error?.code, r.j?.error?.retryable, r.j?.requestId, r.h.get('retry-after')], [503, 'DB_UNAVAILABLE', true, id, '5']);
    check('503 body leaks nothing', NO_LEAK.some((re) => re.test(r.text)) || /55432|127\.0\.0\.1|m7_test|prisma|P1001/i.test(r.text), false);
    const lg = await call('POST', '/auth/login', null, { email: S.email, password: 'Corr3ct-Horse-Battery' });
    check('login while the database is down → 503 (not 500, not a false 401)', [lg.s, lg.j?.error?.code], [503, 'DB_UNAVAILABLE']);
    for (let i = 0; i < 4; i++) await call('GET', '/patients', T);
    const alert = await waitFor(() => mails().find((x) => /DB_UNAVAILABLE/.test(x.subject) && !/RECOVERED/.test(x.subject)), 20000);
    check('a critical DB_UNAVAILABLE alert reached the sink', [!!alert, alert && /\[CRITICAL\]/.test(alert.subject)], [true, true]);
    await sleep(2500);
    check('repeated failures and the health monitor produced exactly ONE database alert', mails().filter((x) => /DB_UNAVAILABLE/.test(x.subject) && !/RECOVERED/.test(x.subject)).length, 1);
    check('alert carries a request/trace id and is free of secrets, tokens, connection strings and the user email', [/Request \/ trace id: \S{8,}/.test(alert.raw), NO_LEAK.some((re) => re.test(alert.raw)) || alert.raw.includes(S.email) || /55432|m7_test/.test(alert.raw)], [true, false]);
  }

  if (phase === 'recovered') {
    const S = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    const T = S.token;
    const ready = await waitFor(async () => false, 0).then(async () => { for (let i = 0; i < 40; i++) { const x = await call('GET', '/health/ready'); if (x.s === 200) return x; await sleep(500); } return call('GET', '/health/ready'); });
    check('readiness recovers without restarting the API', [ready.s, ready.j?.checks?.database], [200, 'up']);
    const pts = await call('GET', '/patients', T); check('authenticated requests work again', pts.s, 200);
    const rec = await waitFor(() => mails().find((x) => /DB_UNAVAILABLE_RECOVERED/.test(x.subject)), 20000);
    check('a recovery notice was sent once the monitor saw the database healthy', !!rec, true);
    check('still exactly ONE outage alert (no duplicates after recovery)', mails().filter((x) => /DB_UNAVAILABLE/.test(x.subject) && !/RECOVERED/.test(x.subject)).length, 1);
    const m = await call('GET', '/ops/metrics', T);
    const c = m.j?.data?.counters ?? {};
    check('metrics recorded the outage: DB_UNAVAILABLE errors, alert accepted, db_up back to 1', [Object.entries(c).some(([k, v]) => k.includes('DB_UNAVAILABLE') && v > 0), (c.alerts_smtp_accepted_total ?? 0) >= 2, m.j?.data?.gauges?.db_up], [true, true, 1]);
    check('every alert e-mail in the sink is free of secrets and personal data', mails().some((x) => NO_LEAK.some((re) => re.test(x.raw)) || x.raw.includes(S.email)), false);
  }

  console.log(`\n[${phase}] ${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E error:', e.message); process.exit(2); });
