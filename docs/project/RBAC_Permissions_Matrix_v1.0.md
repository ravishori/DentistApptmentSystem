# RBAC Permissions Matrix — DentalEase v1.0

| | |
|---|---|
| Document ID | RBAC-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Baseline | `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only |
| Authoritative sources | `apps/api/src/common/guards/permissions.guard.ts`, `apps/api/src/common/guards/roles.guard.ts`, `docs/security/sensitive-data-authorisation-review.md`, `docs/security/treatment-price-policy.md`, `docs/PROJECT_FEATURE_STATUS.md` A4, P5–P8 |

> **Convention.** `A` = approved permission in the current build. `P` = proposed permission requiring owner approval (tracked in a security review). `—` = no access. `*` = admin bypass. "Route" refers to the mounted route set in PFSR §1.

---

## 1. Roles — target model (owner-approved)

Owner-approved by Decision Record (2026-11-22) items A1–A4. Clinic has **exactly two primary roles** (Dentist, Receptionist). Clinic ownership is an **attribute** (`isClinicOwner`) on a user of either primary role, not a separate role. Assistant is **deferred** from v1.0. Super Admin is a **platform-operations role only**, not a clinic role.

| Role | ID | Scope | Source |
|---|---|---|---|
| Dentist | RP-ROLE-001 | Primary clinic role. Clinical capture, treatment plans, treatment sessions, booking approval, refund approval, revenue insights. May be elevated by the ownership attribute. | Decision Record A1 |
| Receptionist | RP-ROLE-002 | Primary clinic role. Patient intake, appointments intake, billing entry, chat escalation. May execute a refund that a dentist has approved. May be elevated by the ownership attribute. | Decision Record A1 |
| **Attribute** `isClinicOwner` | RP-ROLE-ATTR-001 | **Not a role.** Boolean (or equivalent permission) on a user of either primary role. Confers the administrative permissions that the deprecated `clinic_admin` role currently holds: staff management, clinic settings, GST configuration, discount-limit configuration, policy overrides. | Decision Record A2 |
| Super admin (platform) | RP-ROLE-003 | Platform operations only. Not part of the clinic permission matrix. Used for ops endpoints (`POST /ops/alerts/test`), backup orchestration, cross-tenant support. | Decision Record A4 |
| Assistant | RP-ROLE-DEFER-001 | **Deferred from v1.0** by Decision Record A3. Enum value remains in schema; no permission grants in v1.0 target model. | Decision Record A3 |

### Code-vs-target model gap

`apps/api/src/common/guards/permissions.guard.ts` currently implements five enum values (`super_admin`, `clinic_admin`, `dentist`, `receptionist`, `assistant`). This matrix documents the target model. Decision Record D20 does **not authorise** any code change. Reconciliation is tracked under BR-OPEN-011.

## 2. Target permission grants

Admin bypass on the target model is granted by the `isClinicOwner` attribute on a user of either primary role.

| Permission ID | Permission | dentist | receptionist | +`isClinicOwner` |
|---|---|---|---|---|
| RP-PERM-001 | `patients:read` | A | A | A |
| RP-PERM-002 | `patients:write` | pending BR-OPEN-003 | A | A |
| RP-PERM-003 | `appointments:read` | A | A | A |
| RP-PERM-004 | `appointments:write` | A | A (subject to FR-APT-APPROVE: creation only; approval requires dentist) | A |
| RP-PERM-APT-APPROVE | `appointments:approve` (new) | A | — | A (owner-dentist only) |
| RP-PERM-005 | `treatments:read` | A | A | A |
| RP-PERM-006 | `treatments:write` | A | pending BR-OPEN-004 | A |
| RP-PERM-SESSION | `treatment_sessions:write` (new) | A | — | A |
| RP-PERM-007 | `billing:read` | A | A | A |
| RP-PERM-008 | `billing:write` | — | A | A |
| RP-PERM-DISC | `billing:discount_override` (new) | pending BR-OPEN-013 | — | A |
| RP-PERM-REFUND-APPROVE | `billing:refund_approve` (new) | A | — | A |
| RP-PERM-REFUND-EXECUTE | `billing:refund_execute` (new) | A | A (only with a valid approver) | A |
| RP-PERM-RCPT | `billing:receipt_issue` (new, usually automatic on payment success) | A | A | A |
| RP-PERM-009 | `whatsapp:send` | A | A | A |
| RP-PERM-010 | `analytics:read` | A | A | A |
| RP-PERM-CLINIC-ADMIN | `clinic:admin` (settings, GST toggle, discount-cap config, staff mgmt) | — | — | A (owner only) |

> Grants that are **"pending"** depend on BR-OPEN-003, BR-OPEN-004 or BR-OPEN-013 and MUST be closed before implementation.

## 3. Route-to-permission map

Routes marked `No guard` have been identified in the sensitive-data authorisation review as needing a decision (BR-OPEN-003). Mapping is derived from `permissions.guard.ts`, `docs/security/sensitive-data-authorisation-review.md` and route inventory in PFSR §1.

| Area | Representative route | Required permission | Admin bypass | Current enforcement | Notes |
|---|---|---|---|---|---|
| Auth | `POST /auth/login` | Public | n/a | Guard order applied | Rate-limited 10/min |
| Auth | `GET /auth/me` | authenticated | n/a | JwtAuthGuard | |
| Clinic | `PATCH /clinic/profile` | `clinic_admin` role | admins | `@Roles(UserRole.clinic_admin, UserRole.super_admin)` | |
| Clinic | `GET /clinic/stats` | authenticated | admins | `RevenueAccessService` applied | Financial KPIs redacted without `billing:read`. |
| Clinic | `POST /clinic/staff` | `clinic_admin` role | admins | `@Roles(UserRole.clinic_admin, UserRole.super_admin)` | |
| Patients | `GET /patients*`, `POST /patients`, `PATCH /patients/:id` | **Pending** `patients:*` | admins | **No guard today** | Decision BR-OPEN-003. Applying matrix removes assistant access and freezes demographic edits by dentist. `[!]` |
| Patients | `GET /patients/stats` | authenticated + `billing:read` for `totalOutstanding` | admins | Redacted for non-`billing:read` | Verified P2. |
| Appointments | `GET /appointments*` | **Pending** permission guard | admins | **Read is authenticated only** | Reads currently rely on authentication. `[!]` Financial fields redacted without `billing:read` (verified). |
| Appointments | `POST /appointments`, `PATCH /appointments/:id/*` | **Pending** permission guard | admins | **Write is authenticated only** | `[!]` |
| Slots | `GET /appointments/slots` with `includeAll=true` | `SLOT_MANAGER_ROLES` | admins | Enforced inside controller | Blocked slot reasons are restricted. |
| Slots | `POST /appointments/slots/generate` | `clinic_admin`, `super_admin` | admins | `@Roles(UserRole.clinic_admin, UserRole.super_admin)` | |
| Treatments / catalog | `/treatments*` | `treatments:read/write`, `billing:*` for prices | admins | **Controllers not mounted** | `[!]` Block on BR-OPEN-008. |
| Billing | `GET /billing/invoices` | `billing:read` | admins | Guarded | Assistant → 403. |
| Billing | `POST /billing/invoices`, `POST /billing/payments/*` | `billing:write` | admins | Guarded | |
| WhatsApp send | `POST /whatsapp/send*` | `whatsapp:send` | admins | Guarded | Only with configured provider. |
| WhatsApp conversations | `GET /whatsapp/conversations*`, `/messages` | **Pending** read permission | admins | **No guard today** | `[!]` W1–W3, authorisation review. |
| WhatsApp webhook | `POST /whatsapp/webhook/:clinicId` | Public, signature verified | n/a | **Signature verification pending** | BR-OPEN-005 `[!]`. |
| Analytics | `GET /analytics/*` | `analytics:read`; revenue-containing routes require `billing:read` | admins | Guarded + `RevenueAccessService` | |
| Errors | `POST /errors/client` | Public | n/a | Rate-limited | Frontend error reporting. |
| Ops alerts | `POST /ops/alerts/test` | `super_admin` | n/a | Guarded | Not required for clinic operations. |

## 4. RBAC decisions still open

| ID | Decision | Owner | Reference |
|---|---|---|---|
| RP-OPEN-001 | Apply `patients:*` guards (and whether dentists can edit demographics / allergies / medical history). | Clinical + product | BR-OPEN-003, PFSR A4, P5 |
| RP-OPEN-002 | Treatment-price edit permission (dentist vs admin-only). | Clinical + product | `docs/security/treatment-price-policy.md` §5 (A) |
| RP-OPEN-003 | Appointment mutation guards (book, status, reschedule, cancel). | Product | PFSR A4, price-policy §5 (E) |
| RP-OPEN-004 | WhatsApp conversation / message **read** permission and payload redaction. | Product + security | Review W1–W3 |
| RP-OPEN-005 | Assistant role utility (should assistant hold any permission in v1.0, or remain intentionally empty?). | Clinical + product | `permissions.guard.ts` |

## 5. Enforcement guarantees

- Admin bypass: `super_admin` and `clinic_admin` are always admitted by `PermissionsGuard` before per-permission checks.
- `@Public()` routes are admitted without user context and MUST NOT evaluate per-user permissions.
- Role in token is advisory only; `JwtStrategy` loads the role from the database on every request (FR-AUTH-005).
- Guard order: `Throttler → JwtAuth → TenantIsolation → Roles → Permissions`.

## 6. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial RBAC matrix v1.0. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved Decision Record. Rewrote §1 to the two-primary-role model + `isClinicOwner` attribute (A1–A2); deferred Assistant (A3); scoped Super Admin to platform ops only (A4). Added new permissions in §2: `appointments:approve`, `treatment_sessions:write`, `billing:discount_override`, `billing:refund_approve`, `billing:refund_execute`, `billing:receipt_issue`, `clinic:admin`. Noted code-vs-target gap under BR-OPEN-011. **No code change authorised.** | Documentation agent |
