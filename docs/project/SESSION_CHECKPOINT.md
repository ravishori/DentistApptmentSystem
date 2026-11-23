# DentalEase — Session Checkpoint

**Date:** 2026-11-23
**Branch:** `security/remediation-sprint-01` (tracking `origin/security/remediation-sprint-01`)
**Baseline HEAD at session start:** `938182e9a8513fad0c25bced6c6ebe52fbc29050` *(feat(web): complete appointment management dialogs)*
**HEAD after checkpoint commits:** `dd1279921557792b198d59e9679a854e14fef4e7`
**Remote:** `origin` → `https://github.com/ravishori/DentistApptmentSystem.git`

Purpose: provide a reliable, documented resume point so work can continue without session context.

---

## 1. Commits in this checkpoint

Four atomic commits ahead of the starting baseline, in order:

| # | SHA | Message | Scope |
|---|---|---|---|
| C1 | `60d53b8` | feat(api): versioned credential encryption (enc:v1:) with legacy fallback | API encryption service |
| C2 | `399e472` | feat(api): WhatsApp service hardening + unit coverage | API WhatsApp module |
| C3 | `1cb0e65` | docs(project): add DentalEase v1.0 Rev 1.1 requirements set + imported tracker | Project docs |
| C4 | `dd12799` | docs: add competitor research packages (BR-COMP-001, BR-COMP-002) | Research archives |

### C1 — `60d53b8` encryption credential wrapper

Files:

- `apps/api/src/common/encryption/encryption.service.ts` — adds `encryptCredential(plaintext)` / `decryptCredential(stored)` using the versioned `enc:v1:<base64 AES-256-GCM>` format. Decrypt accepts legacy unmarked plaintext for the migration window; fails closed on unknown or corrupted formats.
- `apps/api/src/common/encryption/encryption-credentials.spec.ts` — new unit coverage.

### C2 — `399e472` WhatsApp service hardening

Files:

- `apps/api/src/modules/whatsapp/whatsapp.service.ts` — expanded logic and provider-selection handling.
- `apps/api/src/modules/whatsapp/whatsapp.service.spec.ts` — new unit suite.
- `apps/api/src/modules/whatsapp/whatsapp-provider.spec.ts` — broader coverage of provider configuration checks.

WhatsApp code is preserved; WhatsApp feature delivery remains deferred to the final stage of the development roadmap.

### C3 — `1cb0e65` Rev 1.1 requirements set under `docs/project/`

Files:

- `BRD_DentalEase_v1.0.md`
- `FRD_DentalEase_v1.0.md`
- `RBAC_Permissions_Matrix_v1.0.md`
- `Clinical_Workflow_Specification_v1.0.md`
- `Financial_Workflow_Specification_v1.0.md`
- `NFR_Security_Requirements_v1.0.md`
- `Production_Acceptance_Criteria_v1.0.md`
- `PROJECT_DOCS_README.md` (index + precedence rule)
- `DEVELOPMENT_DOCUMENTATION_POLICY.md` (imported governance)
- `MASTER_PROJECT_TRACKER.md` (imported from DentalCare AI; reconciliation note added — authoritative progress record remains `docs/PROJECT_FEATURE_STATUS.md`)

MFS Drafts 1–9 remain session-only working history and are not in the repository. Creation is gated by owner decision **J-3**.

### C4 — `dd12799` competitor research packages

Files:

- `docs/BR-COMP-001_Research_Package_v1.0.zip`
- `docs/BR-COMP-001_COMP-002_DentsKart_Research_Package_v1.0.zip`

---

## 2. P0-1 verification — TypeScript + production build baseline

Verified in this session before the commits above. No source changes were required to pass; the baseline was already clean at `938182e9`.

| Step | Command | Result |
|---|---|---|
| API TypeScript | `cd apps/api && npx tsc --noEmit` | Exit 0; 0 errors |
| API build | `cd apps/api && npm run build` (nest build → tsc) | Exit 0; `apps/api/dist/` populated |
| Web TypeScript | `cd apps/web && npx tsc --noEmit` | Exit 0; 0 errors |
| Web build | `cd apps/web && NEXT_DIST_DIR=.next-build NODE_ENV=production npx next build` | Exit 0; 15 routes compiled |
| API tests | `cd apps/api && npx jest --silent` | 922 passed, 134 skipped (int specs without `TEST_DATABASE_URL`); 36 of 45 suites passed, 9 skipped |
| Web tests | `cd apps/web && npm test -- --watchAll=false --silent` | 233 passed; 8 suites passed |

Live HTTP suite (`scripts/e2e/auth-and-contracts.js`) not run — requires a running API against a disposable DB; will be scheduled in P0-5 / P0-2 work.

---

## 3. Current stabilisation backlog (P0)

