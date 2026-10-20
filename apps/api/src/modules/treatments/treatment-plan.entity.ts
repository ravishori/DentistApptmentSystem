// Legacy TypeORM entity removed — project uses Prisma.

export enum TreatmentPlanStatus {
  DRAFT       = 'draft',
  PRESENTED   = 'presented',
  ACCEPTED    = 'accepted',
  IN_PROGRESS = 'in_progress',
  COMPLETED   = 'completed',
  CANCELLED   = 'cancelled',
}

export enum ToothSurface {
  MESIAL   = 'M', DISTAL   = 'D', OCCLUSAL = 'O',
  BUCCAL   = 'B', LINGUAL  = 'L', FACIAL   = 'F',
}

export interface TreatmentPlan {
  id:                 string;
  tenantId:           string;
  patientId:          string;
  dentistId:          string;
  planTitle:          string;
  diagnosis?:         string | null;
  notes?:             string | null;
  status:             TreatmentPlanStatus;
  totalEstimatedCost: number;
  presentedAt?:       Date | null;
  acceptedAt?:        Date | null;
  completedAt?:       Date | null;
  items?:             TreatmentItem[];
}

export interface TreatmentItem {
  id:               string;
  treatmentPlanId:  string;
  description:      string;
  toothNumber?:     string | null;
  estimatedCost:    number;
  discount:         number;
  quantity:         number;
  isCompleted:      boolean;
  sortOrder:        number;
}

export interface Procedure {
  id:               string;
  tenantId:         string;
  name:             string;
  code?:            string | null;
  category?:        string | null;
  defaultPrice:     number;
  durationMinutes:  number;
  isActive:         boolean;
}
