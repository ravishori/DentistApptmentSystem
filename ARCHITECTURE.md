# DentalEase — Technical Architecture

WhatsApp-first dental clinic automation platform. Multi-tenant SaaS, India-first.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                │
│                                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  360Dialog  │  │   Razorpay   │  │   AWS SES    │  │   AWS S3    │  │
│  │ (WhatsApp)  │  │  (Payments)  │  │   (Email)    │  │  (Uploads)  │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
└─────────┼────────────────┼─────────────────┼─────────────────┼─────────┘
          │                │                 │                 │
          ▼                ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           API LAYER (NestJS)                             │
│                                                                          │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐  │
│  │  auth   │  │ patients │  │appoints   │  │ billing  │  │whatsapp  │  │
│  │ module  │  │  module  │  │ module    │  │  module  │  │  module  │  │
│  └─────────┘  └──────────┘  └───────────┘  └──────────┘  └──────────┘  │
│                                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────────────────┐  │
│  │treatments│  │ analytics │  │   Bull Queue (async jobs / retries)  │  │
│  │  module  │  │  module   │  │   SchedulerModule (cron reminders)   │  │
│  └──────────┘  └───────────┘  └──────────────────────────────────────┘  │
│                                                                          │
│  Middleware:  TenantGuard → JwtAuthGuard → RolesGuard                   │
│  Every request resolves tenantId from JWT; all DB queries scoped by it  │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │PostgreSQL│   │  Redis   │   │   S3     │
    │(primary  │   │(cache +  │   │(X-rays,  │
    │  store)  │   │  queue)  │   │  docs)   │
    └──────────┘   └──────────┘   └──────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      WEB DASHBOARD (Next.js 14)                          │
│                                                                          │
│  /login   /dashboard   /appointments   /patients   /billing              │
│  /treatments   /whatsapp   /analytics   /settings                        │
│                                                                          │
│  Stack: React Query (server state) · Zustand (auth) · Recharts · Radix  │
│  Hosting: Vercel (edge CDN, India region)                                │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    PATIENTS (WhatsApp Channel)                            │
│                                                                          │
│  Patient ──WhatsApp──▶ 360Dialog ──POST webhook──▶ /api/v1/whatsapp     │
│                                                     /webhook/:tenantId   │
│                                                                          │
│  Automation flows (event-driven via NestJS EventEmitter2):               │
│  appointment.booked       → confirmation template                        │
│  appointment.reminder_24h → 24h reminder (cron every hour)               │
│  appointment.reminder_2h  → 2h reminder (cron every hour)                │
│  appointment.completed    → follow-up after 24h delay                    │
│  appointment.cancelled    → cancellation notice                          │
│  invoice.sent             → payment link (Razorpay hosted page)         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### Core Multi-Tenant Design
- **Strategy**: Shared database, shared schema (row-level tenancy)
- **Isolation**: Every table has `tenant_id UUID NOT NULL`, indexed
- **Security**: PostgreSQL RLS policies optionally enforced at DB level
- **Connection**: TypeORM connection pool (max 20) with `synchronize: false` in prod

