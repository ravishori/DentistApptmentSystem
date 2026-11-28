# Project Documentation Index — DentalEase v1.0

Repository: `D:\ravishori\DentistAptSystem` (remote `origin` = `https://github.com/ravishori/DentistApptmentSystem.git`).

## DentalEase v1.0 — controlled documents

| Document | Purpose |
|---|---|
| [Business Requirements Document](BRD_DentalEase_v1.0.md) | Vision, goals, user personas, in/out of scope, assumptions, unresolved business decisions, traceability |
| [Functional Requirements Document](FRD_DentalEase_v1.0.md) | Functional requirements per capability area, traced to BRD rows and `docs/PROJECT_FEATURE_STATUS.md` (PFSR) features |
| [RBAC Permissions Matrix](RBAC_Permissions_Matrix_v1.0.md) | Role model, permission grants, route-to-permission map, open RBAC decisions |
| [Clinical Workflow Specification](Clinical_Workflow_Specification_v1.0.md) | Patient onboarding, appointments, clinical capture, reminders, escalation |
| [Financial Workflow Specification](Financial_Workflow_Specification_v1.0.md) | Invoices, payments, refunds, due tracking, GST reporting, packages, insurance claims |
| [Non-Functional Security Requirements](NFR_Security_Requirements_v1.0.md) | Authentication, authorisation, data protection, observability, operational security |
| [Production Acceptance Criteria](Production_Acceptance_Criteria_v1.0.md) | Launch gates, security gates, operational readiness, provider verification |

## Governance

| Document | Purpose |
|---|---|
| [Development Documentation Update Policy](DEVELOPMENT_DOCUMENTATION_POLICY.md) | Tracker update process. Note: the policy was imported from an earlier project and continues to govern documentation-vs-implementation discipline; its examples that reference "DentalCare AI" do not control DentalEase scope. |
| [Master Project Progress Tracker](MASTER_PROJECT_TRACKER.md) | **Conflict note:** this tracker was imported from a different project (`ravishori/Ai-Dentist-System-Webapp`, Cognito OIDC, M0–M7 / C3). DentalEase (this repository) uses a JWT + Prisma architecture governed by `AGENTS.md` and tracked for feature status in `docs/PROJECT_FEATURE_STATUS.md`. Until the imported tracker is either superseded or scoped, treat `docs/PROJECT_FEATURE_STATUS.md` as the authoritative progress record for DentalEase. The tracker carries a dated change-log entry describing this conflict. |

## Companion authoritative sources (outside `docs/project/`)

| File | Role |
|---|---|
| `AGENTS.md` | Repository governance; mandatory feature-status discipline; safety rules. |
| `docs/PROJECT_FEATURE_STATUS.md` | Evidence-based feature status (A1–P5). Authoritative for verification state. |
| `ARCHITECTURE.md` | Technical architecture (modules, schema, APIs, multi-tenancy, scaling, security). |
| `database/schema.prisma` | Authoritative data model. |
| `docs/security/*` | Sensitive-data authorisation review, treatment-price policy, WhatsApp route inventory. |
| `docs/OBSERVABILITY.md` | Logging, alerting, retries. |
| `docs/runbooks/INCIDENT_RESPONSE.md` | On-call runbook. |

## Precedence rule

In case of conflict between the documents above, the precedence for DentalEase v1.0 is:
1. `AGENTS.md` (governance + safety) — overrides all.
2. `docs/PROJECT_FEATURE_STATUS.md` (feature evidence) — authoritative for what actually works.
3. `database/schema.prisma` and source files under `apps/` — authoritative for current implementation.
4. `ARCHITECTURE.md` — authoritative for architecture intent.
5. The `docs/project/` v1.0 BRD / FRD / RBAC / workflows / NFR / PAC — authoritative for approved requirements and acceptance criteria.
6. `docs/project/MASTER_PROJECT_TRACKER.md` — imported from another project; raise before relying on its M0–M7 / C3 content.

## Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Added DentalEase v1.0 controlled documents (BRD, FRD, RBAC, clinical workflow, financial workflow, NFR-security, production acceptance). Noted conflict with imported `MASTER_PROJECT_TRACKER.md`. Documentation-only. | Documentation agent |
| 2026-11-22 | Rev 1.1 amendments applied to all seven controlled documents per owner-approved **DentalEase v1.0 — Owner Decision Record** (items A1–D21): two-primary-role model + ownership attribute, dentist approval gate on every booking, TreatmentSession as separate artefact, split payments, separate receipts, configurable GST, configurable discount limits, dentist-approved refunds; insurance and treatment packages moved to OOS. Prior document history preserved per `DEVELOPMENT_DOCUMENTATION_POLICY.md`. **No code, migration, route, data or branch change.** | Documentation agent |
