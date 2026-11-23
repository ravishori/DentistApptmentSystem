# DentalCare AI — Master Project Progress Tracker

> **Baseline date:** 2026-11-14  
> **Repository:** https://github.com/ravishori/Ai-Dentist-System-Webapp  
> **Default branch:** main  
> **Inspected main HEAD:** `0c82c4bf733efb804aa86c879c0e305069bb128b`  
> **Status:** Initial evidence-based baseline; integration state unresolved.

## 1. Executive dashboard

| Dimension | Assessment | Evidence boundary |
|---|---|---|
| Default-branch application implementation | Not present in inspected main tree | Main contains 40 root-level governance/specification files; no application source directories were present |
| M0–M6 implementation | Reported implemented in milestone PR lineage | PR descriptions, changed-file inventories and milestone reports; branch integration must be reconciled |
| M7 practitioner management | Implemented/tested on feature branch | PR #8 open/draft; feature branch head `b5cc02fd3bf88be30e05bd86ebfa82c37066004d` |
| C3 passwordless OTP registration | Phases 3–5 reported complete; staging validation blocked | PR #9 open/draft; Phase 6 report records no usable non-production PostgreSQL |
| Live infrastructure verification | Incomplete / blocked | No live service validation performed for this tracker |
| Production readiness | NOT READY | M7 and C3 reports identify unresolved release gates |

### Percentage reporting

**No defensible aggregate completion percentage is published in this baseline.** Evidence spans multiple branches and PRs, while the inspected default branch does not contain the application source tree. A single number would obscure integration and verification status.

- Engineering completion: **NOT SCORED — canonical integration baseline unresolved**
- Verification completion: **NOT SCORED — evidence spans different branch snapshots**
- Production readiness: **NOT SCORED — release gates remain blocked**

Do not infer progress from milestone count, PR count, lines changed, or test counts.

## 2. Repository baseline and branch topology

### Default branch
- Branch: `main`
- HEAD: `0c82c4bf733efb804aa86c879c0e305069bb128b`
- Inspected tree: 40 root-level files, primarily controlled Word specifications and ZIP archives.
- No `apps/`, `packages/`, `docs/`, `.github/`, `README.md`, `CLAUDE.md`, or `.cursor/` paths were present in the inspected main tree.
- Root files include BRD, FRS, TDD, DDD, API specifications, implementation plans, QA/security and governance artefacts.

### Relevant PRs and milestone work

| Workstream | PR | Observed state | Classification |
|---|---:|---|---|
| M0 + M1 identity foundation | #1 | Open, draft, not merged | Implemented on feature branch; not integrated to main |
| M2 authorization / tenant foundation | #2 | Open, draft, not merged | Implemented on feature branch; not integrated to main |
| M3 patient domain foundation | #3 | Open, draft, not merged | Implemented on feature branch; not integrated to main |
| M4 appointment discovery | #4 | Closed, merged | Discovery/ADR record; not feature implementation |
| M4 appointment domain | #5 | Closed, merged | Implemented on milestone integration lineage; not established as main |
| M5 notification delivery | #6 | Closed, merged | Implemented on milestone integration lineage; not established as main |
| M6 appointment operations | #7 | Closed, merged | Implemented on milestone integration lineage; not established as main |
| M7 practitioner management and availability | #8 | Open, draft | Implemented/tested on feature branch; not merged/deployed |
| C3 passwordless OTP identity and registration | #9 | Open, draft | Phases 3–5 reported complete; Phase 6 staging validation blocked |

**Branch-integrity rule:** A merged PR does not necessarily mean its changes are in `main`. Reconcile commit ancestry, PR base/head and merge bases before scoring integration. PR #8 explicitly identifies a locked base on the M3 integration branch and says not to retarget to `main` without a controlled integration plan.

## 3. Milestone progress

