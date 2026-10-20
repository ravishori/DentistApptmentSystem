// Legacy TypeORM entity removed — project uses Prisma.
// Enums kept for use by session services.

export enum MessageDirection {
  INBOUND  = 'inbound',
  OUTBOUND = 'outbound',
}

export enum MessageStatus {
  QUEUED    = 'queued',
  SENT      = 'sent',
  DELIVERED = 'delivered',
  READ      = 'read',
  FAILED    = 'failed',
}

export enum MessageType {
  TEXT        = 'text',
  TEMPLATE    = 'template',
  INTERACTIVE = 'interactive',
  IMAGE       = 'image',
  DOCUMENT    = 'document',
}

export enum ConversationState {
  IDLE              = 'idle',
  BOOKING_FLOW      = 'booking_flow',
  RESCHEDULE_FLOW   = 'reschedule_flow',
  FAQ_FLOW          = 'faq_flow',
  PAYMENT_FLOW      = 'payment_flow',
  HUMAN_TAKEOVER    = 'human_takeover',
}

export interface WhatsappConversation {
  id:                string;
  tenantId:          string;
  patientId?:        string | null;
  patientPhone:      string;
  state:             ConversationState;
  context?:          Record<string, any> | null;
  lastMessageAt?:    Date | null;
  isHumanTakeover:   boolean;
  assignedToUserId?: string | null;
}

export interface WhatsappMessage {
  id:                  string;
  tenantId:            string;
  conversationId:      string;
  direction:           MessageDirection;
  type:                MessageType;
  content:             string;
  status:              MessageStatus;
  externalMessageId?:  string | null;
  failureReason?:      string | null;
}
