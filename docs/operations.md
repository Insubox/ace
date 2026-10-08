# Operational checks

An infrastructure operator can read the live authenticated snapshot:

```sh
node scripts/check-operations.mjs
```

The script uses the existing `ACE_API_URL` and securely configured `ACE_API_TOKEN`.
Do not paste the token into a browser, source file or chat. Workspace account
administrators do not receive infrastructure operator access.

`GET /v1/operations` returns current D1 status counts, trials accepted and
verification workflows requested in the last 24 hours, completion duration for
finished trials, the current evaluator binary identity, actual Observatory daily
registration/container counters, and the latest completed backup and isolated
restore drill. Budget reads do not reserve work. Source code, request bodies,
private project identities, account details and recovery credentials are omitted.

Trial duration includes assembly, queues, retries, evaluation and archival from
original acceptance to completion. It is not candidate execution latency. D1
counts describe retained mirrors, not live queue depth, and a completed workflow
does not assert that its proposal qualified. No monetary estimate is returned:
provider billing is not collected by ACE.

Alerts identify trials or verifications pending for more than 90 minutes and the
absence of a backup sealed within the last 36 hours with a completed restore
drill. `backup_sealed_at` is the backup seal time, not the drill completion time.
Inspect original
trial status before repairing a failed workflow; retrying keeps its identity and
completed observations. Investigate an unfinished backup with the backup checker
before creating another one. Daily limits are eight new manual trials, sixteen
actual assembly/archive/application containers, two exact-source application
replays after an evaluator change, and four new backups. Replays share the
sixteen-container ceiling and cannot introduce edited proposals. Existing backed-up data
can be restored independently without creating a new backup reservation.

For other operating failures:

1. Authentication: use the documented recovery ticket flow and revoke old sessions.
2. Missing or corrupt objects: preserve evidence, stop interpreting that version,
   and verify the isolated backup before restoration. Never overwrite production
   data as part of a restore drill.
3. Evaluator upgrades: preserve older verification receipts and their original
   binary identity; request a new independent verification when needed.
4. Failed release builds: leave existing preview tags intact, fix the source and
   run all platform jobs before publishing a new version.

Cloudflare's Worker and container logs remain the provider's runtime telemetry.
The ACE snapshot does not supply provider billing, an uptime SLA, external
monitoring, a completed production failover or high-concurrency measurements.

Native hosting now retains up to 1,024 versions and 4,096 branch updates per
store. Journals, publisher records, reviews and tasks migrate from legacy values
inside their next atomic transaction into 64 KiB pages; this avoids Durable
Object's 128 KiB value limit. Tests race 20 publishers and 40 campaign admissions:
only one journal proposal wins, and campaign admission never exceeds 32/project.
Limits on evaluator spending are unchanged. This is concurrency correctness
coverage, not a production throughput benchmark.

Run an independent monitor on a machine outside Cloudflare:

```sh
export NODE_USE_ENV_PROXY=1 # only when your environment supplies a proxy
node cloud/scripts/monitor.mjs --watch --interval 60 --state /private/ace-monitor.json
```

Use the existing private `ACE_API_URL`/`ACE_API_TOKEN` configuration. Without
`ACE_ALERT_WEBHOOK_URL`, the monitor prints observations and sends nothing.
Explicitly configuring an HTTPS receiver enables JSON alerts, deduplicated for
30 minutes, and recovery messages. Tokens, project names, source and user details
are excluded. Delivery failures retry at the next observation; the state file is
private. Monitor process uptime and receiving service must be operated separately.
Application campaigns and backup/restore failures now appear in operations alerts.

A GitHub code-scanning query on 2026-10-08 returned HTTP 403 (scanning not enabled
for this repository). Local regression checks do not confirm that the external
SAST findings have been closed. Re-run the scanner that originally reported them;
GitHub Actions is not used for this work. Production failover remains an explicit
operator recovery operation; isolated restore verification does not switch traffic.
