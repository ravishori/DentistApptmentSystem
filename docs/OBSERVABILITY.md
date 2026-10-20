# Observability architecture: errors, logs, tracing, health and alerts

Status of verification is tracked in [`PROJECT_FEATURE_STATUS.md`](PROJECT_FEATURE_STATUS.md) (rows M3, M8–M12, K2, O4). Operational procedures are in [`runbooks/INCIDENT_RESPONSE.md`](runbooks/INCIDENT_RESPONSE.md).

## 1. Components (all under `apps/api/src/common`)

| Component | File | Role |
|---|---|---|
| Request context | `observability/request-context.ts`, `context-store.ts` | First middleware. Accepts or generates `X-Request-Id`, reads W3C `traceparent`, stores both in `AsyncLocalStorage` so every log line and service call in the request carries them. Writes **one access-log line and the HTTP metrics per request**, including guard rejections, throttling and 404s |
| Classifier | `observability/error-classifier.ts` | Pure function: any thrown value → `{ status, code, safe message, details, retryable, severity, subsystem, alert }`. Understands Nest `HttpException`, Prisma known/unknown/initialisation/panic/validation errors (incl. raw-SQL SQLSTATEs), body-parser errors, provider (axios) errors, Redis outages |
| Exception filter | `filters/http-exception.filter.ts` (the existing global filter, extended) | The only place a failed request becomes a response + one log record + metrics + an alert |
| Redaction | `observability/redaction.ts` | Key-based (passwords, tokens, personal data) and content-based (JWTs, Bearer, connection URLs, provider keys, e-mails, phones, paths, long secrets) scrubbing; route templating |
| Structured logger | `observability/structured-logger.ts`, `logger/winston.logger.ts` | One JSON line per event on stdout/stderr. Installed as the Nest logger (`app.useLogger`), so all ~40 existing `new Logger()` call sites share the format. `winstonLogger` is a compatibility facade over it |
| Metrics | `observability/metrics.service.ts` | In-process counters, gauges, latency histogram; JSON and Prometheus text. No external platform required |
| Health | `observability/health.service.ts`, `health.controller.ts` | `GET /api/v1/health/live`, `GET /api/v1/health/ready` (public, minimal) and the `InfraHealthMonitor` |
| Alerting | `logger/error-email.service.ts` (the existing service, rewritten in place) | Bounded asynchronous e-mail queue with de-duplication, aggregation, caps, retry/backoff; the single alert path for the filter, client errors, the monitor and process handlers |
| Process handlers | `observability/process-handlers.ts` | `unhandledRejection` (log + alert, keep running) and `uncaughtException` (log + alert, bounded flush, exit 1) |
| Ops endpoints | `observability/ops.controller.ts` | `super_admin` only: metrics, alert status, test alert |
| Retry helpers | `observability/retry.ts` | Bounded retry with jittered backoff; used **only** for idempotent work (health probe). `withTimeout` swallows late rejections |
| Client side | `apps/web/src/lib/api-error.ts`, `api.ts`, `payloads.ts`, `components/ui/error-state.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/(dashboard)/error.tsx`, `app/not-found.tsx` | Shared parser, request-id header, single-flight refresh, error boundaries and error states |

`LoggingInterceptor` was removed: the middleware now logs every request exactly once.

## 2. Error response contract

Every error from the API has this shape (top-level fields marked ◆ existed before and are unchanged; `error` and `requestId` are additive):

```json
{
  "success": false,                       ◆
  "statusCode": 503,                      ◆
  "message": "The database is temporarily unavailable. Please try again in a few moments.",   ◆ string, or string[] for validation errors (as before)
  "error": {
    "code": "DB_UNAVAILABLE",             // stable; clients may branch on it
    "message": "…same safe text…",
    "requestId": "e2e-db-down-0001",      // quote this to support
    "details": [{ "field": "email", "message": "email must be an email" }],   // validation only
    "retryable": true,
    "retryAfterSeconds": 5                // only when guidance is safe (503, 429, transaction conflict)
  },
  "requestId": "e2e-db-down-0001",
  "timestamp": "2026-10-21T00:00:00.000Z", ◆
  "path": "/api/v1/patients"              ◆ (query string removed)
}
```

Headers: `X-Request-Id` on every response (success and error); `Retry-After` on 429/503. CORS exposes both.

Rules: 4xx messages are the application's own text (written for users) after scrubbing; **5xx messages are always generic**. Clients never receive stack traces, SQL, Prisma text, connection strings, file paths, field values or raw provider errors.

### Error codes

