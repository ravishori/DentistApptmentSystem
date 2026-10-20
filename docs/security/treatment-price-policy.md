# Treatment-price exposure: current behaviour and proposed policy

Status: **PROPOSAL, not enforced.** No access rule for treatment plans or the procedure catalog was changed. The only code change made while tracing this was the appointment payload redaction described under "Fixed in this pass".

## 1. Where prices live

| Data | Field(s) | Surfaces |
|---|---|---|
| Appointment | `estimatedCost` | `/appointments`, `/appointments/:id`, `/appointments/today`, book/status/reschedule responses |
| Treatment line | `unitPrice`, `discountPct` | nested in `/appointments/:id` (treatments) |
| Invoice | `totalAmount`, `balanceAmount`, `paidAmount` | `/billing/invoices`, nested `invoice` on appointments |
| Patient | `outstandingBalance` | `/patients*` |
| Procedure catalog | default price | `/treatments/procedures/catalog` |
| Treatment plans | per-line `unitPrice` | `/treatments*` |

## 2. Current permission behaviour (measured with `price_exposure_probe.js`, role x route)

| Route | admin | dentist | receptionist | assistant |
|---|---|---|---|---|
| `GET /appointments` (before fix) | money | money | money | **money (leak)** |
| `GET /appointments/:id` (before fix) | money | money | money | **money (leak)** |
| `GET /appointments*` (after fix) | money | money | money | no money, `financialsRestricted: true` |
| `GET /patients*` | gated by `billing:read` | | | no money |
| `GET /billing/invoices` | allowed | allowed | allowed | 403 |
| `GET /treatments*`, `/treatments/procedures/catalog` | 404 | 404 | 404 | 404 |

Treatment-plan and catalog controllers exist in source but are **not mounted**, so no price is reachable through them today. Their code also has problems that must be fixed before mounting: tenant scoping, mass assignment, and exposure of `passwordHash` in the users controller.

Role to permission matrix (`ROLE_PERMISSIONS`): admins all; dentist `billing:read`; receptionist `billing:read` + `billing:write`; assistant none.

## 3. Fixed in this pass (consistent with the existing billing policy, not a new rule)

Appointment responses now remove `estimatedCost`, `invoice`, and treatment `unitPrice`/`discountPct` unless the caller has `billing:read`. Keys are removed, never zeroed, and `financialsRestricted: true` is set. Same convention as patient and revenue payloads. Tests: `appointment-financials.spec.ts` (13) plus the live e2e (102/102).

## 4. Proposed policy (needs your explicit approval before any change)

1. **Viewing any price** (estimate, line price, discount, invoice amount, outstanding balance) requires `billing:read`. Assistants see none.
2. **Setting or changing prices** (treatment line price/discount, `estimatedCost`) requires `billing:write` (admins, receptionist) and additionally clinical roles only if decision A below says so.
3. **Catalog default prices** are a clinic price list: readable with `billing:read`; editable by clinic admin only.
4. **Redaction convention** for every new endpoint: remove keys, set `financialsRestricted: true`; never return `0` for hidden values.
5. **Before mounting** the treatment/catalog controllers: derive clinic from the token (`TenantId`), use whitelisted DTOs, and apply `PermissionsGuard` with `billing:*` on price fields.

## 5. Decisions needed from you

- **A.** Should dentists be able to set or adjust treatment prices (they have `billing:read` only today)?
- **B.** Does the receptionist need `estimatedCost` at booking time? (Currently yes via `billing:read`.)
- **C.** Should assistants see any price at all (for example a catalog list price for chairside quoting)? Proposal says no.
- **D.** Is the catalog price a clinic-wide list price or patient-specific? This decides whether discounts need their own permission.
- **E.** Should appointment mutation routes (book, status, reschedule) get explicit permission guards? They currently rely on authentication only.

## 6. Context from the project documents

The BRD defines three staff roles and a procedure catalog with "default pricing", but states no price-visibility rule. `ARCHITECTURE.md` documents the permission matrix above. The proposal extends that matrix rather than inventing a new axis.
