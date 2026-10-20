# DentalEase — Entity Relationship Diagram

Multi-tenant PostgreSQL schema. Cardinality notation: `||` = one, `|<` = one-or-many, `o{` = zero-or-many.

---

## Full ER Diagram (Crow's Foot Notation)

```
╔══════════════════════╗
║       CLINICS        ║  ← SaaS tenant root
║──────────────────────║
║ PK  id               ║
║ UQ  slug             ║
║ UQ  email            ║
║     name             ║
║     plan             ║
║     sub_status       ║
║     wa_number        ║
║     wa_api_key       ║
║     settings (jsonb) ║
╚══════════════╤═══════╝
               │  1
    ┌──────────┴──────────────────────────────────────────┐
    │                                                      │
    │ n                                                    │ n
╔═══╧══════════════════╗                      ╔═══════════╧════════════════╗
║   CLINIC_SUBSCRIPTIONS║                      ║         USERS              ║
║──────────────────────║                       ║────────────────────────────║
║ PK  id               ║                       ║ PK  id                     ║
║ FK  clinic_id        ║                       ║ FK  clinic_id              ║
║     plan             ║                       ║ UQ  (clinic_id, email)     ║
║     status           ║                       ║     full_name              ║
║     amount_paise     ║                       ║     email                  ║
║     period_start     ║                       ║     role                   ║
║     period_end       ║                       ║     specialization         ║
╚══════════════════════╝                       ║     registration_number    ║
                                               ╚═══════════════╤════════════╝
                                                               │ 1
                                         ┌─────────────────────┤
                                         │ n                   │ n
                                   ╔═════╧═══════╗    ╔════════╧════════════╗
                                   ║ USER_SESSIONS║    ║  APPOINTMENT_SLOTS  ║
                                   ║─────────────║    ║─────────────────────║
                                   ║ PK id       ║    ║ PK  id              ║
                                   ║ FK user_id  ║    ║ FK  clinic_id       ║
                                   ║    token    ║    ║ FK  dentist_id      ║
                                   ║    expires  ║    ║     slot_date       ║
                                   ╚═════════════╝    ║     start_time      ║
                                                      ║     is_booked       ║
                                                      ╚══════════╤══════════╝
                                                                 │ 1
                                                                 │ 0..1

╔══════════════════════════╗      n ╔══════════════════════╗
║        PATIENTS          ╠────────╣     APPOINTMENTS     ║
║──────────────────────────║        ║──────────────────────║
║ PK  id                   ║        ║ PK  id               ║
║ FK  clinic_id            ║        ║ FK  clinic_id        ║
║ UQ  (clinic_id, code)    ║        ║ FK  patient_id       ║
║     patient_code         ║        ║ FK  dentist_id       ║
║     full_name            ║        ║ FK  slot_id (UQ)     ║
║     phone                ║        ║     date             ║
║     email                ║        ║     start_time       ║
║     date_of_birth        ║        ║     type             ║
║     blood_group          ║        ║     status           ║
║     allergies[]          ║        ║     reminder_status  ║
║     medical_conditions[] ║        ║     booked_via       ║
║     wa_opt_in            ║        ║     cancelled_at     ║
║     outstanding_balance  ║        ║  FK rescheduled_from ║← self-ref
╚═════════╤════════════════╝        ╚══════════╤═══════════╝
          │                                    │
          │ 1                                  │ 1
          ├────────────────────────────────────┤
          │                                    │
          │ n                                  │ n
╔═════════╧════════════╗            ╔══════════╧══════════════╗
║   PATIENT_FAMILY     ║            ║       TREATMENTS        ║
║   _MEMBERS           ║            ║─────────────────────────║
║─────────────────────║             ║ PK  id                  ║
║ PK  id              ║             ║ FK  clinic_id           ║
║ FK  group_id        ║             ║ FK  appointment_id      ║
║ FK  patient_id      ║             ║ FK  patient_id          ║
║     relationship    ║             ║ FK  dentist_id          ║
╚══════╤══════════════╝             ║ FK  procedure_id        ║
       │ n                          ║ FK  plan_item_id        ║
       │                            ║     description         ║
╔══════╧══════════════╗             ║     tooth_number        ║
║   FAMILY_GROUPS     ║             ║     unit_price          ║
║─────────────────────║             ║     line_total (calc)   ║
║ PK  id              ║             ╚══════════╤══════════════╝
║ FK  clinic_id       ║                        │ n
║     group_name      ║                        │
║ FK  head_patient_id ║             ╔══════════╧══════════════╗
╚═════════════════════╝             ║    INVOICE_ITEMS        ║
                                    ║─────────────────────────║
                                    ║ PK  id                  ║
                                    ║ FK  invoice_id          ║
╔═════════════════════════╗         ║ FK  treatment_id        ║
║     TREATMENT_PLANS     ║         ║ FK  procedure_id        ║
║─────────────────────────║         ║     unit_price          ║
║ PK  id                  ║         ║     line_total (calc)   ║
║ FK  clinic_id           ║         ╚══════════╤══════════════╝
║ FK  patient_id          ║                    │ n
║ FK  dentist_id          ║         ╔══════════╧══════════════╗
║     plan_title          ║         ║        INVOICES         ║
║     status              ║         ║─────────────────────────║
║     total_cost          ║         ║ PK  id                  ║
║     net_cost (calc)     ║         ║ FK  clinic_id           ║
╚═══════════╤═════════════╝         ║ FK  patient_id          ║
            │ 1                     ║ FK  appointment_id (UQ) ║
            │ n                     ║     invoice_number      ║
╔═══════════╧═════════════╗         ║     subtotal            ║
║   TREATMENT_PLAN_ITEMS  ║         ║     tax_pct (GST 18%)   ║
║─────────────────────────║         ║     total_amount        ║
║ PK  id                  ║         ║     balance_amount(calc)║
║ FK  treatment_plan_id   ║         ║     razorpay_order_id   ║
║ FK  procedure_id        ║         ╚══════════╤══════════════╝
║ FK  completed_appt_id   ║                    │ 1
║     tooth_number        ║                    │ n
║     unit_price          ║         ╔══════════╧══════════════╗
║     status              ║         ║        PAYMENTS         ║
╚═════════════════════════╝         ║─────────────────────────║
                                    ║ PK  id                  ║
╔═════════════════════════╗         ║ FK  clinic_id           ║
║       PROCEDURES        ║         ║ FK  invoice_id          ║
║─────────────────────────║         ║     amount              ║
║ PK  id                  ║         ║     method              ║
║ FK  clinic_id           ║         ║     status              ║
║     code                ║         ║     razorpay_payment_id ║
║     name                ║         ║     razorpay_signature  ║
║     category            ║         ╚═════════════════════════╝
║     default_price       ║
║     duration_mins       ║
╚═════════════════════════╝


╔═══════════════════════════╗      n ╔════════════════════════════╗
║  WHATSAPP_CONVERSATIONS   ╠────────╣     WHATSAPP_MESSAGES      ║
║───────────────────────────║        ║────────────────────────────║
║ PK  id                    ║        ║ PK  id                     ║
║ FK  clinic_id             ║        ║ FK  clinic_id              ║
║ FK  patient_id            ║        ║ FK  conversation_id        ║
║ UQ  (clinic_id, phone)    ║        ║     direction              ║
║     patient_phone         ║        ║     type                   ║
║     state                 ║        ║     content                ║
║     context (jsonb)       ║        ║     template_name          ║
║     is_human_takeover     ║        ║     template_params (json) ║
║ FK  assigned_to_user_id   ║        ║ UQ  external_id            ║
╚═══════════════════════════╝        ║     status                 ║
                                     ║     delivered_at           ║
                                     ║     read_at                ║
                                     ╚════════════════════════════╝

╔══════════════════════════╗      n ╔═════════════════════════════╗
║  NOTIFICATION_TEMPLATES  ╠────────╣       NOTIFICATIONS         ║
║──────────────────────────║        ║─────────────────────────────║
║ PK  id                   ║        ║ PK  id                      ║
║ FK  clinic_id            ║        ║ FK  clinic_id               ║
║ UQ  (clinic,name,channel)║        ║ FK  template_id             ║
║     type                 ║        ║ FK  patient_id              ║
║     channel              ║        ║ FK  appointment_id          ║
║     body                 ║        ║ FK  invoice_id              ║
║     param_keys[]         ║        ║     channel                 ║
║     wa_template_name     ║        ║     type                    ║
║     wa_approved          ║        ║     body                    ║
║     is_system            ║        ║     status                  ║
╚══════════════════════════╝        ║     retry_count             ║
                                    ║     scheduled_at            ║
                                    ║     sent_at / delivered_at  ║
                                    ╚═════════════════════════════╝

╔════════════════════════╗
║       AUDIT_LOGS       ║
║────────────────────────║
║ PK  id (bigserial)     ║
║     clinic_id          ║
║     user_id            ║
║     action             ║
║     entity_type        ║
║     entity_id          ║
║     old_data (jsonb)   ║
║     new_data (jsonb)   ║
║     ip_address         ║
║     occurred_at        ║
╚════════════════════════╝
(immutable — no UPDATE/DELETE)
```

