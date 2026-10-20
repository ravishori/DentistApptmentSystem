jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { RevenueAccessService } from './revenue-access.service';
import { RevenueAccessGuard } from './revenue-access.guard';
import { RevenueController, SetRevenueAccessDto, DashboardPreferenceDto } from './revenue.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RevenueAnalyticsService } from './revenue-analytics.service';
import { AnalyticsController } from '../analytics.controller';
import { BillingController } from '../../billing/billing.controller';
import { ClinicController } from '../../clinic/clinic.controller';
import { redactBillingStats, redactClinicStats, redactDashboardSummary, omitKeys, FINANCIALS_RESTRICTED } from './financial-redaction';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';

const viewer = (role: UserRole, id = 'u1', clinicId = 'cA') => ({ id, role, clinicId });

/** Fake Prisma holding per-clinic settings and users. */
function fakePrisma(opts: { settings?: Record<string, any>; users?: any[] } = {}) {
  const settings = opts.settings ?? {};            // clinicId -> settings json
  const users = opts.users ?? [];
  return {
    clinic: { findUnique: async ({ where }: any) => ({ settings: settings[where.id] ?? {} }) },
    user: {
      findFirst: async ({ where }: any) => users.find((u) => u.id === where.id && u.clinicId === where.clinicId && (where.isActive === undefined || u.isActive === where.isActive)) ?? null,
      findMany: async () => [],
    },
  } as any;
}

describe('RevenueAccessService.canView', () => {
  it.each([UserRole.super_admin, UserRole.clinic_admin])('owner role %s always may view', async (role) => {
    expect(await new RevenueAccessService(fakePrisma()).canView(viewer(role))).toBe(true);
  });

  it.each([UserRole.dentist, UserRole.receptionist, UserRole.assistant])('%s is DENIED by default', async (role) => {
    expect(await new RevenueAccessService(fakePrisma()).canView(viewer(role))).toBe(false);
  });

  it('an explicitly authorised, active staff member may view', async () => {
    const svc = new RevenueAccessService(fakePrisma({
      settings: { cA: { revenueAccess: { u1: true } } },
      users: [{ id: 'u1', clinicId: 'cA', isActive: true }],
    }));
    expect(await svc.canView(viewer(UserRole.receptionist))).toBe(true);
  });

  it('a grant stops working when the user is deactivated', async () => {
    const svc = new RevenueAccessService(fakePrisma({
      settings: { cA: { revenueAccess: { u1: true } } },
      users: [{ id: 'u1', clinicId: 'cA', isActive: false }],
    }));
    expect(await svc.canView(viewer(UserRole.receptionist))).toBe(false);
  });

  it('only literal `true` counts as a grant (no truthy strings / objects)', async () => {
    for (const bad of ['true', 1, {}, 'yes']) {
      const svc = new RevenueAccessService(fakePrisma({
        settings: { cA: { revenueAccess: { u1: bad } } },
        users: [{ id: 'u1', clinicId: 'cA', isActive: true }],
      }));
      expect(await svc.canView(viewer(UserRole.dentist))).toBe(false);
    }
  });

  it('clinic isolation: a grant in clinic A does not authorise the same user id against clinic B', async () => {
    const svc = new RevenueAccessService(fakePrisma({
      settings: { cA: { revenueAccess: { u1: true } }, cB: {} },
      users: [{ id: 'u1', clinicId: 'cA', isActive: true }],
    }));
    expect(await svc.canView(viewer(UserRole.receptionist, 'u1', 'cA'))).toBe(true);
    expect(await svc.canView(viewer(UserRole.receptionist, 'u1', 'cB'))).toBe(false);
  });

  it('fails closed on missing/partial identity', async () => {
    const svc = new RevenueAccessService(fakePrisma());
    expect(await svc.canView(null)).toBe(false);
    expect(await svc.canView(undefined)).toBe(false);
    expect(await svc.canView({ id: '', role: UserRole.clinic_admin, clinicId: 'cA' })).toBe(false);
    expect(await svc.canView({ id: 'u', role: UserRole.clinic_admin, clinicId: '' })).toBe(false);
  });

  it('canManage is owner-only (an authorised viewer cannot grant others)', () => {
    const svc = new RevenueAccessService(fakePrisma());
    expect(svc.canManage(viewer(UserRole.clinic_admin))).toBe(true);
    expect(svc.canManage(viewer(UserRole.super_admin))).toBe(true);
    expect(svc.canManage(viewer(UserRole.dentist))).toBe(false);
    expect(svc.canManage(null)).toBe(false);
  });

  it('dashboard widget is hidden by default and never "on" for someone without access', async () => {
    const owner = new RevenueAccessService(fakePrisma());
    expect(await owner.showOnDashboard(viewer(UserRole.clinic_admin))).toBe(false);
    const denied = new RevenueAccessService(fakePrisma({ settings: { cA: { dashboardPrefs: { u1: { revenueTrend: true } } } } }));
    expect(await denied.showOnDashboard(viewer(UserRole.receptionist))).toBe(false);   // pref set, but no access
    const optedIn = new RevenueAccessService(fakePrisma({ settings: { cA: { dashboardPrefs: { u1: { revenueTrend: true } } } } }));
    expect(await optedIn.showOnDashboard(viewer(UserRole.clinic_admin))).toBe(true);
  });
});