| Milestone | Scope | Evidence-based state | Remaining / caveat |
|---|---|---|---|
| M0 | Repository/tooling baseline | Implemented in PR #1 lineage | Not present in inspected main source tree |
| M1 | Cognito OIDC authentication foundation | Reported implemented; PR #1 open/draft | Production Cognito and release gates |
| M2 | Organization/tenant authorization and RBAC | Reported implemented; PR #2 open/draft | Controlled integration and release verification |
| M3 | Organization-scoped patient domain | Reported implemented; PR #3 open/draft | Controlled integration and workflow verification |
| M4 | Appointment domain | PR #5 merged; APIs, constraints and tests reported | Confirm integration lineage; live PostgreSQL concurrency validation remains unproven |
| M5 | Notification delivery | PR #6 merged; outbox/worker/SMTP abstraction reported | SMTP/provider, worker hosting, live DB semantics and retention remain open |
| M6 | Appointment operations | PR #7 merged; lifecycle commands and tests reported | Integrated deployment and authenticated E2E remain |
| M7 | Practitioner management and availability | PR #8 draft; implementation report says implemented/tested | Staging routes reportedly 405; managed login 503; authenticated E2E blocked |
| C3 | Passwordless OTP registration | PR #9 draft; Phases 3–5 reported complete | Phase 6 DB/browser OTP validation blocked; re-audit latest source for persistent adapters and route wiring |
| M8 | Next approved milestone | Not started in available evidence | Define after M7/C3 integration and governance review |
| M9–M15 | Future milestones | Not defined in available evidence | Do not invent scope; approve milestones before creating rows |

## 4. Master feature inventory

Statuses distinguish code reported in a milestone PR from integration and release verification.

| ID | Feature | Priority | Frontend | Backend | Database | API | Tests | Verification | Evidence / remaining work |
|---|---|---|---|---|---|---|---|---|---|
| FND-001 | TypeScript modular-monolith baseline / pnpm workspace | P0 | N/A | Branch implementation | N/A | N/A | Reported | Branch-only | PR #1; reconcile integration |
| AUTH-001 | Cognito OIDC login, callback, logout, session | P0 | Routes/shell | Reported implemented | M1 migration | Auth routes | PR #1 reported suite pass | Not production verified | Provision test Cognito and validate OIDC flow |
| AUTHZ-001 | Organization membership, RBAC, default-deny authorization | P0 | Probe/shell | Reported implemented | M2 migration | Organization probe | PR #2 reported suite pass | Not production verified | Tenant/RBAC end-to-end validation |
| PAT-001 | Organization-scoped patient create/list/read/update/archive | P0 | APIs; full UI not established | Reported implemented | M3 migration | Patient API | PR #3 reported tests | Not production verified | Patient portal is a separate workflow; verify integrated route set |
| APT-001 | Create/list/read/reschedule/cancel appointments | P0 | Minimal shell | Reported implemented | M4 migration/history/exclusion | Appointment routes | PR #5 reports 124 tests / 5 E2E | Branch/PR evidence only | Live PostgreSQL exclusion/concurrency tests |
| APT-002 | Confirm/check-in/start/complete/no-show lifecycle | P0 | Minimal shell | Reported implemented | M6 migration/history | Lifecycle command routes | PR #7 reports 170 tests / 7 E2E | Branch/PR evidence only | Verify integrated and deployed authenticated journey |
| NOTIF-001 | Consent-aware notification outbox and delivery | P1 | Full UI not evidenced | Worker/ports/adapters reported | M5 migration/outbox | Notification metadata API | PR #6 reports 149 unit/integration and 6 E2E | Real delivery not verified | Sender domain/secrets, worker hosting, live DB claim semantics, retention |
| PRAC-001 | Practitioner profile management | P0 | M7 pages reported | Reported implemented | M7 migration | Practitioner routes | M7 report: 189 tests at its run | Feature branch only | PR #8 draft; resolve staging route mismatch |
| PRAC-002 | Branch assignment and practitioner schedule | P0 | M7 pages reported | Reported implemented | M7 migration | Assignment/schedule APIs | M7 report | Feature branch only | Validate deployed GET/authorization behaviour |
| PRAC-003 | Leave/unavailability and advisory availability | P1 | M7 pages reported | Reported implemented | M7 migration/constraints | Availability routes | M7 report | Feature branch only | Live PostgreSQL constraint tests not in CI evidence |
| IDN-001 | OTP challenge/passwordless authentication | P0 | C3 login/registration UI reported | C3 implementation reported | C3 migration | OTP routes | C3 report/PR #9 summaries | Phase 6 blocked | Reconcile reports, persistence adapters and route wiring |
| IDN-002 | Patient/practitioner registration, invitations and clinic codes | P1 | Registration wizard/pages in PR #9 | Services reported; earlier report identifies open gaps | C3 migration | Registration/invitation routes | C3 reported tests | Staging blocked | Prove durable persistence, rate-limit store and browser E2E |
| PORT-001 | Patient self-service portal and booking UI | P1 | Portal pages appear in PR #9 | Depends on identity/appointments | Existing domains | Mixed | Authenticated E2E blocked | Not verified | Complete synthetic patient registration and booking workflow |
| DASH-001 | Dentist dashboard / practice command centre | P1 | M7 dashboard shell/pages | Partial | Existing | APIs | M7 only | Not verified | Clinician usability and operational workflow acceptance |
| CLIN-001 | Clinical notes, odontogram, treatment plan | P2/future | Not evidenced | Not evidenced | Not evidenced | Not evidenced | Not evidenced | Not started | Requires approved clinical scope and security/privacy design |
| BILL-001 | Billing, invoices, payments, insurance | P2/future | Not evidenced | Not evidenced | Not evidenced | Not evidenced | Not evidenced | Not started | Separate requirements and payment architecture |
| AI-001 | AI dental intake, summary, patient explanations | P1 strategic | Not evidenced | Not evidenced | Not evidenced | Not evidenced | Not evidenced | Not started/unverified | Define clinician-supervised use cases, safety boundaries and evals |
| INT-001 | SMS/WhatsApp provider delivery | P1 | Operational UI not evidenced | Fake/fail-closed adapter reported | Outbox/config | Provider boundary | Simulated tests | Not production verified | Vendor, consent/legal and template gates |
| OPS-001 | Production deployment, backup/restore, monitoring, rollback | P0 | N/A | Infrastructure | Production DB unverified | Health/staging | CI reported in PRs | Blocked | Close identity, database, secrets, backup, monitoring and rollback gates |

