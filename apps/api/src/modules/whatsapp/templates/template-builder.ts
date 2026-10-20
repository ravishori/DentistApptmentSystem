/**
 * Builds Twilio Content API-compatible WhatsApp message payloads.
 *
 * Twilio sends messages via:
 *   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 *
 * Interactive messages (buttons, lists) use the Content API:
 *   POST https://content.twilio.com/v1/Content
 *
 * Template messages reference pre-approved content SIDs.
 */

export interface TwilioTextMessage {
  to:   string;   // whatsapp:+919876543210
  from: string;   // whatsapp:+14155238886
  body: string;
}

export interface TwilioTemplateMessage {
  to:          string;
  from:        string;
  contentSid:  string;           // pre-approved template SID
  contentVariables: string;      // JSON string: { "1": "Ravi", "2": "11 AM" }
}

export interface ButtonsPayload {
  type:        'buttons';
  body:        string;
  buttons:     { id: string; title: string }[];
}

export interface ListPayload {
  type:     'list';
  header:   string;
  body:     string;
  footer?:  string;
  button:   string;             // CTA label: "Choose slot"
  sections: {
    title: string;
    rows:  { id: string; title: string; description?: string }[];
  }[];
}

// ── Approved template SIDs (set these in .env / clinic settings) ─────────────
export const TEMPLATE_SIDS = {
  APPOINTMENT_CONFIRMATION:  process.env.WA_TMPL_APT_CONFIRM   ?? 'HXxxx1',
  REMINDER_48H:              process.env.WA_TMPL_REMINDER_48H  ?? 'HXxxx2',
  REMINDER_24H:              process.env.WA_TMPL_REMINDER_24H  ?? 'HXxxx3',
  APPOINTMENT_CANCELLED:     process.env.WA_TMPL_CANCELLED      ?? 'HXxxx4',
  RESCHEDULED:               process.env.WA_TMPL_RESCHEDULED   ?? 'HXxxx5',
  PAYMENT_LINK:              process.env.WA_TMPL_PAYMENT        ?? 'HXxxx6',
  FOLLOWUP:                  process.env.WA_TMPL_FOLLOWUP       ?? 'HXxxx7',
  BROADCAST_OFFER:           process.env.WA_TMPL_BROADCAST      ?? 'HXxxx8',
  PAYMENT_RECEIPT:           process.env.WA_TMPL_RECEIPT        ?? 'HXxxx9',
} as const;

// ── Pre-approved template bodies (for reference / testing) ───────────────────
export const TEMPLATE_BODIES = {
  APPOINTMENT_CONFIRMATION: `Hi {{1}}, your appointment with Dr. {{2}} is confirmed for {{3}} at {{4}}.
📍 {{5}}
Reply *MENU* anytime to manage your appointment.`,

  REMINDER_48H: `Hi {{1}}, just a reminder — you have an appointment with Dr. {{2}} in 48 hours.
📅 {{3}} at {{4}}
📍 {{5}}

Reply:
✅ *CONFIRM* to confirm
🔄 *RESCHEDULE* to change
❌ *CANCEL* to cancel`,

  REMINDER_24H: `Hi {{1}}, your appointment is tomorrow!
🦷 Dr. {{2}} | {{3}} at {{4}}
📍 {{5}}

We'll see you soon! Reply *HELP* for assistance.`,

  APPOINTMENT_CANCELLED: `Hi {{1}}, your appointment on {{2}} at {{3}} has been cancelled.
To book a new appointment, reply *BOOK*.`,

  RESCHEDULED: `Hi {{1}}, your appointment has been rescheduled.
🆕 New time: {{2}} at {{3}} with Dr. {{4}}
📍 {{5}}`,

  PAYMENT_LINK: `Hi {{1}}, your invoice {{2}} for ₹{{3}} is ready.
💳 Pay securely here: {{4}}
Link expires in 24 hours.`,

  FOLLOWUP: `Hi {{1}}, thank you for visiting {{2}}! 😊
How was your experience with Dr. {{3}}?`,

  BROADCAST_OFFER: `Hi {{1}}, {{2}}
📞 Call us: {{3}} | 🌐 {{4}}`,

  PAYMENT_RECEIPT: `✅ *Payment Received!*
Hi {{1}}, we've received ₹{{2}} for invoice {{3}}.
📋 Ref: {{4}}
Thank you! — {{5}}`,
};

// ── Builder helpers ───────────────────────────────────────────────────────────

export class TemplateBuilder {

  /** Plain text + interactive quick-reply buttons (free-form window) */
  static buttons(body: string, buttons: { id: string; title: string }[]): ButtonsPayload {
    return { type: 'buttons', body, buttons: buttons.slice(0, 3) }; // WA max 3 buttons
  }

  /** Interactive list picker (up to 10 rows per section, max 3 sections) */
  static list(opts: {
    header: string;
    body:   string;
    footer?: string;
    button: string;
    sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  }): ListPayload {
    return { type: 'list', ...opts };
  }

  /** Template variable map → JSON string for Twilio contentVariables */
  static vars(values: string[]): string {
    const map: Record<string, string> = {};
    values.forEach((v, i) => { map[String(i + 1)] = v; });
    return JSON.stringify(map);
  }

  /** APPOINTMENT CONFIRMATION template payload */
  static appointmentConfirmation(opts: {
    patientName: string; dentistName: string; date: string;
    time: string; clinicName: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.APPOINTMENT_CONFIRMATION,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.dentistName, opts.date, opts.time, opts.clinicName,
      ]),
    };
  }

  /** 48-HOUR REMINDER template payload */
  static reminder48h(opts: {
    patientName: string; dentistName: string; date: string;
    time: string; clinicName: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.REMINDER_48H,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.dentistName, opts.date, opts.time, opts.clinicName,
      ]),
    };
  }

  /** 24-HOUR REMINDER template payload */
  static reminder24h(opts: {
    patientName: string; dentistName: string; date: string;
    time: string; clinicName: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.REMINDER_24H,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.dentistName, opts.date, opts.time, opts.clinicName,
      ]),
    };
  }

  /** PAYMENT LINK template payload */
  static paymentLink(opts: {
    patientName: string; invoiceNumber: string; amount: string;
    paymentUrl: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.PAYMENT_LINK,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.invoiceNumber, opts.amount, opts.paymentUrl,
      ]),
    };
  }

  /** FOLLOW-UP template payload */
  static followup(opts: {
    patientName: string; clinicName: string;
    dentistName: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.FOLLOWUP,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.clinicName, opts.dentistName,
      ]),
    };
  }

  /** BROADCAST template payload */
  static broadcast(opts: {
    patientName: string; message: string;
    phone: string; website: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.BROADCAST_OFFER,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.message, opts.phone, opts.website,
      ]),
    };
  }

  /** PAYMENT RECEIPT template payload — sent after successful payment */
  static paymentReceipt(opts: {
    patientName: string; amount: string; invoiceNumber: string;
    paymentId: string; clinicName: string; to: string; from: string;
  }): TwilioTemplateMessage {
    return {
      to:   `whatsapp:${opts.to}`,
      from: `whatsapp:${opts.from}`,
      contentSid: TEMPLATE_SIDS.PAYMENT_RECEIPT,
      contentVariables: TemplateBuilder.vars([
        opts.patientName, opts.amount, opts.invoiceNumber,
        opts.paymentId, opts.clinicName,
      ]),
    };
  }
}