---

## Relationship Summary

| Parent Table            | Child Table                 | Cardinality | FK Column(s)               | ON DELETE     |
|-------------------------|-----------------------------|-------------|----------------------------|---------------|
| `clinics`               | `clinic_subscriptions`      | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `users`                     | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `patients`                  | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `family_groups`             | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `appointment_slots`         | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `appointments`              | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `procedures`                | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `treatment_plans`           | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `treatments`                | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `invoices`                  | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `payments`                  | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `whatsapp_conversations`    | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `notification_templates`    | 1 → N       | `clinic_id`                | CASCADE       |
| `clinics`               | `notifications`             | 1 → N       | `clinic_id`                | CASCADE       |
| `users`                 | `user_sessions`             | 1 → N       | `user_id`                  | CASCADE       |
| `users`                 | `appointment_slots`         | 1 → N       | `dentist_id`               | CASCADE       |
| `users`                 | `appointments` (dentist)    | 1 → N       | `dentist_id`               | RESTRICT      |
| `users`                 | `appointments` (booked_by)  | 1 → N       | `booked_by_user_id`        | SET NULL      |
| `users`                 | `treatment_plans`           | 1 → N       | `dentist_id`               | RESTRICT      |
| `users`                 | `treatments`                | 1 → N       | `dentist_id`               | RESTRICT      |
| `users`                 | `invoices`                  | 1 → N       | `created_by_id`            | SET NULL      |
| `users`                 | `whatsapp_conversations`    | 1 → N       | `assigned_to_user_id`      | SET NULL      |
| `patients`              | `patient_family_members`    | 1 → N       | `patient_id`               | CASCADE       |
| `patients`              | `appointments`              | 1 → N       | `patient_id`               | CASCADE       |
| `patients`              | `treatment_plans`           | 1 → N       | `patient_id`               | CASCADE       |
| `patients`              | `treatments`                | 1 → N       | `patient_id`               | CASCADE       |
| `patients`              | `invoices`                  | 1 → N       | `patient_id`               | CASCADE       |
| `patients`              | `whatsapp_conversations`    | 1 → 0..1    | `patient_id`               | SET NULL      |
| `patients`              | `patients` (referred_by)    | 1 → N       | `referred_by`              | SET NULL      |
| `family_groups`         | `patient_family_members`    | 1 → N       | `group_id`                 | CASCADE       |
| `appointment_slots`     | `appointments`              | 1 → 0..1    | `slot_id` (UNIQUE)         | SET NULL      |
| `appointments`          | `appointments` (reschedule) | 1 → 0..1    | `rescheduled_from_id`      | SET NULL      |
| `appointments`          | `treatments`                | 1 → N       | `appointment_id`           | CASCADE       |
| `appointments`          | `invoices`                  | 1 → 0..1    | `appointment_id` (UNIQUE)  | SET NULL      |
| `procedures`            | `treatment_plan_items`      | 1 → N       | `procedure_id`             | SET NULL      |
| `procedures`            | `treatments`                | 1 → N       | `procedure_id`             | SET NULL      |
| `procedures`            | `invoice_items`             | 1 → N       | `procedure_id`             | SET NULL      |
| `treatment_plans`       | `treatment_plan_items`      | 1 → N       | `treatment_plan_id`        | CASCADE       |
| `treatment_plan_items`  | `treatments`                | 1 → N       | `plan_item_id`             | SET NULL      |
| `invoices`              | `invoice_items`             | 1 → N       | `invoice_id`               | CASCADE       |
| `invoices`              | `payments`                  | 1 → N       | `invoice_id`               | CASCADE       |
| `treatments`            | `invoice_items`             | 1 → N       | `treatment_id`             | SET NULL      |
| `whatsapp_conversations`| `whatsapp_messages`         | 1 → N       | `conversation_id`          | CASCADE       |
| `notification_templates`| `notifications`             | 1 → N       | `template_id`              | SET NULL      |
| `appointments`          | `notifications`             | 1 → N       | `appointment_id`           | SET NULL      |
| `invoices`              | `notifications`             | 1 → N       | `invoice_id`               | SET NULL      |