## 5. Frontend status

PR #8 changed-file inventory includes Next.js routes/pages for dashboard, appointments, patients and practitioners, plus UI state and site-chrome components. PR #9 includes login, registration wizard, patient portal and practitioner portal pages.

Not yet established:
- Exact frontend route inventory on one integrated commit.
- Complete user journeys in a real staging environment.
- Dentist usability testing with representative clinicians.
- Patient self-service journey end-to-end.
- Responsive, accessibility and browser-matrix acceptance evidence.

## 6. Backend and API status

Milestone PRs report API/service boundaries for authentication, organization authorization, patient, appointment, notification and practitioner domains.

Reported routes include:
- Authentication: `/api/auth/login`, `callback`, `logout`, `session`
- Organization authorization: `GET /api/authz/organization`
- Patients: `/api/patients`
- Appointments: `/api/appointments`, reschedule and cancel commands
- Lifecycle: confirm, check-in, start, complete, no-show
- Notifications: `GET /api/notifications/:outboxId`
- Practitioners: `/api/practitioners`, branches, schedules, unavailability and availability
- C3: OTP, invitation, clinic-code and registration routes

Route existence does not prove production availability. PR #8 reported deployed schedule GET returning 405 and managed login returning 503 at the time of its report.

## 7. Database and migrations

Reported additive Prisma migrations:
- M1: `20260814120000_m1_authentication_identity`
- M2: `20260814180000_m2_organization_authorization`
- M3: `20260814190000_m3_patient_identity`
- M4: `20260815120000_m4_appointment_domain`
- M5: `20260815140000_m5_notification_delivery`
- M6: `20260815160000_m6_appointment_operations`
- M7: `20260815180000_m7_practitioner_availability`
- C3: `20260815220000_c3_otp_identity_registration`

This tracker has not run Prisma validation or inspected a live database. Do not execute migrations during documentation maintenance.

## 8. Patient portal

- M3 provides staff-managed, organization-scoped patient records.
- C3 PR #9 introduces patient login/registration and a portal page.
- Full patient self-service, consent, account lifecycle and appointment-booking journey are not independently verified in a connectable staging environment.
- Keep patient identity distinct from application-user identity as specified by architecture.

## 9. Dentist dashboard and practice management

- M7 report identifies practitioner profiles, branch assignments, schedule create/replace, leave/unavailability and advisory availability.
- PR #8 includes dashboard, appointments, patients and practitioners pages.
- Practice configuration, staff management, dentist usability and production workflow remain to be evaluated.
- Do not infer a complete practice-management suite from dashboard pages alone.

## 10. Appointment management

Reported implementation:
- Organization-scoped create/list/read.
- Reschedule and cancel commands.
- Practitioner/branch/patient organization integrity.
- PostgreSQL exclusion constraints preventing overlapping active practitioner and patient appointments.
- M6 confirm, check-in, start, complete and no-show commands.
- Appointment history and security events.

