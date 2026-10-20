# PostgreSQL hardening plan — READ-ONLY ANALYSIS, NOTHING HAS BEEN CHANGED

Scope: the local PostgreSQL 18 instance that serves `dentalease_db` (service `postgresql-x64-18`, data directory
`D:\Program Files\PostgreSQL\18\data`, port 5432). Gathered by read-only inspection on 2026-10-20/21.
No firewall rule, config file, service, role, password or database was modified.

## 1. Verified facts

| Item | Verified value |
|---|---|
| Listening sockets | `0.0.0.0:5432` and `[::]:5432` (`listen_addresses = '*'`), owner process = the `postgresql-x64-18` service |
| Authentication (`pg_hba.conf`) | `host … 127.0.0.1/32` and `::1/128` only, method `scram-sha-256`; **no** non-loopback `host` line, no `trust` |
| Network category | Wi-Fi `10.95.156.247` is classified **Public**; the other adapters are link-local (169.254.x.x) |
| Windows Firewall profiles | Domain / Private / Public all **enabled** |
| Inbound allow rules naming postgres | **Two**, both `DisplayName = "PostgreSQL Server"`, Enabled, Inbound, Allow, **Profile = Public**, Program `D:\program files\postgresql\18\bin\postgres.exe`, LocalPort Any, RemoteAddress Any — see exact `Name`s below |
| Rule `Name` (TCP) | `TCP Query User{59A39969-B541-42A7-B422-9E95A12EEC0A}D:\program files\postgresql\18\bin\postgres.exe` |
| Rule `Name` (UDP) | `UDP Query User{1E8CECFF-524D-4E99-85F6-F3E3E79A014D}D:\program files\postgresql\18\bin\postgres.exe` |
| Origin of the rules | The "Query User" naming is what Windows creates when someone clicks **Allow** on the "allow this app through the firewall" prompt — not an installer-managed rule group (`Group` is empty) |
| Any other rule admitting TCP 5432 | None found (no explicit-port rule) |
| Service dependencies | `postgresql-x64-18` requires `RPCSS`; **nothing depends on it** (no dependent services). A second service `PostgreSQL18` points at the **same data directory**, is Stopped and set to **Automatic** |
| Established connections to 5432 | None at inspection time; no local client process currently connected |
| This project's DB host | `localhost` (`DB_HOST`, `DATABASE_URL`) → loopback, which Windows Firewall does not filter |
| Evidence of outside attempts | Server logs from 2026-01-03 to 2026-10-21 contain exactly **one** "no pg_hba.conf entry" rejection — my own probe through the machine's own Wi-Fi address. No other host has ever reached the authentication stage |
| Live proof | A connection attempt via `10.95.156.247:5432` with a made-up user was refused with `no pg_hba.conf entry for host …` **before any password prompt** |

## 2. Risk assessment

* **Not exploitable for credential guessing from the network today**: `pg_hba.conf` rejects every non-loopback source before
  authentication, so a remote party cannot even attempt a password.
* **Residual exposure**: the TCP port is reachable from the Public Wi-Fi segment. Anyone there can open connections
  (fingerprint the server version, exhaust `max_connections = 100`, or exercise pre-authentication code paths — the only
  place a PostgreSQL vulnerability could matter here). That surface is unnecessary because nothing remote needs this database.
* **Defence in depth is single-layer**: if someone later adds a convenient `host all all 0.0.0.0/0` line to `pg_hba.conf`, the
  wildcard listen address plus the Public-profile allow rule would immediately expose the database. Removing either layer prevents that.

## 3. Recommended changes (in order — each independently useful, none executed)

