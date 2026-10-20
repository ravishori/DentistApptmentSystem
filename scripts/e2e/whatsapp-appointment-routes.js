require('./_guard');
// LIVE HTTP checks of the mounted WhatsApp + appointment mutation routes against the real app (disposable DB only).
// No provider is called: WhatsApp credentials are absent in the test process, so any accidental send fails locally.
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const BASE = process.env.API_BASE, SECRET = process.env.JWT_SECRET;
const prisma = new PrismaClient();
const stamp = Date.now();
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ->  ${JSON.stringify(got)}${ok ? '' : '  (wanted ' + JSON.stringify(want) + ')'}`); };

(async () => {
  const mkClinic = (k) => prisma.clinic.create({ data: { name: k, slug: `${k}${stamp}`, email: `${k}${stamp}@r.test` } });
  const A = await mkClinic('rta'), B = await mkClinic('rtb');
  const mkUser = (c, role) => prisma.user.create({ data: { clinicId: c.id, email: `${role}${c.slug}@r.test`, passwordHash: 'x', fullName: role, role } });
  const U = { adminA: await mkUser(A, 'clinic_admin'), docA: await mkUser(A, 'dentist'), recA: await mkUser(A, 'receptionist'), astA: await mkUser(A, 'assistant'), docB: await mkUser(B, 'dentist') };
  const tok = (u, c) => jwt.sign({ sub: u.id, email: u.email, role: u.role, clinicId: c.id, clinicSlug: c.slug, clinicName: c.name }, SECRET, { expiresIn: '5m' });
  const T = { rec: tok(U.recA, A), ast: tok(U.astA, A), doc: tok(U.docA, A), adm: tok(U.adminA, A), docB: tok(U.docB, B) };
  const mkPat = (c, tag, phone, waOptIn) => prisma.patient.create({ data: { clinicId: c.id, patientCode: `${tag}${stamp}`, fullName: tag, phone, waOptIn } });
  const pIn = await mkPat(A, 'in', '+910000008001', true), pOut = await mkPat(A, 'out', '+910000008002', false), pB = await mkPat(B, 'ob', '+910000008003', true);
  const day = '2031-08-01';
  const slotB = await prisma.appointmentSlot.create({ data: { clinicId: B.id, dentistId: U.docB.id, slotDate: new Date(day), startTime: '09:00:00', endTime: '09:30:00' } });
  const apptB = await prisma.appointment.create({ data: { clinicId: B.id, patientId: pB.id, dentistId: U.docB.id, slotId: slotB.id, appointmentDate: new Date(day), startTime: '09:00:00', endTime: '09:30:00', status: 'scheduled' } });

  const call = async (method, path, token, body, headers = {}) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };

  // ── authentication
  for (const [m, p, b] of [['POST', '/whatsapp/send', { to: pIn.phone, message: 'x' }], ['POST', '/whatsapp/send-template', { to: pIn.phone, templateName: 'appointment_followup', params: {} }],
    ['POST', '/appointments', {}], ['PATCH', `/appointments/${apptB.id}/status`, { status: 'confirmed' }], ['POST', `/appointments/${apptB.id}/reschedule`, { date: day, startTime: '10:00' }]])
    check(`no token → 401  ${m} ${p.replace(apptB.id, ':id')}`, (await call(m, p, null, b)).s, 401);

  // ── permissions: assistant has no whatsapp:send / appointments:write
  check('assistant → POST /whatsapp/send → 403', (await call('POST', '/whatsapp/send', T.ast, { to: pIn.phone, message: 'x' })).s, 403);
  check('assistant → POST /whatsapp/send-template → 403', (await call('POST', '/whatsapp/send-template', T.ast, { to: pIn.phone, templateName: 'appointment_followup', params: {} })).s, 403);
  check('assistant → POST /appointments → 403', (await call('POST', '/appointments', T.ast, { patientId: pIn.id, dentistId: U.docA.id, date: day, startTime: '09:00', type: 'consultation' })).s, 403);
  check('assistant → PATCH status → 403', (await call('PATCH', `/appointments/${apptB.id}/status`, T.ast, { status: 'confirmed' })).s, 403);
  check('assistant → POST reschedule → 403', (await call('POST', `/appointments/${apptB.id}/reschedule`, T.ast, { date: day, startTime: '10:00' })).s, 403);
  check('assistant can still READ appointments (unchanged, flagged)', (await call('GET', '/appointments', T.ast)).s, 200);

  // ── consent + tenant on manual send (nothing may reach a provider)
  const out = await call('POST', '/whatsapp/send', T.rec, { to: pOut.phone, message: 'hello' });
  check('receptionist → opted-out patient → 403 not opted in', [out.s, /not opted in/.test(JSON.stringify(out.j))], [403, true]);
  const unk = await call('POST', '/whatsapp/send', T.rec, { to: '+910000008099', message: 'hello' });
  check('receptionist → unknown number → 403', unk.s, 403);
  const xc = await call('POST', '/whatsapp/send', T.rec, { to: pB.phone, message: 'hello' });
  check('CROSS-CLINIC: clinic A user → clinic B opted-in patient → 403', xc.s, 403);
  const xt = await call('POST', '/whatsapp/send-template', T.rec, { to: pB.phone, templateName: 'appointment_followup', params: { a: 'b' } });
  check('CROSS-CLINIC template → 403', xt.s, 403);
  check('bad template name → 400', (await call('POST', '/whatsapp/send-template', T.rec, { to: pIn.phone, templateName: 'x', params: {} })).s, 400);
  check('bad number → 400', (await call('POST', '/whatsapp/send', T.rec, { to: '12345', message: 'x' })).s, 400);
  check('object as message → 400 (no "[object Object]" coercion)', (await call('POST', '/whatsapp/send', T.rec, { to: pIn.phone, message: { a: 1 } })).s, 400);
  check('no outbound message row was created by any rejected call', await prisma.whatsappMessage.count({ where: { clinicId: { in: [A.id, B.id] }, direction: 'outbound' } }), 0);

  // ── cross-clinic appointment mutation
  check('CROSS-CLINIC: A receptionist PATCH status on B appointment → 404', (await call('PATCH', `/appointments/${apptB.id}/status`, T.rec, { status: 'confirmed' })).s, 404);
  check('CROSS-CLINIC: A receptionist reschedule B appointment → 404', (await call('POST', `/appointments/${apptB.id}/reschedule`, T.rec, { date: day, startTime: '10:00' })).s, 404);
  check('CROSS-CLINIC: A receptionist GET B appointment → 404', (await call('GET', `/appointments/${apptB.id}`, T.rec)).s, 404);
  check('B appointment untouched', (await prisma.appointment.findUnique({ where: { id: apptB.id } })).status, 'scheduled');
  check('invalid input → 400 (status enum)', (await call('PATCH', `/appointments/${apptB.id}/status`, T.docB, { status: 'exploded' })).s, 400);
  check('owner clinic B can still confirm its own appointment', (await call('PATCH', `/appointments/${apptB.id}/status`, T.docB, { status: 'confirmed' })).s, 200);

  // ── public start-booking
  const sb = (b) => call('POST', '/whatsapp/start-booking', null, b);
  check('start-booking: bad body → 400', (await sb({ clinicId: 'nope', phone: '123' })).s, 400);
  const ok = await sb({ clinicId: A.id, phone: pOut.phone });
  check('start-booking: opted-out phone → 202 {accepted:true} and NOTHING sent', [ok.s, ok.j?.data], [202, { accepted: true }]);
  const ok2 = await sb({ clinicId: A.id, phone: '+910000008098' });
  check('start-booking: stranger phone → identical 202 answer', [ok2.s, ok2.j?.data], [202, { accepted: true }]);
  check('start-booking: no WhatsApp message/session rows created', await prisma.whatsappMessage.count({ where: { clinicId: A.id } }), 0);
  await sb({ clinicId: A.id, phone: pOut.phone });                 // 4th, 5th within the minute
  await sb({ clinicId: A.id, phone: pOut.phone });
  check('start-booking: 6th request within a minute → 429', (await sb({ clinicId: A.id, phone: pOut.phone })).s, 429);

  // ── cleanup
  const ids = [A.id, B.id];
  await prisma.whatsappMessage.deleteMany({ where: { clinicId: { in: ids } } }); await prisma.whatsappConversation.deleteMany({ where: { clinicId: { in: ids } } });
  await prisma.appointment.deleteMany({ where: { clinicId: { in: ids } } }); await prisma.appointmentSlot.deleteMany({ where: { clinicId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { clinicId: { in: ids } } }); await prisma.user.deleteMany({ where: { clinicId: { in: ids } } });
  await prisma.clinic.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E error:', e.message); process.exit(2); });
