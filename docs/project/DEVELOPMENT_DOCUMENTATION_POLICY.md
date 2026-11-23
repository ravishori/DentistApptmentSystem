# Development Documentation Update Policy

**Project:** DentalCare AI / AI Dentist System Web Application  
**Authoritative progress record:** `docs/project/MASTER_PROJECT_TRACKER.md`

## Mandatory rule

Any agent or developer making a meaningful implementation change must update the master tracker as part of the same task. Documentation-only, formatting-only or exploratory work that changes no implementation must not increase progress scores.

## Before work
1. Read `docs/project/MASTER_PROJECT_TRACKER.md`.
2. Read applicable controlled requirements, architecture decisions and governance rules.
3. Inspect Git status, branch, HEAD and PR base/head.
4. Identify affected feature IDs and acceptance criteria.
5. Do not assume a feature branch is integrated into `main`.

## After work
1. Record feature status changes with evidence.
2. Record branch, commit SHA and PR reference.
3. Record exact validation commands and pass/fail/skip/block outcomes.
4. Update blockers, dependencies and next actions.
5. Recalculate scores only when feature acceptance criteria and weights support it.
6. Append a dated change-log entry; never erase prior history.
7. Keep secrets, patient data and sensitive environment values out of documentation.

## Evidence standard
- File/schema/interface existence is not proof of a working feature.
- IMPLEMENTED means code exists; TESTED means relevant automated tests passed at a stated commit; VERIFIED requires applicable acceptance criteria and runtime/integration evidence.
- Mark blocked checks as BLOCKED or NOT VERIFIED. Never fabricate results.
- Report code on unmerged branches as branch-only; do not present as integrated or production-ready.
- Do not aggregate counts from incremental runs or different branches.

## Safety boundary
Updating this tracker does not authorise unrelated code changes, migrations, production configuration changes, deployments, PR retargeting/merging, enabling real provider delivery or handling real patient data.

## Pull request checklist
- [ ] Read the current master tracker.
- [ ] Updated affected feature/milestone rows where implementation changed.
- [ ] Added commit/branch/PR evidence.
- [ ] Recorded relevant tests and outcomes, including skipped/blocked checks.
- [ ] Updated blockers and next actions.
- [ ] Added a change-log entry without deleting history.
- [ ] Did not claim branch-only or unverified work as integrated/verified.