### Step A — close the firewall hole (instant, reversible, zero downtime) — RECOMMENDED FIRST
Disables both inbound rules. Loopback (`127.0.0.1`, `::1`) traffic is not subject to Windows Firewall, so the API, pgAdmin
on this machine and every test are unaffected. The UDP rule is not used by PostgreSQL at all.
```powershell
# preview exactly what will be disabled (read-only)
Get-NetFirewallRule -DisplayName 'PostgreSQL Server' | Select-Object Name, Enabled, Profile, Direction, Action

# apply (needs an elevated PowerShell)
Get-NetFirewallRule -DisplayName 'PostgreSQL Server' | Disable-NetFirewallRule

# verify: a LAN-address connection must now time out / be refused instead of reaching pg_hba
$env:PGCONNECT_TIMEOUT='5'
& 'D:\Program Files\PostgreSQL\18\bin\psql.exe' -h 10.95.156.247 -p 5432 -U nobody -d postgres -w -c 'select 1'
# verify: loopback still reaches authentication ("no password supplied" / "password authentication failed" is fine here)
& 'D:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -p 5432 -U nobody -d postgres -w -c 'select 1'

# ROLLBACK
Get-NetFirewallRule -DisplayName 'PostgreSQL Server' | Enable-NetFirewallRule
```
Dependency check before applying: no remote client is connected and the project connects over loopback. Confirm with the
person who set the rule up that no other PC (a colleague, a BI tool, pgAdmin elsewhere) uses this database over Wi-Fi.

### Step B — bind to loopback only (persistent; needs a service restart → brief downtime)
Edit `postgresql.conf` (back it up first): `listen_addresses = 'localhost'` (covers both 127.0.0.1 and ::1).
Schedule it when the API and tests are idle; restart interrupts every open connection.
```powershell
Copy-Item 'D:\Program Files\PostgreSQL\18\data\postgresql.conf' "$env:TEMP\postgresql.conf.bak-$(Get-Date -f yyyyMMdd-HHmm)"
# edit listen_addresses, then:
Restart-Service postgresql-x64-18
Get-NetTCPConnection -LocalPort 5432 -State Listen | Select-Object LocalAddress   # expect only 127.0.0.1 and ::1
# ROLLBACK: restore the backup file and Restart-Service postgresql-x64-18
```

### Step C — make authentication problems diagnosable (reload only, no restart)
Today `log_connections` is off and `log_line_prefix = '%t '` records no user/database, so successful logins are invisible and
failures cannot be attributed. Set `log_connections = on`, `log_disconnections = on`, `log_line_prefix = '%t [%p] %u@%d '`, then
`& 'D:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' reload -D 'D:\Program Files\PostgreSQL\18\data'`.
(This does not change any credential. It would have shown which client keeps failing as `postgres`.)

### Step D — remove the boot-time conflict
`PostgreSQL18` (Stopped, Automatic) targets the same data directory as `postgresql-x64-18`. At boot one of them can fail to
start. Set the unused one to Disabled: `Set-Service PostgreSQL18 -StartupType Disabled` (rollback: `-StartupType Automatic`).
Verify first which of the two is the one you intend to keep (`postgresql-x64-18` is the running one).

## 4. Explicitly NOT recommended
* Do not edit `pg_hba.conf` to `trust`, even temporarily, to recover the password — see the single-user-mode option below.
* Do not widen `pg_hba.conf` to any non-loopback network.
* Do not delete the firewall rules (disable is reversible and leaves an audit trail).
* Do not change port 5432 as a "security" measure — it adds nothing and breaks the project's configuration.

## 5. Related: the `postgres` password failure (diagnosis only)
The server logs intermittent `password authentication failed for user "postgres"` since 2026-01-03. The `.env` value is
syntactically fine (no whitespace/quotes/encoding problem; both `.env` files agree on user, host, port, database), so the stored
password for the role simply differs from the one the project is configured with. Recovery options that need **no** `trust`
and **no** `pg_hba.conf` edit:
1. Use the login saved in pgAdmin on this machine (its configuration directory exists) to run `ALTER ROLE postgres PASSWORD …`.
2. Retrieve the password chosen at installation time (EDB installer prompt).
3. Single-user mode (needs a short outage): stop `postgresql-x64-18`, run
   `postgres --single -D "D:\Program Files\PostgreSQL\18\data" postgres`, execute `ALTER ROLE postgres PASSWORD '…';`, exit, start the service.
   Afterwards update the project's `.env` yourself — I did not and will not touch credentials.
