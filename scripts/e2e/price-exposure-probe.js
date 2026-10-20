require('./_guard');
// READ-ONLY probe of where prices reach each role TODAY (documentation evidence). Disposable DB + running API only.
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const BASE = process.env.API_BASE, SECRET = process.env.JWT_SECRET;
const prisma = new PrismaClient();
const stamp = Date.now();
const money = ['estimatedCost', 'unitPrice', 'discountPct', 'totalAmount', 'balanceAmount', 'paidAmount', 'outstandingBalance', 'defaultPrice'];
const found = (obj) => { const t = JSON.stringify(obj ?? ''); return money.filter((k) => t.includes(`"${k}"`)); };
(async () => {
  const C = await prisma.clinic.create({ data: { name: 'prc', slug: `prc${stamp}`, email: `prc${stamp}@p.test` } });
  const mk = (key, role) => prisma.user.create({ data: { clinicId: C.id, email: `${key}${stamp}@p.test`, passwordHash: 'x', fullName: key, role } });
  const users = { clinic_admin: await mk('adm', 'clinic_admin'), dentist: await mk('den', 'dentist'), receptionist: await mk('rec', 'receptionist'), assistant: await mk('ast', 'assistant') };
  const pat = await prisma.patient.create({ data: { clinicId: C.id, patientCode: `PR-${stamp}`, fullName: 'Price Probe', phone: '+910000009999', outstandingBalance: 321 } });
  const today = new Date(new Date().toISOString().slice(0, 10));
  const appt = await prisma.appointment.create({ data: { clinicId: C.id, patientId: pat.id, dentistId: users.dentist.id, appointmentDate: today, startTime: '10:00:00', endTime: '10:30:00', status: 'scheduled', estimatedCost: 4500 } });
  await prisma.treatment.create({ data: { clinicId: C.id, appointmentId: appt.id, patientId: pat.id, dentistId: users.dentist.id, description: 'Root canal', unitPrice: 4000, discountPct: 10 } });
  await prisma.invoice.create({ data: { clinicId: C.id, patientId: pat.id, appointmentId: appt.id, invoiceNumber: `PR-${stamp}`, totalAmount: 3600, balanceAmount: 3600, paidAmount: 0, status: 'sent' } });
  const tok = (u) => jwt.sign({ sub: u.id, email: u.email, role: u.role, clinicId: C.id, clinicSlug: C.slug, clinicName: C.name }, SECRET, { expiresIn: '5m' });
  const routes = [
    ['GET', '/appointments'], ['GET', `/appointments/${appt.id}`], ['GET', '/appointments/today'],
    ['GET', '/patients'], ['GET', `/patients/${pat.id}`], ['GET', `/patients/${pat.id}/timeline`],
    ['GET', `/patients/${pat.id}/ehr/timeline`], ['GET', `/patients/${pat.id}/ehr/chart`],
    ['GET', '/billing/invoices'], ['GET', '/treatments'], ['GET', '/treatments/procedures/catalog'],
  ];
  const lines = [];
  for (const [m, p] of routes) {
    const cells = [];
    for (const role of ['clinic_admin', 'dentist', 'receptionist', 'assistant']) {
      const r = await fetch(`${BASE}${p}`, { method: m, headers: { Authorization: `Bearer ${tok(users[role])}` } });
      let j = null; try { j = JSON.parse(await r.text()); } catch {}
      const f = r.status === 200 ? found(j?.data ?? j) : [];
      cells.push(`${role}: ${r.status}${f.length ? ' $[' + f.join(',') + ']' : ''}`);
    }
    lines.push(`${m} ${p.replace(appt.id, ':id').replace(pat.id, ':pid')}\n    ${cells.join('\n    ')}`);
  }
  console.log(lines.join('\n'));
  await prisma.invoice.deleteMany({ where: { clinicId: C.id } }); await prisma.treatment.deleteMany({ where: { clinicId: C.id } });
  await prisma.appointment.deleteMany({ where: { clinicId: C.id } }); await prisma.patient.deleteMany({ where: { clinicId: C.id } });
  await prisma.user.deleteMany({ where: { clinicId: C.id } }); await prisma.clinic.delete({ where: { id: C.id } });
  await prisma.$disconnect();
})().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
