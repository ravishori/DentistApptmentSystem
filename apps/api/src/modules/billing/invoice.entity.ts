// Legacy TypeORM entity removed — project uses Prisma.
// Enums and interfaces kept for backward-compat.

export enum InvoiceStatus {
  DRAFT         = 'draft',
  SENT          = 'sent',
  PARTIALLY_PAID = 'partially_paid',
  PAID          = 'paid',
  OVERDUE       = 'overdue',
  CANCELLED     = 'cancelled',
  REFUNDED      = 'refunded',
}

export enum PaymentMethod {
  RAZORPAY   = 'razorpay',
  CASH       = 'cash',
  UPI        = 'upi',
  CARD       = 'card',
  NETBANKING = 'netbanking',
  INSURANCE  = 'insurance',
}

export enum PaymentStatus {
  PENDING  = 'pending',
  SUCCESS  = 'success',
  FAILED   = 'failed',
  REFUNDED = 'refunded',
}

export interface Invoice {
  id:            string;
  tenantId:      string;
  invoiceNumber: string;
  patientId:     string;
  totalAmount:   number;
  paidAmount:    number;
  balanceAmount: number;
  status:        InvoiceStatus;
  patient?:      any;
}
