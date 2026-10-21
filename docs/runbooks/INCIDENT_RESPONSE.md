# Incident response runbook

Audience: whoever receives the administrator alert e-mail. Background: [`../OBSERVABILITY.md`](../OBSERVABILITY.md).
Nothing here requires a paid tool: the evidence is the API's JSON logs, `/health/*` and `/ops/*`.

## 0. What an alert tells you

Subject: `[DentalEase <ENV>][<SEVERITY>] <CODE> - <subsystem>`; body: time, environment, service, request/trace id, templated route, how many identical errors were suppressed since the last alert, a short sanitised summary. It never contains patient data or secrets. A line "TEST" or "RECOVERED" in the subject is informational.

Alerts are de-duplicated for `ALERT_COOLDOWN_SECONDS` (default 5 min): **one e-mail can mean many failures**; read "Occurrences since last alert".

## 1. First five minutes

1. Is it up? `GET /api/v1/health/live` (process) and `GET /api/v1/health/ready` (database). `503 unavailable` = database down.
2. Find the evidence. Exception *messages* are deliberately not in the logs (they can contain patient data); use the error code, route, request id and stack. For local reproduction only, start the API with `LOG_ERROR_MESSAGES=full`. Logs are one JSON object per line. With the request id from the alert:
   ```powershell
   Select-String -Path api.log -Pattern '"requestId":"<id>"'     # every line of that request
   Select-String -Path api.log -Pattern '"event":"http.error"' | Select-Object -Last 20
   ```
   `http.error` shows `errorCode`, `subsystem`, `route`, and for 5xx a sanitised `cause` and short stack.
3. Size it. Sign in as `super_admin` and call `GET /api/v1/ops/metrics`: `errors_total{code=…}`, `http_server_errors_total`, `db_up`, `cache_up`, `alerts_*`.
4. Customer-facing symptom? Users see "temporarily unavailable" / "Something went wrong" with a **reference** (the request id). Ask for it.

## 2. By error code

| Code | Likely cause | Check | Action |
|---|---|---|---|
| `DB_UNAVAILABLE` | PostgreSQL stopped, network/firewall, credential rejected (`P1000/P1010`), too many connections | `/health/ready`; PostgreSQL service status and log; can `psql` connect with the app's credentials? | Restore the service or fix the network. **Do not reset credentials or change firewall rules without owner approval.** The API reconnects by itself; no restart is normally needed |
| `DB_TIMEOUT` | Pool exhausted, long statement, lock contention | `db.slow_query` events; `pg_stat_activity` | Find the blocking query/transaction; consider raising `connection_limit` only after finding the cause |
| `CACHE_UNAVAILABLE` | Redis down | `/health/ready` shows `cache: down` (status `degraded`) | Restore Redis. Meanwhile: token revocation checks fail open, rate limits and sessions degraded, WhatsApp pinning falls back to memory |
| `INTERNAL_ERROR` / `DATABASE_ERROR` | Bug or unexpected data | `http.error` with `cause.name`/`code` and stack for that request id | Reproduce with the route + the failing step; fix and add a test. Prisma messages are deliberately not logged (they contain query arguments) so use the stack and the route |
| `UPSTREAM_ERROR` / `SERVICE_UNAVAILABLE` | Razorpay / Twilio / 360Dialog / S3 / SES outage or credentials | Provider status page; recent `http.error` for billing/whatsapp routes | Wait for the provider or fix credentials; payment webhooks are idempotent, reminders use claim/lease so retries do not duplicate |
| `UNHANDLED_REJECTION` | A promise failed without a handler | `process.unhandled_rejection` event + stack | Bug fix. The process keeps running |
| `UNCAUGHT_EXCEPTION` | Fatal bug; the process **exits** | Last lines before exit; supervisor restart count | Make sure the supervisor restarts it; then fix the bug |
| `CLIENT_FATAL_ERROR` | Browser render error | `client.error` events (`page`, sanitised message) | Reproduce on that page; ship a fix |
| `TEST_ALERT` | Someone ran the test | — | None |

## 3. Verify recovery

1. `GET /health/ready` → `200` with `database: up`.
2. A real read works: sign in and open Patients (or `GET /api/v1/patients` with a token) → `200`.
3. `GET /ops/metrics`: `db_up` = 1; `errors_total{code="DB_UNAVAILABLE"}` has stopped increasing between two reads a minute apart.
4. A **recovery notice** (`RECOVERED`) arrives once the monitor sees `HEALTH_FAILURE_THRESHOLD`-clearing success.
5. Look for lost work: appointments or invoices created during the outage are not in the database (the API returned 503, nothing was written). Transactions roll back completely. Ask staff to re-enter anything that showed a failure reference.

## 4. Alerting itself

- `GET /ops/alerts/status?verify=true` (super_admin): `enabled`, `recipientsConfigured`, `queueDepth`, `lastSmtpAcceptedAt`, `lastFailureAt/Reason`, and `smtpConnection.ok` (a real SMTP handshake, nothing sent).
- Send a labelled test: `POST /ops/alerts/test?wait=true` → `outcome: "smtp_accepted"` means the SMTP server accepted it; **confirm the e-mail in the mailbox** before trusting the channel. `failed` → see `lastFailureReason`.
- `enabled: false`: either `ALERT_EMAIL_TO` or the SMTP settings are missing (the start-up log line `alert.disabled` says which). There is no default recipient.
- Alerts missing during an incident: check `alerts_suppressed_total` (de-duplication/hourly cap), `alerts_dropped_total` (queue full), `alerts_delivery_failures_total` (SMTP problem). A failing SMTP server never blocks users and never generates further alerts, so **the mail channel can fail silently except for these counters and the `alert.delivery_failed` log line**. Watch them.
- SMTP provider outage: alerts for that period are lost after `ALERT_MAX_ATTEMPTS`; use the logs.

## 5. After the incident

Record: start/end, impact, root cause, the request ids you used, what monitoring would have caught it earlier. Update `docs/PROJECT_FEATURE_STATUS.md` if a feature status or risk changed (see `AGENTS.md`).

## 6. Things this runbook does not cover (open gaps)

No external uptime monitor, pager or log shipper is configured; nobody is notified if the API process itself is down or if the SMTP server is down at the same time as the incident. Metrics are per process and reset on restart. Add a free external uptime check against `/api/v1/health/ready` as the first improvement.