---

## Index Strategy

### Multi-Tenant Isolation Indexes
Every tenant-scoped table gets `(clinic_id)` as its primary access pattern.

```sql
-- Most queries follow: WHERE clinic_id = $1 AND <secondary filter>
idx_patients_clinic         ON patients(clinic_id)
idx_appointments_clinic     ON appointments(clinic_id, appointment_date)
idx_invoices_clinic         ON invoices(clinic_id)
idx_payments_clinic         ON payments(clinic_id)
```

### Partial Indexes (high-selectivity hot paths)
```sql
-- Only index active/pending records — avoids bloat from completed historical data
idx_users_clinic_role       ON users(clinic_id, role)          WHERE is_active = true
idx_slots_available         ON appointment_slots(clinic_id, dentist_id, slot_date)
                                                               WHERE is_booked = false AND is_blocked = false
idx_appt_status             ON appointments(clinic_id, status) WHERE status NOT IN ('completed','cancelled')
idx_appt_reminder           ON appointments(clinic_id, appointment_date)
                                                               WHERE reminder_status = 'pending'
idx_inv_outstanding         ON invoices(clinic_id)             WHERE balance_amount > 0
idx_notif_retry             ON notifications(next_retry_at)    WHERE status = 'failed' AND retry_count < 3
idx_conv_takeover           ON whatsapp_conversations(clinic_id) WHERE is_human_takeover = true
```

