// Legacy TypeORM entity removed — project uses Prisma.
// Enums kept for backward-compat with any remaining references.

export enum AppointmentStatus {
  SCHEDULED   = 'scheduled',
  CONFIRMED   = 'confirmed',
  IN_PROGRESS = 'in_progress',
  COMPLETED   = 'completed',
  CANCELLED   = 'cancelled',
  NO_SHOW     = 'no_show',
  RESCHEDULED = 'rescheduled',
}

export enum AppointmentType {
  CONSULTATION = 'consultation',
  CLEANING     = 'cleaning',
  FILLING      = 'filling',
  EXTRACTION   = 'extraction',
  ROOT_CANAL   = 'root_canal',
  CROWN        = 'crown',
  BRACES       = 'braces',
  WHITENING    = 'whitening',
  XRAY         = 'xray',
  FOLLOWUP     = 'followup',
  EMERGENCY    = 'emergency',
  OTHER        = 'other',
}

export enum ReminderStatus {
  PENDING       = 'pending',
  SENT_24H      = 'sent_24h',
  SENT_2H       = 'sent_2h',
  SENT_FOLLOWUP = 'sent_followup',
}

export interface Appointment {
  id:              string;
  tenantId:        string;
  patientId:       string;
  dentistId:       string;
  appointmentDate: string | Date;
  startTime:       string;
  endTime:         string;
  type:            AppointmentType;
  status:          AppointmentStatus;
  reminderStatus:  ReminderStatus;
  reminder24hSentAt?: Date | null;
  reminder2hSentAt?:  Date | null;
  notes?:          string | null;
  patient?:        any;
  dentist?:        any;
  tenant?:         any;
}

export interface AppointmentSlot {
  id:        string;
  tenantId:  string;
  dentistId: string;
  slotDate:  string | Date;
  startTime: string;
  endTime:   string;
  isBooked:  boolean;
  isBlocked: boolean;
}