```
tenants
  id (PK)  slug (UNIQUE)  clinic_name  owner_name  email  phone
  address  city  state  pincode  logo_url  gst_number
  plan (starter|growth|enterprise)  status (active|suspended|trial|cancelled)
  trial_ends_at  razorpay_customer_id  whatsapp_number  whatsapp_api_key
  settings (jsonb: workStart, workEnd, slotDuration, breakStart, breakEnd)
  patient_count  created_at  updated_at

users  ─────────────────────────────────────────── FK: tenant_id → tenants
  id (PK)  tenant_id  full_name  email (UNIQUE per tenant)  password_hash
  phone  role (super_admin|clinic_admin|dentist|receptionist|assistant)
  avatar_url  specialization  registration_number
  is_active  last_login_at  refresh_token  created_at  updated_at

patients ────────────────────────────────────────── FK: tenant_id → tenants
  id (PK)  tenant_id  patient_code (PT-0001, UNIQUE per tenant)
  full_name  phone  email  date_of_birth  gender  blood_group
  address  city  pincode
  family_head_id (self-FK → patients)  relationship
  allergies (text[])  medical_conditions (text[])  notes
  whatsapp_opt_in  last_visit_date  total_visits  outstanding_balance
  created_at  updated_at
  INDEX: (tenant_id, phone)  (tenant_id, patient_code)

appointment_slots ─────────────────────────── FK: tenant_id, dentist_id
  id (PK)  tenant_id  dentist_id  slot_date  start_time  end_time
  is_booked  is_blocked  block_reason  created_at
  INDEX: (tenant_id, dentist_id, slot_date)

appointments ──────────────────────────── FK: tenant_id, patient_id, dentist_id
  id (PK)  tenant_id  patient_id  dentist_id
  appointment_date  start_time  end_time
  type (consultation|cleaning|filling|extraction|root_canal|crown|braces|...)
  status (scheduled|confirmed|in_progress|completed|cancelled|no_show|rescheduled)
  chief_complaint  notes  estimated_cost  booked_via
  reminder_status (pending|sent_24h|sent_2h|sent_followup)
  reminder_24h_sent_at  reminder_2h_sent_at
  cancelled_at  cancel_reason  rescheduled_from_id
  created_at  updated_at
  INDEX: (tenant_id, appointment_date)  (tenant_id, patient_id)

procedures ──────────────────────────────────────── FK: tenant_id → tenants
  id (PK)  tenant_id  name  code  category  default_price
  duration_minutes  is_active  created_at

treatment_plans ──────────────────────────── FK: tenant_id, patient_id, dentist_id
  id (PK)  tenant_id  patient_id  dentist_id
  plan_title  diagnosis  notes
  status (draft|presented|accepted|in_progress|completed|cancelled)
  presented_at  accepted_at  completed_at  total_estimated_cost
  created_at  updated_at

treatment_items ─────────────────────────── FK: treatment_plan_id, procedure_id
  id (PK)  treatment_plan_id  procedure_id  description
  tooth_number  surfaces (text[])  estimated_cost  discount
  quantity  is_completed  completed_at  completed_by_appointment_id  sort_order

invoices ──────────────────────────────── FK: tenant_id, patient_id, appointment_id
  id (PK)  tenant_id  invoice_number (INV-2024-0001, UNIQUE per tenant)
  patient_id  appointment_id  invoice_date  due_date
  status (draft|sent|partially_paid|paid|overdue|cancelled|refunded)
  subtotal  discount_percent  discount_amount  tax_percent (18% GST)
  tax_amount  total_amount  paid_amount  balance_amount
  notes  razorpay_order_id  pdf_url  created_at  updated_at

invoice_items ─────────────────────────────────────── FK: invoice_id
  id (PK)  invoice_id  description  tooth_number
  quantity  unit_price  discount_percent  total_price

payments ────────────────────────────────────────── FK: tenant_id, invoice_id
  id (PK)  tenant_id  invoice_id  amount
  method (razorpay|cash|upi|card|netbanking|insurance)
  status (pending|success|failed|refunded)
  razorpay_order_id  razorpay_payment_id  razorpay_signature
  transaction_ref  notes  paid_at  created_at

whatsapp_conversations ──────────────────────── FK: tenant_id, patient_id
  id (PK)  tenant_id  patient_id  patient_phone
  state (idle|booking_flow|reschedule_flow|faq_flow|payment_flow|human_takeover)
  context (jsonb)  last_message_at  is_human_takeover
  assigned_to_user_id  created_at  updated_at

whatsapp_messages ─────────────────────────────── FK: conversation_id
  id (PK)  tenant_id  conversation_id
  direction (inbound|outbound)  type (text|template|interactive|image|document)
  content  template_name  template_params (jsonb)
  external_message_id (360Dialog/Twilio ID)
  status (queued|sent|delivered|read|failed)  failure_reason  created_at

whatsapp_templates ──────────────────────────────── FK: tenant_id
  id (PK)  tenant_id  name  display_name  language  body
  parameter_keys (text[])  category  is_active  is_approved  created_at

automation_flows ────────────────────────────────── FK: tenant_id
  id (PK)  tenant_id  trigger  steps (jsonb[])
  is_active  execution_count  created_at  updated_at
```

---

## 3. REST API Structure

Base: `https://api.dentalease.in/api/v1`

