// Legacy TypeORM entity removed — project uses Prisma.

export enum UserRole {
  SUPER_ADMIN  = 'super_admin',
  CLINIC_ADMIN = 'clinic_admin',
  DENTIST      = 'dentist',
  RECEPTIONIST = 'receptionist',
  ASSISTANT    = 'assistant',
}

export interface User {
  id:           string;
  tenantId:     string;
  fullName:     string;
  email:        string;
  passwordHash?: string;
  phone?:       string | null;
  role:         UserRole;
  isActive:     boolean;
  avatarUrl?:   string | null;
  specialization?: string | null;
  registrationNumber?: string | null;
}