Open evidence:
- Live PostgreSQL exclusion/concurrency tests were explicitly not run in CI in M5/M7 reports.
- Deployed authenticated journey remains unverified.
- Calendar integration is not part of reported M4–M7 scope.

## 11. AI dental intelligence

No implementation evidence for a production AI dental workflow was identified in reviewed M0–M7/C3 PR descriptions and changed-file inventories.

Potential future capabilities requiring explicit approval:
- AI-assisted intake summarisation for clinician review.
- Patient-friendly explanation of clinician-approved treatment plans.
- Dental FAQ and post-procedure education with escalation.
- Draft documentation only with clinician review/approval.

AI must not autonomously diagnose, prescribe or decide treatment. Do not count architecture ideas or provider configuration as implemented product features.

## 12. Notifications and integrations

M5 report / PR #6 records:
- Consent and opt-out.
- Delivery port with fake, fail-closed and SMTP adapters.
- Outbox states, atomic claims, lease recovery, idempotency and retry/backoff.
- Worker disabled by default and real sending behind explicit configuration.
- Templates for appointment created/rescheduled/cancelled.

Open:
- Real SMTP sender/domain/secrets.
- Worker hosting and monitoring.
- Live PostgreSQL claim semantics.
- Delivery retention policy.
- SMS/WhatsApp provider and template approval.
- Calendar integration.

## 13. Billing, payments and analytics

No verified implementation evidence in reviewed M0–M7/C3 PR materials. Keep future scope until approved requirements, architecture, tests and implementation evidence exist.

## 14. Security and privacy

Reported controls:
- OIDC Authorization Code + PKCE, state/nonce and RS256 token verification.
- Application-owned sessions with HttpOnly cookie and hashed server-side token.
- Organization membership/RBAC with default deny.
- Organization-scoped patient and appointment repositories.
- Safe 404 handling for cross-tenant object access.
- Consent/opt-out and fail-closed notification delivery.
- OTP HMAC hashing, per-challenge salt, expiry, attempt and resend controls in C3 report.
- Security/concurrency tests reported by milestone PRs.

Open/unverified:
- Production Cognito provisioning and identity cutover.
- Connectable non-production PostgreSQL and real migration verification for C3.
- Live DB concurrency/exclusion tests.
- Independent security/privacy review.
- Production secrets, logging, monitoring, backup/restore, retention and rollback.
- C3 OTP storage/provider/browser flows against latest source.
- No real patient data in development or testing.

## 15. Testing and quality assurance

Reported snapshots from different PRs (not one combined current run):

| PR / milestone | Reported validation |
|---|---|
| PR #1 M1 | 42 tests; lint, format, typecheck, DB validation, build, security and E2E reported pass |
| PR #2 M2 | 69 tests; quality gates reported pass; 3 E2E |
| PR #3 M3 | 94 tests; gates reported pass; 4 E2E |
| PR #5 M4 | 124 tests; gates reported pass; 5 E2E |
| PR #6 M5 | 149 unit/integration; 6 E2E; live Postgres SKIP LOCKED not run |
| PR #7 M6 | 170 tests; gates reported pass; 7 E2E |
| PR #8 M7 | 189 tests at validation point; gates reported pass; 8 E2E; live PostgreSQL exclusion tests not run |
| PR #9 C3 | Phase 3 report says 211 tests; PR summary later says 230 Vitest + 32 Playwright smoke for Phases 3–5; Phase 6 staging/browser validation blocked |

Do not add these counts together. They are incremental/reported snapshots from different branches and dates. A fresh integrated test run is required before publishing current suite totals.

## 16. Production readiness

**Release status: NOT READY / BLOCKED**, based on latest available branch reports.

Known blockers:
1. M7 Render staging schedule routes reportedly returned 405 where unauthenticated access should reach auth and return 401.
2. Cognito/managed identity provider reportedly unconfigured; login returned 503.
3. Authenticated E2E depends on identity provisioning.
4. M7 PR #8 remains draft and not merged.
5. C3 PR #9 remains draft; Phase 6 blocked by unavailable non-production PostgreSQL and missing env values in the validation process.
6. Production Postgres, backup/recovery, secrets, DNS and credentials require operator provisioning and validation.
7. Real SMTP/SMS/WhatsApp must remain disabled until approved and verified.
8. Independent security/privacy and retention review remain required.
9. No production deployment or live infrastructure change was performed by this tracker creation.

