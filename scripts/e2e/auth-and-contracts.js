// LIVE end-to-end check against the running API + DISPOSABLE database + throwaway Redis, with NO locally signed tokens:
// every token comes from the real register/login/refresh endpoints.
//   authentication: register, duplicate, login, wrong password, lockout, refresh rotation + replay, logout + immediate revocation
//   contracts used by the web client: PATCH patient, PUT 404, GET /patients/stats, POST reschedule, PATCH notifications/read
// Env: DATABASE_URL (disposable), API_BASE. Run with a fresh API process (login 10/min, register 5/min limits apply).
process.env.E2E_NO_SECRET = '1';
require('./_guard');
const { PrismaClient } = require('@prisma/client');
const BASE = process.env.API_BASE;
const prisma = new PrismaClient();
const stamp = Date.now();
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ->  ${JSON.stringify(got)}${ok ? '' : '  (wanted ' + JSON.stringify(want) + ')'}`); };
const call = async (method, path, token, body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, d: j?.data ?? j, j };
};

(async () => {
  const email = `auth${stamp}@e2e.test`, password = 'Corr3ct-Horse-Battery';
  const reg = { clinicName: `E2E Clinic ${stamp}`, ownerName: 'Dr E2E', email, phone: '+919876543210', password };

  // ── registration
  const r1 = await call('POST', '/auth/register', null, reg);
  check('register → 201 with a token pair', [r1.s, !!r1.d?.accessToken, !!r1.d?.refreshToken], [201, true, true]);
  check('register response has no password hash', /passwordHash|\$2[aby]\$/.test(JSON.stringify(r1.j)), false);
  check('register as clinic_admin', r1.d?.user?.role, 'clinic_admin');
  check('duplicate clinic email → 409', (await call('POST', '/auth/register', null, reg)).s, 409);
  check('weak password → 400', (await call('POST', '/auth/register', null, { ...reg, email: `w${stamp}@e2e.test`, password: 'short' })).s, 400);
  check('object as password → 400 (no "[object Object]" coercion)', (await call('POST', '/auth/register', null, { ...reg, email: `o${stamp}@e2e.test`, password: { a: 1 } })).s, 400);
  const clinicId = r1.d.clinic.id, adminId = r1.d.user.id;

  // ── token validation
  check('GET /auth/me with the registration token → 200', (await call('GET', '/auth/me', r1.d.accessToken)).s, 200);
  check('garbage token → 401', (await call('GET', '/auth/me', 'abc.def.ghi')).s, 401);
  check('no token → 401', (await call('GET', '/auth/me', null)).s, 401);

  // ── login + lockout (login budget: 1 ok + 5 wrong + 1 locked + 1 after unlock = 8 of 10/min)
  const l1 = await call('POST', '/auth/login', null, { email, password });
  check('login with correct password → 200 + tokens', [l1.s, !!l1.d?.accessToken], [200, true]);
  const wrong = [];
  for (let i = 0; i < 5; i++) wrong.push((await call('POST', '/auth/login', null, { email, password: 'wrong-' + i })).s);
  check('5 wrong passwords → 401 each', wrong, [401, 401, 401, 401, 401]);
  const locked = await call('POST', '/auth/login', null, { email, password });
  check('correct password while locked → 401 "locked"', [locked.s, /locked/i.test(JSON.stringify(locked.j))], [401, true]);
  const row = await prisma.user.findUnique({ where: { id: adminId } });
  check('lock is stored (~15 min) and counter = 5', [row.failedLoginCount, row.lockedUntil > new Date(Date.now() + 14 * 60_000)], [5, true]);
  await prisma.user.update({ where: { id: adminId }, data: { lockedUntil: new Date(Date.now() - 1000) } });   // simulate the 15 minutes elapsing
  const l2 = await call('POST', '/auth/login', null, { email, password });
  check('after the lock expires, login works and the counter resets', [l2.s, (await prisma.user.findUnique({ where: { id: adminId } })).failedLoginCount], [200, 0]);

  // ── refresh rotation + replay
  const rf = await call('POST', '/auth/refresh', null, { refreshToken: l2.d.refreshToken });
  check('refresh → 200 with a NEW pair', [rf.s, rf.d?.refreshToken !== l2.d.refreshToken], [200, true]);
  check('REPLAY of the rotated refresh token → 401', (await call('POST', '/auth/refresh', null, { refreshToken: l2.d.refreshToken })).s, 401);
  check('access token from the refreshed pair works', (await call('GET', '/auth/me', rf.d.accessToken)).s, 200);
  check('refresh with garbage → 401', (await call('POST', '/auth/refresh', null, { refreshToken: 'garbage' })).s, 401);
  check('refresh without a token → 400', (await call('POST', '/auth/refresh', null, {})).s, 400);

  // ── contracts the web client relies on (token = the refreshed admin; role flipped in the DB to test redaction)
  const T = rf.d.accessToken;
  const pat = await call('POST', '/patients', T, { fullName: 'E2E Patient', phone: '+919000000001' });
  check('create patient → 201', pat.s, 201);
  const pid = pat.d.id;
  await prisma.patient.update({ where: { id: pid }, data: { outstandingBalance: 777, lastVisitDate: new Date() } });
  const up = await call('PATCH', `/patients/${pid}`, T, { fullName: 'Renamed E2E', city: 'Pune' });
  check('PATCH /patients/:id → 200 and persisted', [up.s, up.d?.fullName, (await prisma.patient.findUnique({ where: { id: pid } })).city], [200, 'Renamed E2E', 'Pune']);
  check('PUT /patients/:id → 404 (not an API route)', (await call('PUT', `/patients/${pid}`, T, { fullName: 'x' })).s, 404);
  const hack = await call('PATCH', `/patients/${pid}`, T, { outstandingBalance: 0, clinicId: '00000000-0000-4000-8000-000000000000', patientCode: 'HACK' });
  const afterHack = await prisma.patient.findUnique({ where: { id: pid } });
  check('mass assignment ignored (balance, clinic, code unchanged)', [hack.s, Number(afterHack.outstandingBalance), afterHack.clinicId, afterHack.patientCode === 'HACK'], [200, 777, clinicId, false]);
  check('bad payload → 400', (await call('PATCH', `/patients/${pid}`, T, { email: 'nope' })).s, 400);
  const st = await call('GET', '/patients/stats', T);
  check('GET /patients/stats (owner) → counts + outstanding', [st.s, st.d?.total, st.d?.active, st.d?.totalOutstanding], [200, 1, 1, 777]);
  await prisma.user.update({ where: { id: adminId }, data: { role: 'assistant' } });      // role is read from the DB on every request
  const stA = await call('GET', '/patients/stats', T);
  check('GET /patients/stats (assistant) → counts only, restricted flag, no money', [stA.s, stA.d?.total, 'totalOutstanding' in (stA.d ?? {}), stA.d?.financialsRestricted], [200, 1, false, true]);
  const upA = await call('PATCH', `/patients/${pid}`, T, { city: 'Mumbai' });
  check('PATCH response (assistant) has no outstandingBalance', [upA.s, 'outstandingBalance' in (upA.d ?? {})], [200, false]);
  check('assistant cannot reschedule (appointments:write)', (await call('POST', `/appointments/${'00000000-0000-4000-8000-000000000001'}/reschedule`, T, { date: '2031-09-02', startTime: '10:00' })).s, 403);
  await prisma.user.update({ where: { id: adminId }, data: { role: 'clinic_admin' } });

  // reschedule: slots + booking through the API
  const day1 = '2031-09-01', day2 = '2031-09-02';
  await prisma.appointmentSlot.createMany({ data: [
    { clinicId, dentistId: adminId, slotDate: new Date(day1), startTime: '09:00:00', endTime: '09:30:00' },
    { clinicId, dentistId: adminId, slotDate: new Date(day2), startTime: '10:00:00', endTime: '10:30:00' },
  ] });
  const bk = await call('POST', '/appointments', T, { patientId: pid, dentistId: adminId, date: day1, startTime: '09:00', type: 'consultation' });
  check('book → 201', bk.s, 201);
  const rs = await call('POST', `/appointments/${bk.d.id}/reschedule`, T, { date: day2, startTime: '10:00', reason: 'e2e' });
  check('POST …/reschedule → 2xx and moved', [rs.s < 300, (await prisma.appointment.findFirst({ where: { clinicId, status: 'scheduled' } }))?.startTime], [true, '10:00:00']);
  check('PATCH …/reschedule → 404', (await call('PATCH', `/appointments/${bk.d.id}/reschedule`, T, { date: day2, startTime: '10:00' })).s, 404);
  check('reschedule into an unavailable slot → 400', (await call('POST', `/appointments/${bk.d.id}/reschedule`, T, { date: '2031-09-05', startTime: '10:00' })).s, 400);

  // notifications
  const mkN = (userId) => prisma.notification.create({ data: { clinicId, userId, channel: 'push', type: 'appointment_confirmation', body: 'e2e' } });
  const n1 = await mkN(adminId), n2 = await mkN(adminId);
  const stranger = await prisma.user.create({ data: { clinicId, email: `st${stamp}@e2e.test`, passwordHash: 'x', fullName: 's', role: 'dentist' } });
  const n3 = await mkN(stranger.id);
  const mr = await call('PATCH', '/notifications/read', T, { ids: [n1.id, n3.id] });
  const reads = async (ids) => (await prisma.notification.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } })).map((n) => !!n.readAt);
  check('PATCH /notifications/read marks MY notification, not another user\'s', [mr.s, await reads([n1.id, n2.id, n3.id])], [200, [true, false, false]]);
  check('PATCH /notifications/:id/read → 404', (await call('PATCH', `/notifications/${n2.id}/read`, T)).s, 404);
  check('invalid ids → 400', (await call('PATCH', '/notifications/read', T, { ids: ['abc'] })).s, 400);
  check('read-all marks the rest of mine', [(await call('PATCH', '/notifications/read-all', T)).s, await reads([n2.id, n3.id])], [200, [true, false]]);

  // ── logout + immediate revocation
  const lo = await call('POST', '/auth/logout', T, { refreshToken: rf.d.refreshToken });
  check('logout → 204', lo.s, 204);
  check('the SAME access token is rejected immediately after logout', (await call('GET', '/auth/me', T)).s, 401);
  check('the logged-out refresh token cannot be used', (await call('POST', '/auth/refresh', null, { refreshToken: rf.d.refreshToken })).s, 401);
  check('a separate login session of the same user is unaffected', (await call('GET', '/auth/me', l1.d.accessToken)).s, 200);
  check('logout without a token → 401', (await call('POST', '/auth/logout', null, { refreshToken: 'x' })).s, 401);

  // ── cleanup
  await prisma.notification.deleteMany({ where: { clinicId } });
  await prisma.appointment.deleteMany({ where: { clinicId } }); await prisma.appointmentSlot.deleteMany({ where: { clinicId } });
  await prisma.patient.deleteMany({ where: { clinicId } });
  await prisma.userSession.deleteMany({ where: { clinicId } });
  await prisma.user.deleteMany({ where: { clinicId } }); await prisma.clinic.deleteMany({ where: { id: clinicId } });
  await prisma.$disconnect();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E error:', e.message); process.exit(2); });
