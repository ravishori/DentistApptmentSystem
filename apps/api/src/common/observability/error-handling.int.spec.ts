/**
 * Real-PostgreSQL error handling: genuine Prisma/PostgreSQL failures are classified, transactions roll back and the
 * application recovers; a representative patient operation failing at the database layer reaches the client with a safe
 * contract and produces one sanitised administrator alert. Skipped unless TEST_DATABASE_URL is set.
 * Use ONLY a disposable database, never dentalease_db.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { Body, Controller, Get, MiddlewareConsumer, Module, NestModule, Param, ParseUUIDPipe, Post, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PatientsService } from '../../modules/patients/patients.service';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { ErrorEmailService } from '../logger/error-email.service';
import { classifyException, ErrorCode } from './error-classifier';
import { HealthService } from './health.service';
import { MetricsService } from './metrics.service';
import { RequestContextMiddleware } from './request-context';
import { setLogSink, StructuredLogger } from './structured-logger';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const swapPort = (u: string, port: number) => u.replace(/@([^:/]+):\d+/, `@$1:${port}`);

d('database failures on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const stamp = Date.now();
  let clinicId: string; let otherPatient: string;
  let logs: any[]; let restore: () => void;

  beforeAll(async () => {
    clinicId = (await prisma.clinic.create({ data: { name: 'eh', slug: `eh${stamp}`, email: `eh${stamp}@e.test` } as any })).id;
    otherPatient = (await prisma.patient.create({ data: { clinicId, patientCode: `EH-${stamp}`, fullName: 'Existing', phone: '+910000009001' } as any })).id;
  });
  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { clinicId } });
    await prisma.clinic.deleteMany({ where: { id: clinicId } });
    await prisma.$disconnect();
  });
  beforeEach(() => { logs = []; restore = setLogSink((l) => logs.push(JSON.parse(l))); });
  afterEach(() => restore());

  const catchErr = async (fn: () => Promise<unknown>) => fn().then(() => { throw new Error('expected a failure'); }, (e) => e);

  describe('genuine PostgreSQL errors are classified into the contract', () => {
    it('unique violation → 409 UNIQUE_VIOLATION without leaking the column or value', async () => {
      const e = await catchErr(() => prisma.patient.create({ data: { clinicId, patientCode: `EH-${stamp}`, fullName: 'Dup', phone: '+910000009002' } as any }));
      const c = classifyException(e);
      expect([c.status, c.code]).toEqual([409, ErrorCode.UNIQUE_VIOLATION]);
      expect(JSON.stringify(c.message)).not.toMatch(/patient_code|EH-/);
    });
    it('foreign-key violation → 409 FOREIGN_KEY_VIOLATION', async () => {
      const e = await catchErr(() => prisma.patient.create({ data: { clinicId: '00000000-0000-4000-8000-000000000000', patientCode: `FK-${stamp}`, fullName: 'x', phone: '+910000009003' } as any }));
      expect([classifyException(e).status, classifyException(e).code]).toEqual([409, ErrorCode.FOREIGN_KEY_VIOLATION]);
    });
    it('update of a missing row → 404 NOT_FOUND', async () => {
      const e = await catchErr(() => prisma.patient.update({ where: { id: '00000000-0000-4000-8000-000000000000' }, data: { fullName: 'x' } }));
      expect([classifyException(e).status, classifyException(e).code]).toEqual([404, ErrorCode.NOT_FOUND]);
    });
    it('raw SQL failures carry the SQLSTATE: too-long value → 400, unique → 409', async () => {
      const long = await catchErr(() => prisma.$queryRawUnsafe(`SELECT 1/0`));
      expect(classifyException(long).status).toBe(400);
      const dup = await catchErr(() => prisma.$executeRawUnsafe(`INSERT INTO patients (id, clinic_id, patient_code, full_name, phone, updated_at) VALUES (gen_random_uuid(), '${clinicId}', 'EH-${stamp}', 'dup', '+910000009099', now())`));
      expect(classifyException(dup)).toMatchObject({ status: 409, code: ErrorCode.UNIQUE_VIOLATION });
    });
    it('NOT NULL / missing required field and unknown field are programming errors → 500, never blamed on the caller', async () => {
      const e = await catchErr(() => (prisma.patient.create as any)({ data: { clinicId } }));
      const c = classifyException(e);
      expect(c.status).toBe(500);
      expect(JSON.stringify(c.message)).not.toMatch(/prisma|Argument|invocation/i);
    });
    it('a CHECK constraint violated through raw SQL → 409 CONSTRAINT_VIOLATION', async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE patients ADD CONSTRAINT eh_chk_${stamp} CHECK (full_name <> 'FORBIDDEN') NOT VALID`);
      try {
        const e = await catchErr(() => prisma.$executeRawUnsafe(`INSERT INTO patients (id, clinic_id, patient_code, full_name, phone, updated_at) VALUES (gen_random_uuid(), '${clinicId}', 'CHK-${stamp}', 'FORBIDDEN', '+910000009005', now())`));
        expect(classifyException(e)).toMatchObject({ status: 409, code: ErrorCode.CONSTRAINT_VIOLATION });
      } finally { await prisma.$executeRawUnsafe(`ALTER TABLE patients DROP CONSTRAINT IF EXISTS eh_chk_${stamp}`); }
    });
  });

  describe('transactions roll back completely, and the client recovers', () => {
    it('a failure in the middle of $transaction leaves no partial rows', async () => {
      const code = `TX-${stamp}`;
      const e = await catchErr(() => prisma.$transaction(async (tx) => {
        await tx.patient.create({ data: { clinicId, patientCode: code, fullName: 'Half done', phone: '+910000009010' } as any });
        await tx.patient.create({ data: { clinicId, patientCode: `EH-${stamp}`, fullName: 'Collides', phone: '+910000009011' } as any });   // unique violation
      }));
      expect(classifyException(e).code).toBe(ErrorCode.UNIQUE_VIOLATION);
      expect(await prisma.patient.count({ where: { clinicId, patientCode: code } })).toBe(0);                  // rolled back
      expect(await prisma.patient.count({ where: { clinicId } })).toBe(1);
    });
    it('an application exception thrown inside the callback also rolls back', async () => {
      const code = `TX2-${stamp}`;
      await expect(prisma.$transaction(async (tx) => {
        await tx.patient.create({ data: { clinicId, patientCode: code, fullName: 'x', phone: '+910000009012' } as any });
        throw new Error('business rule failed');
      })).rejects.toThrow('business rule failed');
      expect(await prisma.patient.count({ where: { clinicId, patientCode: code } })).toBe(0);
    });
    it('an interactive transaction that exceeds its timeout is aborted (P2028 → DB_TIMEOUT) and leaves nothing behind', async () => {
      const code = `TX3-${stamp}`;
      const e = await catchErr(() => prisma.$transaction(async (tx) => {
        await tx.patient.create({ data: { clinicId, patientCode: code, fullName: 'slow', phone: '+910000009013' } as any });
        await new Promise((r) => setTimeout(r, 400));
        await tx.patient.count();
      }, { timeout: 100, maxWait: 2000 }));
      expect(classifyException(e)).toMatchObject({ status: 503, code: ErrorCode.DB_TIMEOUT, retryable: true });
      expect(await prisma.patient.count({ where: { clinicId, patientCode: code } })).toBe(0);
    });
    it('after every one of those failures the same client keeps working', async () => {
      expect(await prisma.patient.count({ where: { clinicId } })).toBe(1);
      const created = await prisma.patient.create({ data: { clinicId, patientCode: `OK-${stamp}`, fullName: 'Recovered', phone: '+910000009014' } as any });
      expect(created.id).toBeTruthy();
      await prisma.patient.delete({ where: { id: created.id } });
    });
  });

  describe('unavailable database', () => {
    const deadPort = 1;                                         // nothing listens on TCP port 1
    it('connecting to a dead port fails with a classified 503 DB_UNAVAILABLE (critical, alertable, retryable)', async () => {
      const dead = new PrismaClient({ datasources: { db: { url: swapPort(url!, deadPort) } } });
      try {
        const e = await catchErr(() => dead.patient.count());
        expect(classifyException(e)).toMatchObject({ status: 503, code: ErrorCode.DB_UNAVAILABLE, severity: 'critical', alert: true, retryable: true });
      } finally { await dead.$disconnect().catch(() => undefined); }
    }, 30000);
    it('HealthService reports the live database up and a dead one down, then recovers on the live client', async () => {
      const up = await new HealthService(prisma as any).readiness();
      expect(up.checks.database).toBe('up');
      const dead = new PrismaClient({ datasources: { db: { url: swapPort(url!, deadPort) } } });
      try {
        const down = await new HealthService(dead as any).readiness();
        expect(down).toEqual({ status: 'unavailable', checks: { database: 'down', cache: 'up' } });
      } finally { await dead.$disconnect().catch(() => undefined); }
      expect((await new HealthService(prisma as any).readiness()).status).toBe('ok');
    }, 30000);

    it('END TO END: a patient operation failing at the database layer → safe 503 contract, correlation id everywhere, ONE sanitised alert, then recovery', async () => {
      const dead = new PrismaClient({ datasources: { db: { url: swapPort(url!, deadPort) } } });
      let useDead = true;
      const svc = new PatientsService({ get patient() { return (useDead ? dead : prisma).patient; }, get $transaction() { return (useDead ? dead : prisma).$transaction.bind(useDead ? dead : prisma); } } as any, {} as any);
      const transport = { sendMail: jest.fn(async () => ({ accepted: ['ops@example.com'], rejected: [], messageId: '<m>' })), close: jest.fn(), verify: jest.fn() };
      const metrics = new MetricsService();
      const alerts = new ErrorEmailService({ get: (k: string) => ({ NODE_ENV: 'production', ALERT_EMAIL_TO: 'ops@example.com', ALERT_EMAIL_FROM: 'a@example.com' } as any)[k] } as any, metrics, transport as any);

      @Controller({ path: 'patients', version: '1' })
      class PatientsProbeController {
        @Get(':id') one(@Param('id', ParseUUIDPipe) id: string) { return svc.findOne(clinicId, id); }
        @Post() create(@Body() dto: any) { return svc.create(clinicId, dto); }
      }
      @Module({ controllers: [PatientsProbeController], providers: [{ provide: MetricsService, useValue: metrics }, { provide: ErrorEmailService, useValue: alerts }, { provide: APP_FILTER, useClass: HttpExceptionFilter }] })
      class App implements NestModule { configure(c: MiddlewareConsumer) { c.apply(RequestContextMiddleware).forRoutes('*'); } }
      const mod = await Test.createTestingModule({ imports: [App] }).compile();
      const app = mod.createNestApplication({ logger: false });
      app.useLogger(new StructuredLogger()); app.setGlobalPrefix('api'); app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      const base = `${await app.getUrl()}/api/v1`;
      try {
        // database down: read and write both fail safely; repeated failures produce a single alert
        const read = await fetch(`${base}/patients/${otherPatient}`, { headers: { 'x-request-id': 'e2e-db-down-0001' } });
        const body: any = await read.json();
        expect(read.status).toBe(503);
        expect(body.error).toMatchObject({ code: 'DB_UNAVAILABLE', retryable: true, retryAfterSeconds: 5, requestId: 'e2e-db-down-0001' });
        expect(read.headers.get('retry-after')).toBe('5');
        const text = JSON.stringify(body);
        for (const leak of ['localhost', '127.0.0.1', 'dentalease', 'm7_test', 'prisma', 'P1001', url!.split('@')[0].split(':').pop()!]) expect([leak, text.toLowerCase().includes(leak.toLowerCase())]).toEqual([leak, false]);
        const write = await fetch(`${base}/patients`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Asha Rao', phone: '+919876543210' }) });
        expect(write.status).toBe(503);
        for (let i = 0; i < 3; i++) await fetch(`${base}/patients/${otherPatient}`);
        await new Promise((r) => setTimeout(r, 150));

        expect(transport.sendMail).toHaveBeenCalledTimes(1);
        const mail = transport.sendMail.mock.calls[0] as any[]; const m = mail[0] as any;
        expect(m.subject).toBe('[DentalEase PRODUCTION][CRITICAL] DB_UNAVAILABLE - database');
        expect(m.text).toContain('Request / trace id: e2e-db-down-0001');
        for (const leak of ['Asha Rao', '9876543210', 'localhost', '127.0.0.1', 'm7_test', otherPatient]) expect([leak, (m.text + m.html).includes(leak)]).toEqual([leak, false]);
        const allLogs = JSON.stringify(logs);
        for (const leak of ['Asha Rao', '9876543210', url!.split('@')[0].split(':').pop()!]) expect([leak, allLogs.includes(leak)]).toEqual([leak, false]);
        expect(logs.filter((l) => l.requestId === 'e2e-db-down-0001' && l.event === 'http.error')).toHaveLength(1);
        expect(logs.find((l) => l.requestId === 'e2e-db-down-0001' && l.event === 'http.error')).toMatchObject({ errorCode: 'DB_UNAVAILABLE', subsystem: 'database', status: 503 });
        expect(metrics.getCounter('errors_total', { code: 'DB_UNAVAILABLE', status_class: '5xx' })).toBeGreaterThanOrEqual(5);

        // database back: same process, same routes, no restart
        useDead = false;
        const ok = await fetch(`${base}/patients/${otherPatient}`);
        expect(ok.status).toBe(200);
        const missing = await fetch(`${base}/patients/00000000-0000-4000-8000-000000000000`);
        expect([missing.status, ((await missing.json()) as any).error.code]).toEqual([404, 'NOT_FOUND']);
      } finally { alerts.onModuleDestroy(); await app.close(); await dead.$disconnect().catch(() => undefined); }
    }, 60000);
  });
});