## 17. Open blockers and technical debt

| ID | Severity | Item | Required action |
|---|---|---|---|
| BLK-001 | Critical | Feature branches not represented in inspected main tree | Establish controlled integration base; do not retarget/merge blindly |
| BLK-002 | Critical | M7 staging schedules routes reportedly 405 | Deploy approved M7 commit to dedicated staging; verify route/auth response |
| BLK-003 | Critical | Cognito managed auth reportedly unset; login 503 | Provision non-production Cognito and secrets; validate OIDC |
| BLK-004 | Critical | C3 Phase 6 no connectable non-production PostgreSQL | Provision dedicated staging/test DB and inject secrets into validation environment |
| BLK-005 | High | Live PostgreSQL exclusion/concurrency not verified | Add PostgreSQL-backed integration tests and execute |
| BLK-006 | High | M5 worker hosting, SMTP and delivery operations open | Provision after approval; monitor retries and terminal failures |
| BLK-007 | High | C3 persistent adapters/route wiring had gaps in earlier report | Re-audit latest PR #9 and prove DB-backed browser flow |
| BLK-008 | High | Patient portal authenticated booking journey not verified | Complete staging E2E with synthetic accounts |
| BLK-009 | Medium | Independent security/privacy review not evidenced | Complete before real patient data/public launch |
| BLK-010 | Medium | Backup/restore, retention and operational runbooks unproven | Define and test RPO/RTO, restore and retention |

## 18. Prioritised roadmap

### P0 — Integration and trustworthy baseline
- Reconcile branch graph, PR bases and source-of-truth governance.
- Establish a canonical integration branch containing approved M0–M7 sequence.
- Preserve PR #8's locked base until a reviewed integration plan exists.
- Run clean full test/typecheck/lint/build/DB validation on the integrated commit.
- Reconcile C3 scope and route/persistence implementation without bypassing approved architecture.

### P0 — Staging identity and database
- Provision dedicated non-production PostgreSQL accessible to validation environment.
- Provision Cognito test pool and non-production secrets.
- Deploy approved candidate to staging only.
- Verify health, auth, organization isolation, patient and appointment endpoints.
- Run live database migration and concurrency/exclusion tests.
- Complete authenticated browser E2E using synthetic data only.

### P1 — Operational workflows
- Resolve M7 route 405 and managed login 503.
- Finish patient registration/portal booking E2E.
- Validate notification worker, retries, consent and SMTP in controlled sandbox.
- Improve dentist workflow UX following clinician usability review.

### P1/P2 — Product expansion
- Approve AI dental intelligence scope and safety model.
- Define clinical records/odontogram/treatment plan requirements.
- Define billing/payment and analytics requirements.
- Define SMS/WhatsApp and calendar integrations.

### P0 — Production launch gates
- Independent security/privacy review.
- Legal review, privacy notice, consent, retention and data-processing agreements.
- Production Postgres, backups, restore drill, secrets, monitoring, alerting and rollback.
- Staging sign-off and explicit human production approval.

## 19. Development change log

| Date | Change | Evidence |
|---|---|---|
| 2026-11-14 | Initial tracker assembled from GitHub main tree, PR #1–#9 metadata, changed-file manifests and milestone reports | Main HEAD 0c82c4bf733efb804aa86c879c0e305069bb128b; PRs #1–#9; branch reports |
| 2026-11-22 | **Reconciliation note (documentation-only):** this tracker document is present inside the DentalEase repository (`D:\ravishori\DentistAptSystem`, remote `ravishori/DentistApptmentSystem`) but its contents describe a **different project** (`ravishori/Ai-Dentist-System-Webapp`, "DentalCare AI", Cognito OIDC, M0–M7 / C3). No implementation state in sections 2–18 above has been changed. For DentalEase, the authoritative progress record is `docs/PROJECT_FEATURE_STATUS.md` (per `AGENTS.md` §1). New DentalEase v1.0 requirements documents were added alongside this tracker: `BRD_DentalEase_v1.0.md`, `FRD_DentalEase_v1.0.md`, `RBAC_Permissions_Matrix_v1.0.md`, `Clinical_Workflow_Specification_v1.0.md`, `Financial_Workflow_Specification_v1.0.md`, `NFR_Security_Requirements_v1.0.md`, `Production_Acceptance_Criteria_v1.0.md`. No code, migrations, data or branch state was touched. | Branch `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050`; documents in `docs/project/` |
| 2026-11-22 | **Rev 1.1 amendments to the DentalEase v1.0 requirements set** applied per owner-approved **DentalEase v1.0 — Owner Decision Record** (items A1–D21). Summary of changes across the seven documents: two primary clinic roles (Dentist, Receptionist) + `isClinicOwner` attribute; Assistant deferred; Super Admin repositioned as platform-only; dentist-approval gate on every booking including WhatsApp self-bookings; TreatmentSession approved as a distinct clinical/billing artefact; split payments, separate receipts, configurable GST, configurable discount limits, dentist-approved refunds added; insurance and treatment packages moved out of v1.0 scope. New open items BR-OPEN-009…014. Sections 2–18 above (DentalCare AI content) remain unchanged. **No code, migration, route, data or branch change was performed.** | Branch `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050`; updated documents in `docs/project/` |

