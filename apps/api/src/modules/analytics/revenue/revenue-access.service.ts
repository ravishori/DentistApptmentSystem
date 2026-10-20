import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** Roles that own the clinic's finances and therefore always see revenue (for THEIR clinic only). */
const OWNER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([UserRole.super_admin, UserRole.clinic_admin]);

export interface RevenueViewer {
  id:       string;
  role:     UserRole;
  clinicId: string;
}

/**
 * Who may see revenue analytics, and each user's dashboard preference.
 *
 * Storage: `clinics.settings` JSON (no schema change), always read/written under the caller's own clinic id:
 *   settings.revenueAccess  = { "<userId>": true }                      — explicit grants by the clinic owner
 *   settings.dashboardPrefs = { "<userId>": { "revenueTrend": true } }  — per-user "show on my dashboard"
 * Writes are single atomic jsonb statements, so concurrent grants/preferences cannot overwrite each other.
 */
@Injectable()
export class RevenueAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Clinic owners, or users the owner has explicitly authorised (and who are still active staff of THIS clinic). */
  async canView(viewer: RevenueViewer | undefined | null): Promise<boolean> {
    if (!viewer?.id || !viewer.clinicId || !viewer.role) return false;
    if (OWNER_ROLES.has(viewer.role)) return true;

    const clinic = await this.prisma.clinic.findUnique({ where: { id: viewer.clinicId }, select: { settings: true } });
    const grants = (clinic?.settings as any)?.revenueAccess ?? {};
    if (grants[viewer.id] !== true) return false;

    // A grant is void if the user was deactivated or moved out of this clinic
    const stillStaff = await this.prisma.user.findFirst({
      where:  { id: viewer.id, clinicId: viewer.clinicId, isActive: true },
      select: { id: true },
    });
    return !!stillStaff;
  }

  /** Convenience for controllers: evaluate access for the verified user of this request. */
  canViewRequest(req: { user?: { id: string; role: UserRole; clinicId: string } }): Promise<boolean> {
    return this.canView(req.user ? { id: req.user.id, role: req.user.role, clinicId: req.user.clinicId } : null);
  }

  canManage(viewer: RevenueViewer | undefined | null): boolean {
    return !!viewer && OWNER_ROLES.has(viewer.role);
  }

  /** Default is HIDDEN: the widget only appears on the dashboard after an authorised user opts in. */
  async showOnDashboard(viewer: RevenueViewer): Promise<boolean> {
    if (!(await this.canView(viewer))) return false;
    const clinic = await this.prisma.clinic.findUnique({ where: { id: viewer.clinicId }, select: { settings: true } });
    return (clinic?.settings as any)?.dashboardPrefs?.[viewer.id]?.revenueTrend === true;
  }

  async setDashboardPreference(viewer: RevenueViewer, show: boolean): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE clinics
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb)
          || jsonb_build_object('dashboardPrefs', COALESCE(settings -> 'dashboardPrefs', '{}'::jsonb)),
        ARRAY['dashboardPrefs', ${viewer.id}]::text[],
        jsonb_build_object('revenueTrend', ${show}::boolean),
        true)
      WHERE id = ${viewer.clinicId}::uuid`);
  }

  // ── Owner-only management ────────────────────────────────────────────────

  /** Staff of the owner's own clinic and whether each has been authorised. Never lists other clinics. */
  async listStaff(clinicId: string) {
    const [clinic, staff] = await Promise.all([
      this.prisma.clinic.findUnique({ where: { id: clinicId }, select: { settings: true } }),
      this.prisma.user.findMany({
        where:   { clinicId, isActive: true, role: { notIn: [UserRole.super_admin, UserRole.clinic_admin] } },
        select:  { id: true, fullName: true, role: true },
        orderBy: { fullName: 'asc' },
      }),
    ]);
    const grants = (clinic?.settings as any)?.revenueAccess ?? {};
    return staff.map((s) => ({ ...s, hasAccess: grants[s.id] === true }));
  }

  async setAccess(clinicId: string, targetUserId: string, granted: boolean): Promise<void> {
    // Target must be an active, non-owner member of the SAME clinic — blocks cross-clinic grants
    const target = await this.prisma.user.findFirst({
      where:  { id: targetUserId, clinicId, isActive: true },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('Staff member not found');
    if (OWNER_ROLES.has(target.role)) throw new BadRequestException('Clinic owners always have access');

    if (granted) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE clinics
        SET settings = jsonb_set(
          COALESCE(settings, '{}'::jsonb)
            || jsonb_build_object('revenueAccess', COALESCE(settings -> 'revenueAccess', '{}'::jsonb)),
          ARRAY['revenueAccess', ${targetUserId}]::text[], 'true'::jsonb, true)
        WHERE id = ${clinicId}::uuid`);
    } else {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE clinics
        SET settings = COALESCE(settings, '{}'::jsonb) #- ARRAY['revenueAccess', ${targetUserId}]::text[]
        WHERE id = ${clinicId}::uuid`);
    }
  }
}