describe('RevenueAccessGuard', () => {
  const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any);

  it('denies anonymous requests with a generic 403 that leaks no figures', async () => {
    const guard = new RevenueAccessGuard(new RevenueAccessService(fakePrisma()));
    await expect(guard.canActivate(ctx(undefined))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx(undefined))).rejects.toThrow(/do not have access/);
  });
  it('denies unauthorised staff, allows owners', async () => {
    const guard = new RevenueAccessGuard(new RevenueAccessService(fakePrisma()));
    await expect(guard.canActivate(ctx({ id: 'u', role: UserRole.receptionist, clinicId: 'cA' }))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx({ id: 'o', role: UserRole.clinic_admin, clinicId: 'cA' }))).resolves.toBe(true);
  });
});

describe('route protection (metadata)', () => {
  const guardsOf = (target: any, key: string) => Reflect.getMetadata(GUARDS_METADATA, target.prototype[key]) ?? [];

  it.each(['trend', 'preference'])('RevenueController.%s requires RevenueAccessGuard', (key) => {
    expect(guardsOf(RevenueController, key)).toContain(RevenueAccessGuard);
  });
  it('owner-management routes are restricted to clinic_admin', () => {
    for (const key of ['listAccess', 'setAccess']) {
      expect(Reflect.getMetadata(ROLES_KEY, RevenueController.prototype[key as keyof RevenueController])).toEqual([UserRole.clinic_admin]);
    }
  });
  it('no revenue route is public (patient-facing pages can never reach it)', () => {
    for (const key of Object.getOwnPropertyNames(RevenueController.prototype).filter((k) => k !== 'constructor')) {
      expect(Reflect.getMetadata('isPublic', (RevenueController.prototype as any)[key])).toBeUndefined();
    }
    expect(Reflect.getMetadata('isPublic', RevenueController)).toBeUndefined();
  });
  it('the revenue CSV export is guarded', () => {
    expect(guardsOf(AnalyticsController, 'exportRevenueCsv')).toContain(RevenueAccessGuard);
  });
});

describe('capability probe + redaction of the shared trends endpoint', () => {
  it('access/me returns booleans only for an unauthorised user (no financial data)', async () => {
    const access = new RevenueAccessService(fakePrisma());
    const ctrl = new RevenueController(access, {} as RevenueAnalyticsService);
    const out = await ctrl.me({ user: { id: 'u', role: UserRole.receptionist, clinicId: 'cA' } } as any);
    expect(out).toEqual({ canView: false, canManage: false, showOnDashboard: false });
  });

  const rows = [{ period: '2026-10', revenue: 12345, payments: 7, appointments: 40, completed: 35, noShow: 5, newPatients: 9 }];
  const analyticsCtrl = (role: UserRole, granted = false) => {
    const prisma = fakePrisma({
      settings: { cA: granted ? { revenueAccess: { u1: true } } : {} },
      users: [{ id: 'u1', clinicId: 'cA', isActive: true }],
    });
    return new AnalyticsController({ getTrends: async () => rows } as any, new RevenueAccessService(prisma));
  };
  const req = (role: UserRole) => ({ user: viewer(role) } as any);

  it('strips revenue/payments for unauthorised staff but keeps appointment & patient trends', async () => {
    const out: any[] = await analyticsCtrl(UserRole.receptionist).trends('cA', req(UserRole.receptionist));
    expect(out[0]).not.toHaveProperty('revenue');
    expect(out[0]).not.toHaveProperty('payments');
    expect(out[0]).toMatchObject({ appointments: 40, completed: 35, noShow: 5, newPatients: 9 });
  });
  it('keeps revenue for owners and for authorised staff', async () => {
    expect(((await analyticsCtrl(UserRole.clinic_admin).trends('cA', req(UserRole.clinic_admin))) as any[])[0].revenue).toBe(12345);
    expect(((await analyticsCtrl(UserRole.receptionist, true).trends('cA', req(UserRole.receptionist))) as any[])[0].revenue).toBe(12345);
  });
});

