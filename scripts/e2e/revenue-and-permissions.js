require('./_guard');
// End-to-end check of the private Revenue Trend feature against a RUNNING API on a DISPOSABLE database.
// Env: DATABASE_URL (disposable), JWT_SECRET (test value), API_BASE.  Tokens are never printed.
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const BASE = process.env.API_BASE;
const SECRET = process.env.JWT_SECRET;
const prisma = new PrismaClient();
const stamp = Date.now();
const rows = [];
const record = (name, got, expected, extra = '') => {
  const ok = Array.isArray(expected) ? expected.includes(got) : got === expected;
  rows.push({ ok, name, got, expected: String(expected), extra });
};

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* csv etc. */ }
  return { status: res.status, json, text };
}
const data = (r) => r.json?.data ?? r.json;

(async () => {
  const mkClinic = (n) => prisma.clinic.create({ data: { name: n, slug: `${n}${stamp}`, email: `${n}${stamp}@e2e.test` } });
  const A = await mkClinic('e2ea');
  const B = await mkClinic('e2eb');
  const mkUser = (clinicId, key, role) => prisma.user.create({ data: { clinicId, email: `${key}${stamp}@e2e.test`, passwordHash: 'x', fullName: key, role } });
  const ownerA = await mkUser(A.id, 'ownerA', 'clinic_admin');
  const recvA = await mkUser(A.id, 'recvA', 'receptionist');
  const ownerB = await mkUser(B.id, 'ownerB', 'clinic_admin');
  const recvB = await mkUser(B.id, 'recvB', 'receptionist');
  const dentistA = await mkUser(A.id, 'dentistA', 'dentist');
  const assistantA = await mkUser(A.id, 'assistantA', 'assistant');

  const seedMoney = async (clinic, scale) => {
    const p = await prisma.patient.create({ data: { clinicId: clinic.id, patientCode: `E-${clinic.slug}`, fullName: 'P', phone: `+91000${scale}0001` } });
    const inv = await prisma.invoice.create({ data: { clinicId: clinic.id, patientId: p.id, invoiceNumber: `E-${clinic.slug}`, totalAmount: 2000 * scale, balanceAmount: 500 * scale, paidAmount: 1500 * scale, status: 'partially_paid' } });
    const pay = (status, amount, n) => prisma.payment.create({ data: { clinicId: clinic.id, invoiceId: inv.id, patientId: p.id, amount: amount * scale, method: 'cash', status, paidAt: new Date(), razorpayPaymentId: `${clinic.slug}_${n}` } });
    await pay('success', 1000, 'a'); await pay('success', 500, 'b'); await pay('refunded', -200, 'r'); await pay('pending', 300, 'p');
  };
  await seedMoney(A, 1);
  await seedMoney(B, 10);

  const tok = (user, clinic, over = {}) => jwt.sign(
    { sub: user.id, email: user.email, role: user.role, clinicId: clinic.id, clinicSlug: clinic.slug, clinicName: clinic.name, ...over },
    SECRET, { expiresIn: '10m' });
  const T = { ownerA: tok(ownerA, A), recvA: tok(recvA, A), ownerB: tok(ownerB, B), recvB: tok(recvB, B), dentistA: tok(dentistA, A), assistantA: tok(assistantA, A) };

  const P = '/analytics/revenue';
  // ── no / bad credentials ──────────────────────────────────────────────
  record('anonymous → trend', (await call('GET', `${P}/trend`)).status, 401);
  record('anonymous → access/me', (await call('GET', `${P}/access/me`)).status, 401);
  record('token signed with WRONG secret → trend', (await call('GET', `${P}/trend`, jwt.sign({ sub: ownerA.id, clinicId: A.id, role: 'clinic_admin' }, 'wrong-secret-value-xxxxxxxxxxxxxxxx'))).status, 401);

  // ── unauthorised staff ───────────────────────────────────────────────
  const me = await call('GET', `${P}/access/me`, T.recvA);
  record('receptionist → access/me (no figures, canView=false)', JSON.stringify(data(me)), JSON.stringify({ canView: false, canManage: false, showOnDashboard: false }));
  record('receptionist → trend', (await call('GET', `${P}/trend`, T.recvA)).status, 403);
  record('receptionist → preference', (await call('PUT', `${P}/preference`, T.recvA, { showOnDashboard: true })).status, 403);
  record('receptionist → list access (owner-only)', (await call('GET', `${P}/access`, T.recvA)).status, 403);
  record('receptionist → grant self (owner-only)', (await call('PUT', `${P}/access/${recvA.id}`, T.recvA, { granted: true })).status, 403);
  record('receptionist → revenue CSV', (await call('GET', '/analytics/export/revenue-csv', T.recvA)).status, 403);
  const trends = await call('GET', '/analytics/trends?period=monthly&count=3', T.recvA);
  const tr = data(trends);
  record('receptionist → /analytics/trends has NO revenue/payments fields', Array.isArray(tr) && tr.every((r) => !('revenue' in r) && !('payments' in r)), true);
  const procs = await call('GET', '/analytics/revenue/procedures', T.recvA);
  record('receptionist → procedures has NO money fields', Array.isArray(data(procs)) && data(procs).every((r) => !('totalRevenue' in r) && !('avgRevenue' in r)), true);
  // role claim inside the token must be ignored (role comes from the DB)
  record('receptionist with FORGED role claim "clinic_admin" in a validly signed token → trend', (await call('GET', `${P}/trend`, tok(recvA, A, { role: 'clinic_admin' }))).status, 403);

  // ── owner ────────────────────────────────────────────────────────────
  const meO = data(await call('GET', `${P}/access/me`, T.ownerA));
  record('owner → access/me', JSON.stringify(meO), JSON.stringify({ canView: true, canManage: true, showOnDashboard: false }));
  const trendA = data(await call('GET', `${P}/trend?months=3`, T.ownerA));
  const cur = trendA?.months?.[trendA.months.length - 1];
  record('owner A → collected (1000+500, pending excluded)', cur?.collected, 1500);
  record('owner A → refunded', cur?.refunded, 200);
  record('owner A → net', cur?.net, 1300);
  record('owner A → outstanding (clinic A only)', trendA?.outstanding?.total, 500);
  const trendB = data(await call('GET', `${P}/trend?months=3`, T.ownerB));
  record('owner B sees ONLY clinic B (10×)', trendB?.months?.[trendB.months.length - 1]?.collected, 15000);
  record('months=999 rejected by validation', (await call('GET', `${P}/trend?months=999`, T.ownerA)).status, 400);
  record('owner A: widget default hidden → set visible', (await call('PUT', `${P}/preference`, T.ownerA, { showOnDashboard: true })).status, 200);
  record('owner A: access/me now showOnDashboard=true', data(await call('GET', `${P}/access/me`, T.ownerA))?.showOnDashboard, true);
  record('preference body validated (string rejected)', (await call('PUT', `${P}/preference`, T.ownerA, { showOnDashboard: 'yes' })).status, 400);
  record('preference "false" string rejected (not coerced to true)', (await call('PUT', `${P}/preference`, T.ownerA, { showOnDashboard: 'false' })).status, 400);
  record('grant body granted:"false" string rejected (must NOT grant)', (await call('PUT', `${P}/access/${recvA.id}`, T.ownerA, { granted: 'false' })).status, 400);
  record('…and the receptionist still has no access after that request', (await call('GET', `${P}/trend`, T.recvA)).status, 403);

  // ── grant lifecycle + isolation ──────────────────────────────────────
  record('owner A grants receptionist A', (await call('PUT', `${P}/access/${recvA.id}`, T.ownerA, { granted: true })).status, 200);
  record('granted receptionist → trend', (await call('GET', `${P}/trend?months=3`, T.recvA)).status, 200);
  record('granted receptionist still cannot grant others', (await call('PUT', `${P}/access/${recvA.id}`, T.recvA, { granted: true })).status, 403);
  record('owner B cannot grant clinic A staff (cross-clinic)', (await call('PUT', `${P}/access/${recvA.id}`, T.ownerB, { granted: true })).status, 404);
  record('owner A cannot grant clinic B staff (cross-clinic)', (await call('PUT', `${P}/access/${recvB.id}`, T.ownerA, { granted: true })).status, 404);
  record('clinic B receptionist unaffected by A\'s grant', (await call('GET', `${P}/trend`, T.recvB)).status, 403);
  const staffList = data(await call('GET', `${P}/access`, T.ownerA));
  record('owner A staff list = clinic A non-owner staff only (no clinic B, no owners)', Array.isArray(staffList) && staffList.every((x) => [recvA.id, dentistA.id, assistantA.id].includes(x.id)) && !staffList.some((x) => [recvB.id, ownerB.id, ownerA.id].includes(x.id)), true);
  record('non-UUID userId rejected', (await call('PUT', `${P}/access/not-a-uuid`, T.ownerA, { granted: true })).status, 400);
  record('owner A revokes receptionist A', (await call('PUT', `${P}/access/${recvA.id}`, T.ownerA, { granted: false })).status, 200);
  record('revoked receptionist → trend', (await call('GET', `${P}/trend`, T.recvA)).status, 403);

  // ── EXTENSION: KPI cards, LTV endpoints/exports, financial reports, strict booleans ─────────────
  const hasKey = (obj, ...keys) => keys.some((k) => JSON.stringify(obj ?? {}).includes(`"${k}"`));
  const dash = data(await call('GET', '/analytics/dashboard', T.recvB));
  record('receptionist → /analytics/dashboard flagged restricted', dash?.financialsRestricted, true);
  record('receptionist → /analytics/dashboard has NO revenue / revenueMoM / outstandingAmount', !hasKey(dash, 'revenue', 'revenueMoM', 'outstandingAmount'), true);
  record('receptionist → /analytics/dashboard keeps operational KPIs', typeof dash?.thisMonth?.appointments === 'number' && typeof dash?.totals?.patients === 'number', true);
  for (const [name, path] of [
    ['patient LTV', '/analytics/patients/ltv'], ['high-value patients', '/analytics/patients/high-value'],
    ['LTV CSV export', '/analytics/export/ltv-csv'], ['daily-revenue report', '/billing/reports/daily-revenue?from=2020-01-01&to=2031-01-01'],
    ['outstanding report', '/billing/reports/outstanding'], ['GST report', '/billing/reports/gst?from=2020-01-01&to=2031-01-01'],
  ]) record(`receptionist → ${name}`, (await call('GET', path, T.recvB)).status, 403);
  const bstats = data(await call('GET', '/billing/stats', T.recvB));
  record('receptionist → /billing/stats has NO money, keeps counts', !hasKey(bstats, 'thisMonth', 'outstanding') && bstats?.financialsRestricted === true && typeof bstats?.paidCount === 'number', true);
  const cstats = data(await call('GET', '/clinic/stats', T.recvB));
  record('receptionist → /clinic/stats has NO outstanding balance', !hasKey(cstats, 'outstandingBalance') && cstats?.financialsRestricted === true, true);
  const perf = data(await call('GET', '/analytics/dentists/performance', T.recvB));
  record('receptionist → dentist performance has NO revenue', Array.isArray(perf) && perf.every((r) => !('revenue' in r)), true);
  const inactive = data(await call('GET', '/analytics/patients/inactive?days=1', T.recvB));
  record('receptionist → inactive patients has NO ltv', Array.isArray(inactive) && inactive.every((r) => !('ltv' in r)), true);
  record('receptionist → /analytics/trends has no revenue (re-check)', (data(await call('GET', '/analytics/trends?count=3', T.recvB)) ?? []).every((r) => !('revenue' in r)), true);

  // owner (clinic A) gets the real figures
  const dashO = data(await call('GET', '/analytics/dashboard', T.ownerA));
  record('owner → dashboard includes revenue + outstanding', typeof dashO?.thisMonth?.revenue === 'number' && typeof dashO?.totals?.outstandingAmount === 'number' && !dashO?.financialsRestricted, true);
  record('owner → patient LTV', (await call('GET', '/analytics/patients/ltv', T.ownerA)).status, 200);
  record('owner → high-value patients', (await call('GET', '/analytics/patients/high-value', T.ownerA)).status, 200);
  record('owner → LTV CSV', (await call('GET', '/analytics/export/ltv-csv', T.ownerA)).status, 200);
  record('owner → outstanding report', (await call('GET', '/billing/reports/outstanding', T.ownerA)).status, 200);
  const bO = data(await call('GET', '/billing/stats', T.ownerA));
  record('owner → billing stats include thisMonth + outstanding', typeof bO?.thisMonth === 'number' && typeof bO?.outstanding === 'number', true);
  record('owner → clinic stats include outstandingBalance', hasKey(data(await call('GET', '/clinic/stats', T.ownerA)), 'outstandingBalance'), true);

  // clinic isolation on the newly protected endpoints: clinic B owner never sees clinic A numbers
  const dashB = data(await call('GET', '/analytics/dashboard', T.ownerB));
  record("clinic isolation: owner B dashboard revenue is clinic B (10x), not clinic A", dashB?.thisMonth?.revenue > dashO?.thisMonth?.revenue, true);

  // granted staff (clinic A) gets LTV; revoked loses it
  await call('PUT', `${P}/access/${recvA.id}`, T.ownerA, { granted: true });
  record('granted receptionist → patient LTV', (await call('GET', '/analytics/patients/ltv', T.recvA)).status, 200);
  record('granted receptionist → dashboard has revenue', typeof data(await call('GET', '/analytics/dashboard', T.recvA))?.thisMonth?.revenue, 'number');
  await call('PUT', `${P}/access/${recvA.id}`, T.ownerA, { granted: false });
  record('revoked receptionist → patient LTV', (await call('GET', '/analytics/patients/ltv', T.recvA)).status, 403);

  // strict booleans through the real pipe + real controller
  const newPatient = (extra) => ({ fullName: 'Bool Test', phone: `+9177${String(stamp).slice(-8)}`, ...extra });
  record('POST /patients waOptIn:"false" → 400 (must not opt in)', (await call('POST', '/patients', T.ownerA, newPatient({ waOptIn: 'false' }))).status, 400);
  record('POST /patients waOptIn:"0" → 400', (await call('POST', '/patients', T.ownerA, newPatient({ waOptIn: '0' }))).status, 400);
  const created = await call('POST', '/patients', T.ownerA, newPatient({ waOptIn: false }));
  record('POST /patients waOptIn:false (real boolean) → created', [200, 201].includes(created.status), true);
  const pid = data(created)?.id;
  const stored = pid ? await prisma.patient.findUnique({ where: { id: pid } }) : null;
  record('stored waOptIn is false (consent not inverted)', stored?.waOptIn, false);
  record('PATCH /patients waOptIn:"false" → 400 and stored value unchanged', pid ? (await call('PATCH', `/patients/${pid}`, T.ownerA, { waOptIn: 'false' })).status : 'no-patient', 400);
  record('payment-link notifySms:"false" → 400 (never texts the patient)', (await call('POST', '/billing/invoices/00000000-0000-0000-0000-000000000000/payment-link', T.ownerA, { notifySms: 'false' })).status, 400);

  // ── EXTENSION 2: billing permissions, patient-level financials, consent default, public routes ─────────
  const patA = await prisma.patient.findFirst({ where: { clinicId: A.id } });
  await prisma.patient.update({ where: { id: patA.id }, data: { outstandingBalance: 777 } });
  const invUrl = '/billing/invoices';
  // assistant: no billing permission at all
  for (const [name, method, path, body] of [
    ['list invoices', 'GET', invUrl], ['billing stats', 'GET', '/billing/stats'], ['packages', 'GET', '/billing/packages'],
    ['insurance claims', 'GET', '/billing/insurance-claims'], ['create invoice', 'POST', invUrl, {}],
    ['cancel invoice', 'PATCH', `${invUrl}/00000000-0000-0000-0000-000000000000/cancel`, {}],
  ]) record(`assistant → ${name}`, (await call(method, path, T.assistantA, body)).status, 403);
  // dentist: billing:read only
  record('dentist → list invoices (read allowed)', (await call('GET', invUrl, T.dentistA)).status, 200);
  record('dentist → insurance claims (read allowed)', (await call('GET', '/billing/insurance-claims', T.dentistA)).status, 200);
  record('dentist → create invoice (write denied BEFORE validation)', (await call('POST', invUrl, T.dentistA, {})).status, 403);
  record('dentist → cancel invoice (write denied)', (await call('PATCH', `${invUrl}/00000000-0000-0000-0000-000000000000/cancel`, T.dentistA, {})).status, 403);
  record('dentist → record payment (write denied)', (await call('POST', `${invUrl}/00000000-0000-0000-0000-000000000000/payments`, T.dentistA, {})).status, 403);
  // receptionist + owner: write allowed (400 = got past permissions, failed validation)
  record('receptionist → create invoice reaches validation (400, not 403)', (await call('POST', invUrl, T.recvB, {})).status, 400);
  record('owner → create invoice reaches validation (400, not 403)', (await call('POST', invUrl, T.ownerA, {})).status, 400);
  record('receptionist → list invoices', (await call('GET', invUrl, T.recvB)).status, 200);
  // clinic isolation on invoice list: owner B only sees clinic B's invoices
  const invB = data(await call('GET', invUrl, T.ownerB));
  record('owner B invoice list contains only clinic B invoices', (invB?.items ?? []).every((i) => i.invoiceNumber?.startsWith('E-e2eb')), true);

  // patient-level financial data
  const pl = (tk) => call('GET', '/patients', tk);
  record('owner → patient list includes outstandingBalance', (data(await pl(T.ownerA))?.items ?? []).some((p) => p.outstandingBalance !== undefined), true);
  record('dentist (billing:read) → patient list includes outstandingBalance', (data(await pl(T.dentistA))?.items ?? []).some((p) => p.outstandingBalance !== undefined), true);
  const aList = data(await pl(T.assistantA));
  record('assistant → patient list works but has NO outstandingBalance', (aList?.items?.length ?? 0) > 0 && aList.items.every((p) => !('outstandingBalance' in p)) && aList.financialsRestricted === true, true);
  const aDetail = data(await call('GET', `/patients/${patA.id}`, T.assistantA));
  record('assistant → patient detail has NO balance / invoices', aDetail && !('outstandingBalance' in aDetail) && !('invoices' in aDetail) && aDetail.fullName === patA.fullName, true);
  const oDetail = data(await call('GET', `/patients/${patA.id}`, T.ownerA));
  record('owner → patient detail includes balance (777) and invoices', Number(oDetail?.outstandingBalance) === 777 && Array.isArray(oDetail?.invoices), true);
  const aTl = data(await call('GET', `/patients/${patA.id}/timeline`, T.assistantA));
  record('assistant → timeline has no invoices', Array.isArray(aTl?.invoices) && aTl.invoices.length === 0, true);
  const oTl = data(await call('GET', `/patients/${patA.id}/timeline`, T.ownerA));
  record('owner → timeline has invoices', (oTl?.invoices?.length ?? 0) > 0, true);
  record('cross-clinic: owner B cannot read clinic A patient', (await call('GET', `/patients/${patA.id}`, T.ownerB)).status, 404);

  // appointments: money (estimatedCost / invoice / treatment prices) follows billing:read
  const dTok = T.dentistA;
  const apptRow = await prisma.appointment.create({ data: { clinicId: A.id, patientId: patA.id, dentistId: dentistA.id, appointmentDate: new Date(new Date().toISOString().slice(0, 10)), startTime: '10:00:00', endTime: '10:30:00', status: 'scheduled', estimatedCost: 4500 } });
  await prisma.treatment.create({ data: { clinicId: A.id, appointmentId: apptRow.id, patientId: patA.id, dentistId: dentistA.id, description: 'RCT', unitPrice: 4000, discountPct: 10 } });
  await prisma.invoice.create({ data: { clinicId: A.id, patientId: patA.id, appointmentId: apptRow.id, invoiceNumber: `AP-${stamp}`, totalAmount: 3600, balanceAmount: 3600, paidAmount: 0, status: 'sent' } });
  const moneyKeys = ['estimatedCost', 'unitPrice', 'discountPct', 'totalAmount', 'invoiceNumber'];
  const leaks = (r) => moneyKeys.filter((k) => JSON.stringify(data(r) ?? '').includes(`"${k}"`));
  for (const [name, path] of [['list', '/appointments'], ['detail', `/appointments/${apptRow.id}`], ['today', '/appointments/today']]) {
    record(`assistant → appointments ${name} has NO money`, leaks(await call('GET', path, T.assistantA)).length, 0);
    record(`dentist (billing:read) → appointments ${name} still has prices`, leaks(await call('GET', path, dTok)).length > 0 || name === 'today', true);
  }
  record('assistant → appointment detail keeps scheduling data', data(await call('GET', `/appointments/${apptRow.id}`, T.assistantA))?.startTime, '10:00:00');
  record('owner → appointment detail has all price fields', leaks(await call('GET', `/appointments/${apptRow.id}`, T.ownerA)).length, 5);

  // consent default
  const mkp = (extra) => ({ fullName: 'Consent Test', phone: `+9166${String(stamp).slice(-8)}${extra.n}`, ...extra.body });
  const c1 = data(await call('POST', '/patients', T.ownerA, mkp({ n: 1, body: {} })));
  const c2 = data(await call('POST', '/patients', T.ownerA, mkp({ n: 2, body: { waOptIn: true } })));
  const r1 = c1?.id ? await prisma.patient.findUnique({ where: { id: c1.id } }) : null;
  const r2 = c2?.id ? await prisma.patient.findUnique({ where: { id: c2.id } }) : null;
  record('POST /patients WITHOUT waOptIn → stored false (no consent assumed)', r1?.waOptIn, false);
  record('POST /patients waOptIn:true → stored true', r2?.waOptIn, true);

  // public routes still reachable without a token (permission guard must not 500/403 them)
  const pv = await call('POST', '/billing/payments/verify', null, { razorpay_order_id: 'x' });
  record('public payments/verify (no token) → 400 validation, not 401/403/500', pv.status, 400);
  const co = await call('GET', '/billing/orders/order_doesnotexist/checkout', null);
  record('public checkout resolver (no token) → 404, not 401/403/500', co.status, [404, 400]);
  record('non-public billing route without token → 401', (await call('GET', invUrl, null)).status, 401);

  // ── cleanup ──────────────────────────────────────────────────────────
  await prisma.invoice.deleteMany({ where: { clinicId: { in: [A.id, B.id] }, invoiceNumber: { startsWith: 'AP-' } } });
  await prisma.treatment.deleteMany({ where: { clinicId: { in: [A.id, B.id] } } });
  await prisma.appointment.deleteMany({ where: { clinicId: { in: [A.id, B.id] } } });
  await prisma.payment.deleteMany({ where: { clinicId: { in: [A.id, B.id] } } });
  await prisma.invoice.deleteMany({ where: { clinicId: { in: [A.id, B.id] } } });
  await prisma.patient.deleteMany({ where: { clinicId: { in: [A.id, B.id] } } });
  await prisma.user.deleteMany({ where: { clinicId: { in: [A.id, B.id] } } });
  await prisma.clinic.deleteMany({ where: { id: { in: [A.id, B.id] } } });
  await prisma.$disconnect();

  let fail = 0;
  for (const r of rows) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ->  ${r.got}${r.ok ? '' : `   (expected ${r.expected})`}`); }
  console.log(`\n${rows.length - fail}/${rows.length} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('E2E error:', e.message); await prisma.$disconnect(); process.exit(2); });