```
── Auth ─────────────────────────────────────────────────────────────────
POST   /auth/register          Register clinic (creates tenant + admin)
POST   /auth/login             Login → JWT pair
POST   /auth/refresh           Refresh access token
GET    /auth/me                Current user profile

── Tenant ───────────────────────────────────────────────────────────────
GET    /tenant                 Get clinic profile
PUT    /tenant                 Update clinic profile
PATCH  /tenant/settings        Update working hours, slot config, etc.

── Users (Staff) ────────────────────────────────────────────────────────
GET    /users                  List all staff
GET    /users/dentists         Dentists only (for booking dropdown)
GET    /users/:id              Get staff member
POST   /users                  Create staff member
PUT    /users/:id              Update staff member

── Patients (CRM) ───────────────────────────────────────────────────────
GET    /patients               List/search patients (?search=&city=&page=&limit=)
GET    /patients/:id           Patient profile + appointments + invoices
POST   /patients               Register new patient
PUT    /patients/:id           Update patient
GET    /patients/:id/family    Get family members
PATCH  /patients/:id/family-link  Link to family head

── Appointments ─────────────────────────────────────────────────────────
GET    /appointments           List (?date=&dentistId=&status=&startDate=&endDate=)
GET    /appointments/slots     Available slots (?dentistId=&date=)
POST   /appointments/slots/generate  Generate slots for a dentist/day
POST   /appointments           Book appointment
PATCH  /appointments/:id/status  Update status (confirm/cancel/complete)

── Treatment Plans ──────────────────────────────────────────────────────
GET    /treatments             List (?patientId=)
GET    /treatments/:id         Plan detail with items
POST   /treatments             Create plan + items
PATCH  /treatments/:id/status  Update plan status
GET    /treatments/procedures/catalog  Procedure catalog
POST   /treatments/procedures  Add procedure to catalog

── Billing ──────────────────────────────────────────────────────────────
GET    /billing/invoices       List (?status=&patientId=&page=)
GET    /billing/invoices/:id   Invoice detail with items + payments
POST   /billing/invoices       Create invoice
POST   /billing/invoices/:id/pay     Create Razorpay order
POST   /billing/payments/verify      Verify Razorpay signature (public)

── WhatsApp ─────────────────────────────────────────────────────────────
GET    /whatsapp/webhook/:tenantId   Webhook verification (Meta)
POST   /whatsapp/webhook/:tenantId   Receive inbound messages
POST   /whatsapp/send          Send text message
POST   /whatsapp/send-template Send template message

── Analytics ────────────────────────────────────────────────────────────
GET    /analytics/dashboard            KPI stats
GET    /analytics/appointments/chart   Appointment trend (?days=30)
GET    /analytics/revenue/chart        Revenue by month (?months=6)
GET    /analytics/procedures/top       Top procedures
GET    /analytics/dentists/performance Dentist metrics
```

---

## 4. Multi-Tenant Strategy

### Approach: Shared Database, Shared Schema (Row-Level Tenancy)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Why this approach for DentalEase:                                   │
│  • Most clinics start small (< 5k patients) — schema-per-tenant     │
│    wastes resources and complicates migrations                       │
│  • Simple: single connection pool, single migration path             │
│  • PostgreSQL RLS adds a hard DB-level isolation guarantee           │
│  • Scales to hundreds of tenants on a single RDS instance            │
└─────────────────────────────────────────────────────────────────────┘
```

**Tenant Resolution Flow:**
```
HTTP Request
    ↓
JWT (contains tenantId, tenantSlug, userId, role)
    ↓
JwtAuthGuard validates token
    ↓
JwtStrategy.validate() attaches { tenantId, ... } to req.user
    ↓
Controller uses @TenantId() decorator to extract from request
    ↓
Service receives tenantId → every query: WHERE tenant_id = $1
```

**RLS Enforcement (production):**
```sql
-- Set per DB connection before any query:
SET LOCAL app.tenant_id = '<uuid>';

-- Policy on each table:
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Per-Tenant WhatsApp:**
Each clinic can have its own 360Dialog API key stored in `tenants.whatsapp_api_key`.
WhatsApp webhook URL is scoped: `/api/v1/whatsapp/webhook/:tenantId`.

---

## 5. Scalability & Security Design

### Scalability