### Full-Text Search (GIN Trigram)
```sql
-- Supports ILIKE '%search%' without full-table scans
idx_patients_name_trgm  ON patients USING gin(full_name  gin_trgm_ops)
idx_patients_phone_trgm ON patients USING gin(phone      gin_trgm_ops)
```

### Composite Indexes for Common Joins
```sql
idx_appt_clinic_dentist ON appointments(clinic_id, dentist_id, appointment_date)
idx_inv_due_date        ON invoices(clinic_id, due_date) WHERE status NOT IN ('paid','cancelled')
idx_wamsg_conv          ON whatsapp_messages(conversation_id)
idx_notif_scheduled     ON notifications(scheduled_at)   WHERE status = 'pending'
```

---

## Generated Columns (PostgreSQL 12+)

| Table                 | Column          | Expression                                         |
|-----------------------|-----------------|----------------------------------------------------|
| `treatment_plan_items`| `line_total`    | `quantity * unit_price * (1 - discount_pct / 100)` |
| `treatments`          | `line_total`    | `quantity * unit_price * (1 - discount_pct / 100)` |
| `invoice_items`       | `line_total`    | `ROUND(quantity * unit_price * (1 - discount_pct/100), 2)` |
| `treatment_plans`     | `net_cost`      | `total_cost - total_discount`                      |
| `invoices`            | `balance_amount`| `total_amount - paid_amount`                       |

---

## Database Triggers

| Trigger                         | Table        | Event            | Purpose                                        |
|---------------------------------|--------------|------------------|------------------------------------------------|
| `trg_patients_code`             | `patients`   | BEFORE INSERT    | Auto-generate `PT-0001` style patient codes    |
| `trg_invoices_number`           | `invoices`   | BEFORE INSERT    | Auto-generate `INV-2024-0001` invoice numbers  |
| `trg_payments_sync_invoice`     | `payments`   | AFTER INSERT/UPDATE | Recalculate `invoice.paid_amount` and status |
| `trg_*_updated_at` (all tables) | all          | BEFORE UPDATE    | Maintain `updated_at` timestamp                |
| `audit_no_update`               | `audit_logs` | ON UPDATE        | Prevent modification of audit records          |
| `audit_no_delete`               | `audit_logs` | ON DELETE        | Prevent deletion of audit records              |

---

## Multi-Tenant Isolation Layers

```
Layer 1 — Application   : tenantId extracted from JWT; injected into every query
Layer 2 — ORM           : all TypeORM/Prisma repos scoped by clinic_id
Layer 3 — Database      : PostgreSQL Row Level Security (optional production hardening)
Layer 4 — Connection    : SET LOCAL app.clinic_id before any query on the connection
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **UUID primary keys** | Safe for distributed inserts; no sequential ID leakage across tenants |
| **Shared schema** | Simpler ops than schema-per-tenant for <500 clinic scale; migrate if needed |
| **Generated columns for totals** | Prevents calculation drift; no application-side sync bugs |
| **JSONB for settings** | Working hours, slot config vary per clinic; avoids nullable column sprawl |
| **Separate `treatments` + `treatment_plan_items`** | Plan = what we intend; treatment = what we actually delivered; divergence is common |
| **Immutable audit_log** | DDL rules prevent UPDATE/DELETE; satisfies HIPAA-adjacent audit requirements |
| **Partial indexes** | Only index rows we actually query; historical completed records don't pollute indexes |
| **Payment trigger syncs invoice** | Single source of truth for balance; eliminates race conditions from dual writes |
| **Trigram GIN on patient name/phone** | Enables fast `ILIKE '%rajeev%'` search without full-table scans |
| **`wa_opt_in` on patients** | TRAI/GDPR compliance — only send WhatsApp to explicitly opted-in patients |
