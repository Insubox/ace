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
does not assert that its proposal qualified. `costs` remains null because live
provider billing is not collected by ACE. The separate `spending_control` field
reports the operator-verified billing observation, conservative reservations and
paid execution availability. See [spending protection](spending-control.md) for
the USD 175 cutoff, observation freshness and account invoice limitations.

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

## Checked Worker rollout

Upload tested code with `wrangler versions upload --config <private-config>`.
Uploading a version does not move production traffic. Keep the existing pinned
container image and bindings; this procedure does not migrate storage or images.

With `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ACE_API_URL` and
`ACE_API_TOKEN` configured privately, deploy the uploaded version:

```sh
node cloud/scripts/rollout.mjs --plan /private/approved-release.json --worker ace-control-plane \
  --before <current-version-uuid> --candidate <uploaded-version-uuid> \
  --output /private/ace-rollout.json --drill
```

The command checks the expected stable deployment, assigns 10%, 50% and 100%
traffic, verifies provider deployment state, and runs Observatory/CSP and
operator-authenticated operations smoke checks after each step. Version override
headers request the version under test, and the actual provider version in the
response must match. Prepare the private approved release plan with
`cloud/scripts/release-plan.mjs`; its requirements are described in
[`stability-acceptance.md`](stability-acceptance.md). Both versions need the
`WORKER_VERSION` metadata binding. The plan is revalidated before candidate
traffic changes. `--drill` restores the stable version
after the 50% step, checks it, then completes the candidate rollout. A failed check
restores the stable version when the deployment still belongs to this operation.
A competing deployment stops the operation; it must be reconciled before retry.
Provider deployment writes do not expose an atomic compare-and-swap, so this
check reduces conflicts but is not a distributed deployment lock. Smoke checks
are short observations, not uptime or sustained-load evidence. Worker rollback
does not undo data writes, database migrations or container images.

For a bounded live native concurrency check, run
`node scripts/check-live-concurrency.mjs --run --output /private/ace-race.json`.
It retains a dedicated diagnostic project, races twenty journal proposals and
twenty global reference proposals, and requires one accepted change plus nineteen
conflicts per race. It uses one operator identity and no paid evaluator or model;
it does not establish multi-user behavior or production throughput.

Monitor parsing now rejects malformed alerts instead of silently displaying a
healthy observation. Only documented numeric budget fields and the UTC budget
day can enter an external notification. Receiving-service delivery still needs an
explicit HTTPS webhook and a separately operated monitor.

### Observed on 2026-10-08

Worker rollout exercised real 10%, 50% and 100% traffic assignments and a return
to the previous version, with successful Observatory and authenticated operations
checks. This was a Worker rollback drill, not a production data failover or an
injected service outage.

The live concurrency probe retained exactly one journal update and one reference
update. All nineteen losing reference requests returned 409. Some losing journal
requests unexpectedly returned 401 instead of 409; repeated identical journal
requests also intermittently returned 401, while concurrent operations reads and
project requests succeeded. The journal concurrency check remains failed until
the authentication/transport discrepancy is diagnosed. No authentication checks
were weakened and no automatic retry of an authorization failure was added.

A subsequent probe with two actual account sessions accepted all 40 concurrent
reads, one of 20 journal publications, all 20 identical retries, and denied
reader writes with HTTP 403. The journal and source hashes matched. This
establishes bounded account-session consistency; the earlier intermittent
environment-injected operator credential discrepancy was not independently
identified and remains recorded separately.

The original gradual-deployment smoke requests did not verify served-version
metadata. The current rollout command rejects absent or mismatched metadata;
earlier provider traffic assignments remain evidence of those assignments only.
