// Legacy TypeORM entity removed — project uses Prisma.

export enum TenantPlan {
  STARTER    = 'starter',
  GROWTH     = 'growth',
  ENTERPRISE = 'enterprise',
}

export enum TenantStatus {
  ACTIVE    = 'active',
  SUSPENDED = 'suspended',
  TRIAL     = 'trial',
  CANCELLED = 'cancelled',
}

export interface Tenant {
  id:          string;
  slug:        string;
  clinicName:  string;
  ownerName?:  string | null;
  email:       string;
  phone?:      string | null;
  plan:        TenantPlan;
  status:      TenantStatus;
  settings?:   Record<string, any> | null;
}