Append a row for every meaningful implementation session. Do not delete prior entries; add a reconciliation note when earlier assessments change.

## 20. Mandatory update policy

Every agent/developer making a meaningful implementation change must update this tracker as part of the same task.

### Before development
1. Read this tracker and applicable repository governance.
2. Inspect Git status, branch, HEAD and PR base/head.
3. Identify approved requirements/ADR and affected feature IDs.
4. Distinguish current branch work from integrated work.

### After meaningful implementation
1. Update affected feature rows and milestone status.
2. Record commit SHA(s), branch and PR.
3. Record exact test commands and actual pass/fail/skip/block outcomes.
4. Update blockers, dependencies and next actions.
5. Recalculate scores only when acceptance criteria and weights support the calculation.
6. Append a dated change-log entry; retain history.
7. Do not write secrets, patient data or sensitive environment values.

### Status vocabulary
- **NOT STARTED** — no implementation evidence.
- **IN PROGRESS** — active, incomplete work.
- **IMPLEMENTED** — code path exists; acceptance criteria not fully tested.
- **TESTED** — relevant automated tests passed at a recorded commit.
- **VERIFIED** — acceptance criteria and required runtime/integration checks passed.
- **BLOCKED** — dependency or external gate prevents completion.
- **DEFERRED** — explicitly postponed by approved decision.
- **NOT IN SCOPE** — excluded from approved scope.

### Evidence and scoring
- File/schema/interface existence is not proof of a working feature.
- IMPLEMENTED means code exists; TESTED means relevant automated tests passed at a stated commit; VERIFIED requires applicable acceptance criteria and runtime/integration evidence.
- Mark skipped/blocked checks honestly.
- Report unmerged branch work as branch-only; do not claim it is integrated or production-ready.
- Do not aggregate incremental test counts across branches.
- Score engineering, verification and production readiness separately.
- Until a canonical integration baseline and feature-level weight catalogue are approved, keep percentages **NOT SCORED** rather than inventing numbers.

### Safety
Tracker maintenance does not authorise unrelated code changes, migrations, production configuration changes, deployment, PR retargeting/merging, real provider delivery or use of real patient data.

## 21. Decisions and deferred scope

- Cognito is the managed OIDC identity provider behind `AuthenticationPort` per the reported ADR governance.
- Application-owned organization membership/RBAC is the authorization source of truth.
- Patient and appointment data are organization-scoped.
- Notification delivery is outbox-based, consent-aware and disabled by default for real delivery.
- Calendar integrations are not part of reported M4–M7 implementation.
- Clinical records, treatment planning, odontogram, billing and AI dentistry remain unverified/future scope unless approved through controlled requirements.
- Do not merge, retarget, deploy, migrate production or enable real delivery as part of tracker maintenance.

## Evidence register

- [Main repository tree](https://github.com/ravishori/Ai-Dentist-System-Webapp/tree/main)
- [PR #1 M0/M1](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/1)
- [PR #2 M2](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/2)
- [PR #3 M3](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/3)
- [PR #4 M4 discovery](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/4)
- [PR #5 M4 appointments](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/5)
- [PR #6 M5 notifications](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/6)
- [PR #7 M6 operations](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/7)
- [PR #8 M7 practitioners](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/8)
- [PR #9 C3 OTP identity](https://github.com/ravishori/Ai-Dentist-System-Webapp/pull/9)

**Last inspected:** 2026-11-14. Re-run branch/PR/CI inspection before treating this as the current engineering state.