describe('procedure mix redaction', () => {
  const rows = [{ procedure: 'root_canal', appointmentCount: 12, totalRevenue: 90000, avgRevenue: 7500 }];
  const mk = (granted: boolean) => new AnalyticsController(
    { getRevenuePerProcedure: async () => rows } as any,
    new RevenueAccessService(fakePrisma({
      settings: { cA: granted ? { revenueAccess: { u1: true } } : {} },
      users: [{ id: 'u1', clinicId: 'cA', isActive: true }],
    })),
  );
  const req = (role: UserRole) => ({ user: viewer(role) } as any);

  it('unauthorised staff keep the counts (default dashboard pie) but get NO money fields', async () => {
    const out: any[] = await mk(false).revenueByProcedure('cA', req(UserRole.receptionist));
    expect(out[0]).toEqual({ procedure: 'root_canal', appointmentCount: 12 });
  });
  it('owners and authorised staff get the revenue fields', async () => {
    expect(((await mk(false).revenueByProcedure('cA', req(UserRole.clinic_admin))) as any[])[0].totalRevenue).toBe(90000);
    expect(((await mk(true).revenueByProcedure('cA', req(UserRole.receptionist))) as any[])[0].avgRevenue).toBe(7500);
  });
});

describe('RevenueAnalyticsService.clampMonths', () => {
  it.each([[undefined, 6], [0, 1], [-5, 1], [1, 1], [12, 12], [36, 36], [500, 36], [NaN, 6], [7.9, 7]])('%p -> %p', (input, expected) => {
    expect(RevenueAnalyticsService.clampMonths(input as any)).toBe(expected);
  });
});