| Code | HTTP | Meaning / source |
|---|---|---|
| `VALIDATION_FAILED` | 400 | DTO validation (`details` lists fields) or a value rejected by the database |
| `MALFORMED_JSON` | 400 | Body is not valid JSON |
| `BAD_REQUEST` | 400 | Other client error |
| `UNAUTHENTICATED` | 401 | Missing/invalid/expired/revoked token |
| `FORBIDDEN` | 403 | Role/permission/tenant refusal |
| `NOT_FOUND` | 404 | Unknown route or record (also Prisma P2025) |
| `CONFLICT`, `UNIQUE_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `CONSTRAINT_VIOLATION` | 409 | Business conflict or database constraint |
| `TRANSACTION_CONFLICT` | 409 | Serialization failure/deadlock/write conflict; `retryable: true` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the limit |
| `UNPROCESSABLE` | 422 | |
| `RATE_LIMITED` | 429 | Throttler; `retryAfterSeconds` |
| `DB_UNAVAILABLE`, `DB_TIMEOUT` | 503 | Database unreachable / pool, statement or transaction timeout. **Critical, alerted** |
| `CACHE_UNAVAILABLE` | 503 | Redis unreachable. Alerted |
| `SERVICE_UNAVAILABLE`, `UPSTREAM_ERROR` | 503 / 502 | Provider or dependency failure. Alerted |
| `DATABASE_ERROR`, `INTERNAL_ERROR` | 500 | Unclassified failure. Alerted |

Unavoidable behaviour changes: none for existing success/4xx clients. `ThrottlerException` text ("ThrottlerException: Too Many Requests") is replaced by a user-friendly sentence. Prisma `P2002` previously echoed the column names ("Duplicate value for field: phone"); it now returns a generic sentence.

## 3. Logging

One JSON object per line. Envelope fields: `timestamp`, `level`, `service`, `environment`, `event`, `requestId`, `traceId`, plus `userId`/`clinicId` once known. Context fields are redacted; caller data cannot overwrite envelope fields.

| Event | When |
|---|---|
| `http.request` | Every request, once: `method`, templated `route`, `status`, `durationMs`, `slow` |
| `http.error` | Every failed request, **once**. 5xx: `errorCode`, `subsystem`, sanitised `cause` and short stack (Prisma: only name + code, because Prisma messages embed query arguments). 4xx: no stack; 401/403/429 at `warn`, others `info` |
| `alert.queued` / `alert.smtp_accepted` / `alert.delivery_retry` / `alert.delivery_failed` / `alert.dropped` / `alert.disabled` | Alert lifecycle (see §5) |
| `health.database_down`, `health.cache_down`, `health.recovered` | Probe results |
| `process.unhandled_rejection`, `process.uncaught_exception` | Outside any request |
| `client.error` | Browser-reported render error (sanitised) |
| `db.prisma_warning`, `db.prisma_error`, `db.slow_query` | Prisma events routed through the logger. Query text and parameters are **never** logged |
| `app.log` | Everything written through Nest `Logger` / `winstonLogger` |

Environment: `LOG_LEVEL` (debug|info|warn|error, default info), `LOG_FORMAT` (`json` default, `pretty` for local development), `SLOW_REQUEST_MS`, `SLOW_QUERY_MS`, `PRISMA_LOG_QUERIES=1` (durations only).

Known limitation: free-form messages thrown by application code are scrubbed by pattern only. A person's *name* inside an arbitrary exception message cannot be detected; do not put patient data in exception messages. The WhatsApp webhook controller still contains one `console.error` call (WhatsApp code is outside this change).

## 4. Database and transaction handling

- Prisma/PostgreSQL errors are classified in one place (§2). Connection failures, pool/statement/transaction timeouts and authentication failures to the database are `503 DB_*`, severity critical.
- Transactions use Prisma's `$transaction`, which rolls back on any throw; tested against real PostgreSQL (partial writes absent after a constraint failure, an application exception and a transaction timeout; the same client keeps working afterwards).
- **No automatic retry of writes.** The only bounded retry is the readiness probe (`SELECT 1`, one retry). Clients may retry `retryable` responses; mutations are never retried automatically by the web app.
- Readiness: `GET /health/ready` → 200 `{status:"ok"|"degraded", checks:{database,cache}}` or 503 `{status:"unavailable"}`. The database is required, Redis only degrades. No hostnames, ports, versions or error text are exposed.

## 5. Administrator alerts

Flow: `report()` (synchronous, never throws) → de-duplication → caps → bounded in-memory queue → one worker → SMTP with timeout → retry with exponential jittered backoff → terminal state.

| Control | Behaviour |
|---|---|
| Recipients | `ALERT_EMAIL_TO` (comma list). **No default recipient exists**; without a valid recipient *and* an SMTP target, alerting is disabled and says so in the logs |
| Transport | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`. Legacy `GMAIL_USER` + `GMAIL_APP_PASSWORD` is used **only when no `SMTP_HOST` is set** (an explicit SMTP target is never overridden by stored Gmail credentials) |
| Severity | `ALERT_MIN_SEVERITY` (default `error`): warnings are logged, not e-mailed |
| De-duplication | Fingerprint = code + subsystem + templated route + exception name. Infrastructure incidents (database, cache, upstream) are one incident regardless of route. Window `ALERT_COOLDOWN_SECONDS` (300). Suppressed repeats are counted and reported as "Occurrences since last alert" in the next alert |
| Caps | `ALERT_MAX_PER_HOUR` (30), `ALERT_QUEUE_MAX` (50, overflow dropped and counted), de-duplication table bounded at 1000 entries |
| Retry | `ALERT_MAX_ATTEMPTS` (3), base `ALERT_RETRY_BASE_MS`, `ALERT_SMTP_TIMEOUT_MS` per connection/greeting/socket |
| No recursion | A failed delivery is logged and counted only; it never creates another alert |
| Sustained outages | `InfraHealthMonitor` probes every `HEALTH_MONITOR_INTERVAL_MS`; `HEALTH_FAILURE_THRESHOLD` consecutive failures raise **one** critical alert; recovery raises **one** recovery notice |
| Content | Time, environment, service, severity, error code, request/trace id, subsystem, templated route, occurrence count, alert id, a ≤300-char sanitised summary. Never: stack traces, request bodies, headers, tokens, connection strings, IPs, user ids, patient data |
| Test alert | `POST /api/v1/ops/alerts/test?wait=true` (`super_admin`, 3/min). `GET /api/v1/ops/alerts/status?verify=true` checks the SMTP connection without sending |

