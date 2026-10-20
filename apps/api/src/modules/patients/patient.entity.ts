// Legacy TypeORM entity removed — project uses Prisma.

export enum BloodGroup {
  A_POS = 'A+', A_NEG = 'A-', B_POS = 'B+', B_NEG = 'B-',
  O_POS = 'O+', O_NEG = 'O-', AB_POS = 'AB+', AB_NEG = 'AB-',
}

export enum Gender {
  MALE = 'male', FEMALE = 'female', OTHER = 'other',
}

export interface Patient {
  id:               string;
  tenantId:         string;
  patientCode:      string;
  fullName:         string;
  phone?:           string | null;
  email?:           string | null;
  whatsappOptIn:    boolean;
  lastVisitDate?:   Date | null;
  totalVisits:      number;
  outstandingBalance: number;
  appointments?:    any[];
  invoices?:        any[];
}