describe('access-control DTOs reject non-boolean values (implicit conversion must not turn "false" into true)', () => {
  const convert = { enableImplicitConversion: true };   // what the app-wide ValidationPipe(transform:true) enables

  it.each([['"false"', 'false'], ['"true"', 'true'], ['"yes"', 'yes'], ['1', 1], ['0', 0], ['null', null], ['object', {}]])(
    'SetRevenueAccessDto rejects granted=%s', async (_l, value) => {
      const dto = plainToInstance(SetRevenueAccessDto, { granted: value }, convert);
      expect((await validate(dto)).length).toBeGreaterThan(0);
    });

  it.each([['"false"', 'false'], ['"yes"', 'yes'], ['1', 1]])('DashboardPreferenceDto rejects showOnDashboard=%s', async (_l, value) => {
    const dto = plainToInstance(DashboardPreferenceDto, { showOnDashboard: value }, convert);
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('accepts real booleans and preserves their value', async () => {
    for (const v of [true, false]) {
      const dto = plainToInstance(SetRevenueAccessDto, { granted: v }, convert);
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.granted).toBe(v);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Extension: KPI cards, LTV endpoints/exports, financial reports
// ═══════════════════════════════════════════════════════════════════════════
describe('financial routes are guarded (403 for unauthorised staff)', () => {
  const guardsOf = (target: any, key: string) => Reflect.getMetadata(GUARDS_METADATA, target.prototype[key]) ?? [];

  it.each([
    [AnalyticsController, 'patientLtv'],
    [AnalyticsController, 'highValuePatients'],
    [AnalyticsController, 'exportLtvCsv'],
    [AnalyticsController, 'exportRevenueCsv'],
    [BillingController, 'getDailyRevenue'],
    [BillingController, 'getOutstandingDues'],
    [BillingController, 'getGstReport'],
  ])('%p.%s requires RevenueAccessGuard', (ctrl: any, key: string) => {
    expect(guardsOf(ctrl, key)).toContain(RevenueAccessGuard);
  });
});

describe('mixed endpoints strip money for unauthorised staff and keep operational data', () => {
  const summary = {
    today: { appointments: 4 },
    thisMonth: { appointments: 80, revenue: 123456, revenueMoM: 12, newPatients: 9, patientGrowth: 3, appointmentGrowth: 5 },
    totals: { patients: 500, outstandingAmount: 98765, completedAppointments: 300 },
    noShowRate: 4.2,
  };

  it('redactDashboardSummary removes revenue, MoM and outstanding; flags the payload; leaves the rest', () => {
    const out: any = redactDashboardSummary(summary);
    expect(JSON.stringify(out)).not.toMatch(/123456|98765|revenueMoM|outstandingAmount/);
    expect(out.thisMonth).toEqual({ appointments: 80, newPatients: 9, patientGrowth: 3, appointmentGrowth: 5 });
    expect(out.totals).toEqual({ patients: 500, completedAppointments: 300 });
    expect(out[FINANCIALS_RESTRICTED]).toBe(true);
    expect(summary.thisMonth.revenue).toBe(123456);            // input not mutated
  });
  it('redactBillingStats / redactClinicStats drop money, keep counts', () => {
    expect(redactBillingStats({ thisMonth: 5000, outstanding: 900, paidCount: 7, pendingCount: 2 }))
      .toEqual({ paidCount: 7, pendingCount: 2, financialsRestricted: true });
    expect(redactClinicStats({ totalPatients: 10, activeStaff: 3, outstandingBalance: 4400 }))
      .toEqual({ totalPatients: 10, activeStaff: 3, financialsRestricted: true });
  });
  it('omitKeys never leaves the key behind (not even as 0/null)', () => {
    const out = omitKeys([{ a: 1, ltv: 5 }, { a: 2, ltv: 0 }], ['ltv']);
    expect(out.every((r) => !('ltv' in r))).toBe(true);
  });

  const analyticsCtrl = (granted: boolean) => new AnalyticsController({
    getDashboardSummary: async () => summary,
    getDentistPerformance: async () => [{ dentistId: 'd', fullName: 'Dr', appointments: 20, completed: 18, revenue: 7777 }],
    getInactivePatients: async () => [{ patientId: 'p', fullName: 'P', daysInactive: 120, totalVisits: 3, ltv: 31000, riskLevel: 'high' }],
  } as any, new RevenueAccessService(fakePrisma({
    settings: { cA: granted ? { revenueAccess: { u1: true } } : {} },
    users: [{ id: 'u1', clinicId: 'cA', isActive: true }],
  })));
  const reqOf = (role: UserRole) => ({ user: viewer(role) } as any);

  it('dashboard: unauthorised → redacted; owner and authorised → full', async () => {
    const denied: any = await analyticsCtrl(false).dashboard('cA', reqOf(UserRole.receptionist));
    expect(JSON.stringify(denied)).not.toMatch(/123456|98765/);
    expect(denied.thisMonth.appointments).toBe(80);
    expect(((await analyticsCtrl(false).dashboard('cA', reqOf(UserRole.clinic_admin))) as any).thisMonth.revenue).toBe(123456);
    expect(((await analyticsCtrl(true).dashboard('cA', reqOf(UserRole.receptionist))) as any).totals.outstandingAmount).toBe(98765);
  });
  it('dentist performance: revenue removed for unauthorised, counts kept', async () => {
    const out: any[] = await analyticsCtrl(false).dentistPerformance('cA', reqOf(UserRole.dentist));
    expect(out[0]).not.toHaveProperty('revenue');
    expect(out[0]).toMatchObject({ appointments: 20, completed: 18 });
    expect(((await analyticsCtrl(false).dentistPerformance('cA', reqOf(UserRole.clinic_admin))) as any[])[0].revenue).toBe(7777);
  });
  it('inactive patients: recall list stays, ltv removed for unauthorised', async () => {
    const out: any[] = await analyticsCtrl(false).inactivePatients('cA', reqOf(UserRole.receptionist));
    expect(out[0]).not.toHaveProperty('ltv');
    expect(out[0]).toMatchObject({ daysInactive: 120, riskLevel: 'high' });
    expect(((await analyticsCtrl(true).inactivePatients('cA', reqOf(UserRole.receptionist))) as any[])[0].ltv).toBe(31000);
  });

  it('billing stats and clinic stats controllers redact for unauthorised staff', async () => {
    const access = new RevenueAccessService(fakePrisma());
    const billing = new BillingController({ stats: async () => ({ thisMonth: 5000, outstanding: 900, paidCount: 7, pendingCount: 2 }) } as any,
      {} as any, {} as any, {} as any, {} as any, access);
    const clinic = new ClinicController({ getStats: async () => ({ totalPatients: 10, outstandingBalance: 4400 }) } as any, access);
    expect(await billing.stats('cA', reqOf(UserRole.receptionist))).toEqual({ paidCount: 7, pendingCount: 2, financialsRestricted: true });
    expect(await billing.stats('cA', reqOf(UserRole.clinic_admin))).toMatchObject({ thisMonth: 5000, outstanding: 900 });
    expect(await clinic.getStats('cA', reqOf(UserRole.dentist))).toEqual({ totalPatients: 10, financialsRestricted: true });
    expect(await clinic.getStats('cA', reqOf(UserRole.clinic_admin))).toMatchObject({ outstandingBalance: 4400 });
  });
});