**Delivery states are deliberately distinct.** `queued` = accepted for sending (a log line, not a delivery). `smtp_accepted` = the SMTP server returned success for at least one recipient. Delivery to a mailbox cannot be observed from the API; confirm it by receiving the test alert.

## 6. Metrics

`GET /api/v1/ops/metrics` (JSON) or `?format=prometheus`. Per-process; with several instances read each one.

`http_requests_total{method,status_class}`, `http_server_errors_total`, `http_client_errors_total{status}`, `http_request_duration_ms{route}` (histogram), `errors_total{code,status_class}`, `db_up`, `cache_up`, `db_health_failures_total`, `infra_outages_total{component}`, `infra_recoveries_total{component}`, `alerts_requested_total`, `alerts_queued_total`, `alerts_smtp_accepted_total`, `alerts_delivery_failures_total`, `alerts_suppressed_total{reason}`, `alerts_dropped_total{reason}`, `alerts_queue_depth`, `alerts_enabled`, `client_errors_total{level}`, `unhandled_rejections_total`, `uncaught_exceptions_total`.

## 7. Frontend

- `parseApiError` turns any axios failure into `{ kind, status, code, message, requestId, details, retryable, retryAfterSeconds }`; server wording is shown only for 4xx. `describeApiError` produces a toast string with the support reference.
- Axios client: `X-Request-Id` on every request, 20 s timeout, **single-flight token refresh that stores the rotated refresh token** (the API rotates and revokes the old one; the old client stored only the access token, so a second refresh logged the user out), one replay per request, failures are always re-thrown.
- Failed list loads render `ErrorState` (message, reference, retry) instead of the empty state on patients, appointments, billing and the dashboard.
- React Query retries only transient failures (network, timeout, 5xx, 429) at most twice; mutations are never retried; submit buttons are disabled while pending and handlers ignore re-entrant submits.
- Boundaries: `app/error.tsx`, `app/(dashboard)/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, plus the existing `ErrorBoundary`.
- The browser no longer reports API failures to `/errors/client` (the server already logged and alerted them, and the old payload included response bodies). Render errors still report; the endpoint is rate limited, field-capped, sanitised, and only `fatal` reports can become alerts.
- Form payload builders fix requests the API always rejected (gender `"MALE"`, empty optional strings, slot times `"09:00:00"`).

## 8. Build note

`apps/api/tsconfig.build.json` now excludes specs and test helpers from the production build and disables incremental builds. A stale `tsconfig.build.tsbuildinfo` combined with Nest's `deleteOutDir` previously produced an **empty `dist`** with exit code 0.
