# Mounted WhatsApp and appointment routes: inventory and rules

All routes are under `/api/v1`. Global guard order: Throttler (100/min default) then JWT auth, then TenantIsolation, then Roles, then Permissions. "Tenant" means the clinic comes from the verified token, never from the request body or path.

## WhatsApp

| Route | Auth | Permission / role | Tenant | Consent | Status |
|---|---|---|---|---|---|
| `GET /whatsapp/webhook/:clinicId` | public | none | path param | n/a | health check only |
| `POST /whatsapp/webhook/:clinicId` | public | none | **path param, unvalidated** | STOP sets `waOptIn=false` | **OPEN RISK: no Twilio signature check** |
| `GET /whatsapp/conversations` | JWT | none (any role) | token | n/a | ambiguity A1 |
| `GET /whatsapp/conversations/:id/messages` | JWT | none (any role) | token | n/a | ambiguity A1 |
| `POST /whatsapp/send` | JWT | **`whatsapp:send`** (dentist, receptionist, admins) | token | **recipient must be a patient of this clinic and every record on that number opted in** | fixed, 20/min |
| `POST /whatsapp/send-template` | JWT | **`whatsapp:send`** | token | same as `send` | fixed, 20/min, template allow-list |
| `POST /whatsapp/start-booking` | public | none | clinic UUID in body, must exist and be active | see below | fixed, 5/min per client |
| `POST /whatsapp/broadcast` | JWT | role `clinic_admin`/`super_admin` | token | audience filtered on `waOptIn` | unchanged |
| `GET /whatsapp/broadcast/estimate` | JWT | role `clinic_admin`/`super_admin` | token | filtered on `waOptIn` | unchanged |

### `start-booking` rules
The route is public because QR and click-to-chat links have no login. A message is sent only if the clinic is active, nobody with that number in that clinic has opted out, the number is an opted-in patient or has messaged the clinic in the last 24 hours, and the number has not been started in the last 10 minutes. Every case returns the same `202 {accepted:true}`, so the route cannot be used to look up patients or opt-out state. Input is validated as a v4 clinic UUID and an E.164 number. Invalid requests still count against the rate limit.

## Appointments

| Route | Permission / role | Tenant | Status |
|---|---|---|---|
| `GET /appointments/slots` | any authenticated | token | unchanged |
| `POST /appointments/slots/generate` | role admin | token | unchanged |
| `PATCH /appointments/slots/:id/(un)block` | role admin or receptionist | token | unchanged |
| `GET /appointments`, `/today`, `/:id` | any authenticated; money hidden without `billing:read` | token | ambiguity A2 |
| `POST /appointments` | **`appointments:write`** | token (patient, dentist and slot must belong to the clinic) | fixed |
| `PATCH /appointments/:id/status` | **`appointments:write`** | token | fixed |
| `POST /appointments/:id/reschedule` | **`appointments:write`** | token | fixed |

Input hardening added: `bookedVia` restricted to web/whatsapp/phone/walkin; free-text lengths capped (complaint 500, reason 500, clinical notes 5000).

## Policy ambiguities (not changed; need your decision)
- **A1.** Conversation list and messages contain patient phone numbers and chat history but require no permission. The existing model suggests `whatsapp:send`, which would lock out assistants. I did not invent that rule.
- **A2.** `appointments:read` exists in the matrix but is not enforced on GET routes. Assistants have no `appointments:read` or `appointments:write` today. I enforced write only; enforcing read would remove assistants' view of the schedule.
- **A3.** Assistants lose the ability to book, change status and reschedule. If chairside assistants must mark "in progress" or "completed", that needs an explicit rule (for example a status-only permission).
- **A4.** `clinicalNotes` can be written through the status route by anyone with `appointments:write`, including the receptionist.
- **A5.** `estimatedCost` is settable at booking by anyone with `appointments:write` (see the treatment-price policy, decision B).
- **A6.** `start-booking` treats an inbound message within 24 hours as proof the phone owner started the chat. Confirm that is acceptable consent, or require `waOptIn` always.
- **A7.** START to re-subscribe is advertised in the STOP reply but not implemented.

## Open risks
- Inbound Twilio webhook has no `X-Twilio-Signature` verification, so anyone who knows a clinic UUID and a patient phone can forge STOP, CANCEL or BOOK messages. This is the most important remaining WhatsApp item. It needs the public webhook URL configured to validate correctly.
- The global ValidationPipe uses implicit conversion, which turns objects into the string "[object Object]" for any plain `@IsString()` DTO field. The new DTOs read the raw value to avoid it; other DTOs were not audited.
- Rate limiting is per client IP using in-memory storage: it resets on restart, and behind a proxy all clients share one IP unless `trust proxy` is set.