```
Development / Staging:
  Docker Compose → single machine (4 vCPU, 8GB RAM handles ~50 clinics)

Production (AWS):
  ┌────────────────────────────────────────────────┐
  │  Vercel (Next.js)  — global CDN, edge network  │
  │  Mumbai (ap-south-1) edge functions            │
  └────────────────────────────────────────────────┘
            ↓ API calls
  ┌────────────────────────────────────────────────┐
  │  AWS ECS Fargate — NestJS API                  │
  │  Min: 2 tasks, Max: 20 tasks (auto-scale)      │
  │  Target: 70% CPU, 200ms p95 latency alarm      │
  │  ALB with sticky sessions OFF (stateless JWT)  │
  └────────────────────────────────────────────────┘
            ↓
  ┌──────────────────┐    ┌──────────────────────┐
  │  RDS PostgreSQL  │    │  ElastiCache Redis   │
  │  Multi-AZ        │    │  Single-node (dev)   │
  │  db.r6g.large    │    │  cache.t4g.micro     │
  │  Autoscaling     │    │  (Bull queues +      │
  │  read replicas   │    │   session cache)     │
  └──────────────────┘    └──────────────────────┘

Horizontal scaling strategy:
  - API is fully stateless (JWT auth, no server-side sessions)
  - All async jobs go through Bull (Redis-backed), any worker picks them up
  - WhatsApp message retries handled by Bull with exponential backoff
  - Cron reminders run on a dedicated "scheduler" ECS task (1 instance)
    to avoid duplicate sends when API scales out
```

### Caching Strategy
```
Redis key patterns:
  tenant:{id}:settings          → 5min TTL (working hours, slot config)
  tenant:{id}:slots:{dentistId}:{date}  → 2min TTL (slot availability)
  tenant:{id}:analytics:dashboard       → 5min TTL
  tenant:{id}:procedures        → 60min TTL (rarely changes)
```

### Security

| Layer | Mechanism |
|-------|-----------|
| **Transport** | HTTPS enforced (HSTS), TLS 1.3 |
| **Auth** | JWT RS256, short-lived access (7d) + long refresh (30d) |
| **API** | Helmet.js, CORS whitelist, Throttler (100 req/min/IP) |
| **Multi-tenant** | tenantId from JWT — never trusted from request body |
| **DB** | PostgreSQL RLS, parameterized queries (TypeORM), no raw SQL interpolation |
| **Secrets** | AWS Secrets Manager in prod, `.env` locally |
| **Payments** | Razorpay signature verification (HMAC-SHA256) before marking paid |
| **WhatsApp webhook** | Verify-token check (GET) + payload origin validation |
| **PII** | Phone/email stored in DB; S3 documents encrypted at rest (AES-256) |
| **Audit** | All payment events and status changes logged with userId + timestamp |
| **VAPT** | OWASP Top 10 checklist: input validation via class-validator, no XSS surface (server-rendered Next.js) |

---

## 6. Getting Started

```bash
# 1. Clone & install
git clone <repo>
cd DentistAptSystem
npm install

# 2. Environment
cp .env.example .env
# Edit .env with your DB, Razorpay, 360Dialog keys

# 3. Start infrastructure
docker-compose up postgres redis -d

# 4. Run migrations
npm run db:migrate

# 5. Start dev servers (both api + web)
npm run dev

# API:  http://localhost:3001
# Docs: http://localhost:3001/api/docs
# Web:  http://localhost:3000
```

---

## 7. WhatsApp Automation Flow (End-to-End)

```
Patient books appointment (web dashboard)
         ↓
AppointmentsService.book() called
         ↓
EventEmitter2.emit('appointment.booked', { appointment, tenantId })
         ↓
AutomationService.onBooked() listener fires
         ↓
Checks: patient.whatsappOptIn === true
         ↓
WhatsappService.sendAppointmentConfirmation()
         ↓
360Dialog POST /messages  ──▶  Patient's WhatsApp
         ↓
Message delivered ✓  (status webhook updates DB)

Next day:
CronJob (every hour) finds appointments within 24h
         ↓
EventEmitter fires 'appointment.reminder_24h'
         ↓
AutomationService.onReminder24h() → send template
         ↓
Updates appointment.reminder_status = 'sent_24h'
         (idempotent — won't send twice)
```