| ID | Task | Status | Owner decision needed |
|---|---|---|---|
| P0-1 | TypeScript + production-build baseline | ✅ Verified | — |
| P0-2 | DB tenancy — **application tenant guard via Prisma `$extends` client extension**; do NOT ship RLS on a freely settable `app.clinic_id` GUC as the authoritative boundary | Not started | K-1 remains open for a true DB-level boundary; the app-layer guard is the defensible interim |
| P0-3 | `/patients*` route permission guards | Not started | BR-OPEN-003 (dentist write scope) |
| P0-4 | Authentication hardening (enumeration, blacklist fail-closed, atomic lock counter, counter reset on expiry) | Not started | BR-OPEN-002 |
| P0-5 | `prisma/migrations` baseline + migrator-role separation | Not started | — |
| P0-6 | Error alert delivery verification | Not started | BR-OPEN-006 (recipient + SMTP) |
| P0-7 | Backup / restore drill on `dentalease_db` | Not started | BR-OPEN-007 |
| P0-8 | Unmounted modules disposition — `tenants`, `treatments`, `users` | Not started | BR-OPEN-008 |

Explicit non-P0:

- **WhatsApp integration** (Twilio inbound signature, templates, reminders, `AutomationService` disposition) — deferred to the final stage per owner directive. Existing WhatsApp code preserved and committed in C2.
- **Complex financial adjustments / credit-refund allocation** — deferred as `FIN-DEFER-01..03` pending the financial-rules correction cycle. Core billing (invoice, payment, receipt, split, direct Dentist-approved refund) remains approved scope.

---

## 4. Deferred work

| ID | Item | Reason |
|---|---|---|
| J-1 | Create `CLAUDE.md` at repo root | Owner approval pending |
| J-2 | Create `.claude/skills/feature-delivery/SKILL.md` + `.claude/skills/security-rbac-review/SKILL.md` | Owner approval pending |
| J-3 | Create `docs/project/Master_Functional_Spec_DentalEase_v1.0.md` with Draft 9 content | Owner approval pending; Drafts 1–9 are session history |
| J-4, J-5 | Custom agents, commands, hooks | Not requested; not planned |
| FIN-DEFER-01 | Credit-refund reservation release races across non-UPI modes | Rules correction cycle |
| FIN-DEFER-02 | Split-group credit-refund reconciliation when a source Payment is subsequently voided | Rules correction cycle |
| FIN-DEFER-03 | Cap-interaction between pre-cap `credit_applied_to_invoice` and later `post_credit_*` reversal | Rules correction cycle |
| WhatsApp P2-27 | Integration (Twilio signature, template approval, provisional/confirm/reminder/follow-up/broadcast end-to-end) | Last priority in current roadmap |
| Treatment packages / insurance (BR-OOS-004/005) | Owner-authorised feature-flag OFF or deprecation | P2-28 |

Open-decision register unchanged: BR-OPEN-001…014 · RP-OPEN-001…004 · CW-OPEN-001…005 · FW-OPEN-001…005 · D-1…D-11 · E-1…E-3 · F-1…F-6 · G-1…G-5 · H-1…H-5 · J-1…J-5 · K-1…K-15 · L-1…L-5 · M-1, M-3, M-4 · N-1, N-2 · P-1…P-8 *(P-8 closed by Draft 9 design; implementation gated by FIN-DEFER)*. N-3, N-4 remain `[superseded]`.

---

## 5. Next recommended task

**P0-2 — DB tenancy: application tenant guard via Prisma `$extends` client extension.**

- Highest leverage after a green baseline.
- Does not rely on an untrusted `app.clinic_id` GUC as the authoritative boundary.
- Closes cross-tenant leaks from missed `where { clinicId }` clauses and `$queryRaw` call sites.
- Unblocks a safer P0-3 (patient route guards).

Acceptance (to be re-confirmed before start):

- Prisma client extension on `$allOperations` injects / validates `clinicId` on every tenant-scoped model.
- `data.clinicId` mismatch → `TENANT_CONTEXT_MISMATCH`.
- `where` missing `clinicId` on a tenant-scoped model → auto-narrowed to the request's JWT `clinicId`.
- `prisma.$queryRaw` / `$queryRawUnsafe` confined to an allow-listed set reviewed by DBA.
- Integration spec `tenant-guard.int.spec.ts`: cross-clinic SELECT returns 0 rows; cross-clinic UPDATE rejected.
- RBAC and existing service-layer redaction left in place as defence in depth.

Alternative first tasks on request:

- P0-5 Prisma migrations baseline (enables future schema change discipline).
- P0-4 Authentication hardening (closes enumeration / Redis-outage posture).
- P0-6 Alert email delivery verification (operability).

---

## 6. Repository state snapshot

- Local branch: `security/remediation-sprint-01`
- Upstream: `origin/security/remediation-sprint-01` (new branch created on push)
- Working tree: clean at `dd12799` (this document is the next commit)
- `main` untouched; no merge performed; no force-push performed; no history rewritten

Pull-request URL offered by GitHub for review:
`https://github.com/ravishori/DentistApptmentSystem/pull/new/security/remediation-sprint-01`

---

## 7. Resume guidance

1. Re-verify baseline: `git fetch`, confirm `security/remediation-sprint-01` is at `dd12799` or newer.
2. Read, in order: `AGENTS.md`, `docs/PROJECT_FEATURE_STATUS.md`, this checkpoint, the seven Rev 1.1 documents under `docs/project/`.
3. Decide the next approved slice (recommended: P0-2).
4. Build-and-test baseline (`tsc --noEmit`, `npm run build`, Jest) should be green out of the box.
5. Preserve existing uncommitted / untracked work in any follow-on session; do not reset, clean or stash.
6. Do not merge to `main`, do not force-push, do not switch branches without explicit approval.
