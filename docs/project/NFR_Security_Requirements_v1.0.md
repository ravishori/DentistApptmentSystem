# Non-Functional Security Requirements — DentalEase v1.0

| | |
|---|---|
| Document ID | NFR-SEC-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Baseline | `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only |
| Authoritative sources | `ARCHITECTURE.md` §5, `AGENTS.md` §3 / §5, `docs/security/*`, `docs/OBSERVABILITY.md`, `docs/runbooks/INCIDENT_RESPONSE.md`, `docs/PROJECT_FEATURE_STATUS.md` A-, O-, P-rows |

> `[A]` approved and evidenced. `[P]` proposed / under decision. `[!]` unresolved blocker for production.

---

## 1. Authentication and session

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-AUTH-001 | Password hashing: bcrypt cost 12 for all stored user passwords. | PFSR A1 | [A] |
| NFR-SEC-AUTH-002 | Response and audit payloads SHALL NOT contain `passwordHash`, password, or any hash. | PFSR A1, log-hygiene.spec | [A] |
| NFR-SEC-AUTH-003 | JWT access tokens SHALL NOT embed privileges; role SHALL be loaded from DB on every request. | PFSR A3, A4 | [A] |
| NFR-SEC-AUTH-004 | Refresh tokens SHALL be rotated and carry a unique `jti`; a replayed refresh token SHALL be rejected. | PFSR A3 | [A] |
| NFR-SEC-AUTH-005 | Logout SHALL revoke both the refresh token and the issued access token immediately. | PFSR A3 | [A] |
| NFR-SEC-AUTH-006 | 5 consecutive failed logins SHALL lock the account for 15 minutes. | PFSR A2 | [A] |
| NFR-SEC-AUTH-007 | Lockout counter reset after expiry, atomic increment, enumeration safety. | `docs/security/sensitive-data-authorisation-review.md` A7, A8 | [!] |
| NFR-SEC-AUTH-008 | Token blacklist SHALL fail-closed when Redis is unreachable; current state fails open. | `docs/security/sensitive-data-authorisation-review.md` A9 | [!] |

## 2. Authorisation and tenancy

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-AUTHZ-001 | `clinicId` SHALL come from the verified JWT only; never trusted from request body or query. | `ARCHITECTURE.md` §5 | [A] |
| NFR-SEC-AUTHZ-002 | Cross-tenant object access SHALL return 404 (safe). | PFSR P4 | [A] |
| NFR-SEC-AUTHZ-003 | Guard order SHALL be: Throttler → JwtAuth → TenantIsolation → Roles → Permissions. | PFSR §1 | [A] |
| NFR-SEC-AUTHZ-004 | PostgreSQL row-level security SHALL be enabled before production. v1.0 relies on application-layer isolation only. | BR-CST-005 | [!] |
| NFR-SEC-AUTHZ-005 | `/patients*` permission enforcement decision. | PFSR A4, P5 | [!] |
| NFR-SEC-AUTHZ-006 | Appointment mutation permission enforcement decision. | PFSR A4 | [!] |
| NFR-SEC-AUTHZ-007 | WhatsApp conversation / message read permission decision. | Review W1 | [!] |
| NFR-SEC-AUTHZ-008 | Target role model is two primary clinic roles (Dentist, Receptionist) + `isClinicOwner` attribute; Super Admin is platform-only; Assistant is deferred. The current five-enum implementation remains until BR-OPEN-011 is closed. | Decision Record A1–A4 | [A] Documentation of target. |
| NFR-SEC-AUTHZ-009 | Every appointment booking SHALL remain pending until it is approved by a dentist (FR-APT-APPROVE). Approval metadata SHALL be auditable (`approvedByUserId`, `approvedAt`). | Decision Record A5, C16–C18 | [A] |
| NFR-SEC-AUTHZ-010 | Refund execution SHALL require a prior dentist approval record; a receptionist MAY execute, but SHALL NOT approve (FR-BIL-REFUND). | Decision Record B11 | [A] |
| NFR-SEC-AUTHZ-011 | Discounts above clinic cap SHALL require approver metadata (FR-BIL-DISC). | Decision Record B14 | [A] |

## 3. Input validation and data integrity

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-VAL-001 | All controllers SHALL use the global ValidationPipe with whitelist + transform. | PFSR §1 | [A] |
| NFR-SEC-VAL-002 | DTOs SHALL use explicit field lists; mass assignment via Prisma spread is prohibited. | PFSR P3 | [A] |
| NFR-SEC-VAL-003 | Password DTO fields SHALL reject non-string JSON (`KeepRaw` pattern) on register and login. | PFSR A3 | [A] |
| NFR-SEC-VAL-004 | Phone number format SHALL be validated at the DTO (E.164). | PFSR P7 | [!] |
| NFR-SEC-VAL-005 | Query parameters `page` and `limit` SHALL be validated with `@Min/@Max`. | Review W3 | [!] |

## 4. Data protection

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-DATA-001 | Transport: HTTPS enforced with HSTS; TLS 1.3 in production. | `ARCHITECTURE.md` §5 | [A] |
| NFR-SEC-DATA-002 | S3 documents and attachments SHALL be encrypted at rest (AES-256) with signed URLs for access. | `ARCHITECTURE.md` §5 | [A] |
| NFR-SEC-DATA-003 | Secrets SHALL live in `.env` locally and in AWS Secrets Manager in production; `.env.example` holds placeholders only. | `AGENTS.md` §3 | [A] |
| NFR-SEC-DATA-004 | Database SHALL be reachable only from the application subnet / VPN; listen address and firewall SHALL be reviewed before production. | PFSR §2 | [!] |
| NFR-SEC-DATA-005 | Backups SHALL be scheduled (daily minimum) and SHALL be restore-tested before production. | PFSR §2, BR-OPEN-007 | [!] |
| NFR-SEC-DATA-006 | Encryption of sensitive clinical fields (e.g. medical history) SHALL be considered; current build hashes passwords and encrypts secrets, but clinical-field-level encryption is NOT applied. | `apps/api/src/common/encryption/encryption.service.ts` | [P] |
| NFR-SEC-DATA-007 | No real patient data SHALL be used in development, testing or demo environments. | `AGENTS.md` §3 | [A] |

## 5. Platform integrations

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-INT-001 | Razorpay signatures (HMAC-SHA256) SHALL be verified before marking any payment success. | PFSR L-, M- | [A] |
| NFR-SEC-INT-002 | Twilio inbound webhook SHALL verify Twilio signatures. | PFSR O3 | [!] |
| NFR-SEC-INT-003 | 360Dialog webhook SHALL perform payload origin validation. | `ARCHITECTURE.md` §5 | [A] |
| NFR-SEC-INT-004 | No tests or scripts SHALL call live providers (Razorpay, Twilio, 360Dialog, SES, S3). | `AGENTS.md` §3 | [A] |
| NFR-SEC-INT-005 | WhatsApp provider delivery SHALL be disabled by default; only clinics with configured credentials SHALL be able to send live messages. | BR-OOS-005 | [A] |

## 6. Rate limiting and abuse protection

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-RATE-001 | Global default: 100 requests per minute per IP. | `ARCHITECTURE.md` §5 | [A] |
| NFR-SEC-RATE-002 | `POST /auth/register`: 5 per minute per IP. | PFSR A1 | [A] |
| NFR-SEC-RATE-003 | `POST /auth/login`: 10 per minute per IP. | PFSR A2 | [A] |
| NFR-SEC-RATE-004 | Helmet SHALL set security headers. | `ARCHITECTURE.md` §5 | [A] |
| NFR-SEC-RATE-005 | CORS SHALL whitelist web origin + localhost (dev only). | `ARCHITECTURE.md` §5 | [A] |

## 7. Logging, observability and alerting

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-OBS-001 | All failed requests SHALL be shaped by the single global `HttpExceptionFilter`. Per-controller error bodies are prohibited. | `AGENTS.md` §5 | [A] |
| NFR-SEC-OBS-002 | Logs SHALL be structured via `logEvent(level, 'domain.event', { ...context })`; exception messages SHALL use `errText(err)`, never `err.message`. | `AGENTS.md` §5 | [A] |
| NFR-SEC-OBS-003 | Logs and alerts SHALL NOT contain phone numbers (unmasked), patient names, PII, SQL, stack traces, Prisma messages or secrets. | `AGENTS.md` §5 | [A] |
| NFR-SEC-OBS-004 | `console.*` in production code is prohibited (enforced by `log-hygiene.spec.ts`). | `AGENTS.md` §5 | [A] |
| NFR-SEC-OBS-005 | Error alerts go only via `ErrorEmailService.report()` with environment-only configuration; `smtp_accepted` is NOT delivery proof. | `AGENTS.md` §5 | [A] |
| NFR-SEC-OBS-006 | Alert delivery SHALL be verified via `POST /ops/alerts/test?wait=true` (super_admin) before production. | `AGENTS.md` §5 | [!] |
| NFR-SEC-OBS-007 | Retries SHALL NOT be applied to DB writes or provider calls; `retry.ts` is only for idempotent probes. | `AGENTS.md` §5 | [A] |

## 8. Operational security

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-OPS-001 | Swagger (`/api/docs`) SHALL NOT be exposed in production. | PFSR §2 | [!] |
| NFR-SEC-OPS-002 | Container ports SHALL be restricted to the application subnet. | PFSR §2 | [!] |
| NFR-SEC-OPS-003 | External uptime monitoring SHALL be configured. | PFSR §2 | [!] |
| NFR-SEC-OPS-004 | Incident response procedure SHALL be practised and up to date. | `docs/runbooks/INCIDENT_RESPONSE.md` | [A] |
| NFR-SEC-OPS-005 | Independent security / privacy review SHALL be completed before launch. | `docs/security/*` | [!] |
| NFR-SEC-OPS-006 | DPDP / GDPR applicability SHALL be reviewed; retention and subject-access procedures SHALL be defined. | BR-CST, `docs/security/*` | [!] |

## 9. Governance

| NFR-SEC ID | Requirement | Source | Type |
|---|---|---|---|
| NFR-SEC-GOV-001 | `AGENTS.md` SHALL govern every change; feature status updates SHALL accompany implementation changes. | `AGENTS.md` §1 | [A] |
| NFR-SEC-GOV-002 | No force-push on protected branches. | `AGENTS.md` §3 | [A] |
| NFR-SEC-GOV-003 | `.env`, secrets, DB dumps, `node_modules`, `dist`, `.next*` SHALL NOT be committed. | `AGENTS.md` §3 | [A] |
| NFR-SEC-GOV-004 | Database migrations SHALL be approved by owner before application; proposed ones live in `database/proposals/`. | `AGENTS.md` §3, PFSR §2 | [A] |

## 10. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial NFR-Security requirements v1.0. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved Decision Record. Added NFR-SEC-AUTHZ-008 (target role model), NFR-SEC-AUTHZ-009 (dentist approval gate), NFR-SEC-AUTHZ-010 (refund approval), NFR-SEC-AUTHZ-011 (discount approval). **No code change authorised.** | Documentation agent |
