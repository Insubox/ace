# Private backups and restoration drills

ACE snapshots immutable source, winner/loser evidence, knowledge, model records,
server receipts, authoritative native journals, branch references and publications, completed experiment
state and D1 account/project/audit metadata. Salted password hashes remain private
backup data. Session tokens, recovery tickets and setup links are excluded; a
recovered deployment requires everyone to sign in again.

The deployed daily cron runs at 08:00 UTC. Every successful snapshot automatically
restores into a separate R2 bucket, separate D1 database with per-snapshot tables,
and a separate Durable Object namespace. It checks every copied byte hash,
relational row, native canonical version/ancestry, publication metadata and
experiment state. Interrupted experiments stop with an infrastructure-recovery
status; recovery never invents correctness or resumes paid workloads.

Production references remain untouched during drills. Receipt field
`production_writes: 0` describes source/account/project replacement; live backup
status records are still updated by the control plane. A sealed backup is published
only after all objects have been copied; a separate restoration receipt is published
only after the isolated reconstruction passes. Immutable retries cannot replace
bytes. The original Worker config admitted 10,000 subrequests. The deployed
operator configuration now permits 100,000 for the approved code after a
2,784-object restoration exhausted the earlier limit. Durable sleeps do not
prove that the provider request budget has reset. Each Workflow step has bounded chunks, and snapshots stop rather than
silently truncate when limits are exceeded.

## Deployment bindings

Create private resources and configure these bindings before deploying:

- `BACKUPS`: a separate private R2 bucket, e.g. `ace-backups`.
- `RESTORE_STORAGE`: a private R2 bucket, e.g. `ace-restore-drill`.
- `RESTORE_DB`: a separate D1 database, e.g. `ace-restore-drill`.
- `RESTORE_COORDINATORS`: the `RestoreCoordinator` DO class, separate from live coordinators.
- `BACKUP_WORKFLOW`: the `BackupWorkflow` class, named `ace-backups`.

A preflight rejects aliased live/restore databases, buckets or coordinator namespaces.
Apply `0008_backups.sql` to live metadata. The drill database creates isolated
copies of the original table schemas; it needs no application migration. The
example config contains distinct placeholder D1 IDs; replace them with your own resources.

Only the infrastructure operator can list/request global backups or read drills.
Account administrators cannot download other projects or credential metadata.
Maximum four new snapshots/day, 100 projects, 100 experiment authorities,
10,000 rows/table, 10,000 objects, 8 MiB/object and 1 GiB total. Serialized inventory
is limited to 8 MiB and the manifest to 2 MiB; Workflow checkpoints retain small
verified references rather than copying full private inventories into step outputs. Source-store limits continue to apply.
These explicit preview limits need larger partitioning for bigger installations.

## Demonstrate a real recovery

From a source checkout with securely configured operator credentials:

```sh
node scripts/check-backups.mjs --request --ace /absolute/path/to/current/ace --output /fresh/private/recovery-check
```

This creates one snapshot and waits for its isolated drill. It downloads a restored
native history into a fresh folder, asks the real Rust engine to verify every
version, and independently re-evaluates a retained workload from restored source.
`--id backup-...` verifies an existing completed drill without requesting a new
snapshot. `--store` chooses a retained native history. No active sessions or account
metadata are exported by this checker. Keep restored private source outside Git.

REST endpoints are `/v1/backups`, `/v1/backups/:id/restore` and
`/v1/backups/:id/restore/stores/:name` with native object/version subpaths.
There is deliberately no endpoint that overwrites production from a backup.

## Recovery scope and retention

If the backup row says `running` while progress has stopped, inspect the actual
Cloudflare Workflow state. An exhausted request budget can also prevent the
Workflow from recording its final failure in D1. Never treat that stale row as
proof that recovery is progressing.

For an errored object-copy step caused specifically by the provider's subrequest
limit, inspect and then resume the failed chunk:

```sh
node cloud/scripts/retry-restore.mjs --id backup-...
node cloud/scripts/retry-restore.mjs --id backup-... --run
```

This operator tool uses Cloudflare's documented `restart` API with `from`.
Completed steps retain their cached results; the failed chunk and later steps
run again. It requires a sealed matching backup and an errored restore Workflow,
rejects unrelated errors such as corrupted hashes, and never writes live
source. It is a recovery operation, not an automatic failover or a guarantee
that the maximum supported inventory fits every provider resource limit.

D1 metadata is read in one transaction; each native store pins its authoritative
journal separately. Capture records its interval and checks immutable referenced
objects. This is not a globally atomic timestamp across D1, DOs and R2. Unreferenced
immutable objects may be retained; active sessions and inference reservations are
not copied. Restored drill D1 rows are the original snapshot; DO execution state
marks unfinished work interrupted for any subsequent cutover procedure.

Backups and drills are retained until explicitly removed by the infrastructure
operator; automatic deletion is not enabled. Track storage growth and remove only
snapshots whose replacement has been verified. The resources are separate but in
the same Cloudflare account: provider/account loss still needs an independently
stored encrypted off-provider copy. Full provider cutover, DNS/secrets/bindings and
an off-provider destination are operator tasks; an isolated drill does not establish
that a replacement public deployment has been brought online.

## Live validation — 2026-10-07

Snapshot `backup-5a92a95c-c7be-4894-a008-f7ec7996a7d8` retained 1,435 objects
(5,519,362 bytes). Its isolated restoration reproduced twelve metadata tables,
five experiment authorities, 149 evaluation/evidence rows and six native versions.
The real Rust engine verified the recovered native history and independently
reproduced a retained experiment from restored source. No sessions were restored
and no live source was overwritten. The snapshot predates named branch creation;
branch restoration is covered by Worker tests and included in subsequent captures.

The scheduler now starts the restoration drill as a separate Workflow after
sealing the backup. Copy and restoration have independent invocation budgets;
30-second durable pauses between groups of 100 objects allow hibernation.
This replaces the earlier combined workflow, which exhausted the API request
limit on the second full-size drill. Existing sealed snapshots can be restored
without creating another backup. Observatory trial metadata and exact proposal
objects are also retained; active sessions and recovery links remain excluded.

The complete automatic copy → seal → independent restore chain subsequently
passed for `backup-8b817561-a15b-4bce-998d-9792e3becb98`: 1,657 objects,
5,920,203 bytes, thirteen metadata tables, nine experiment authorities, three
native stores and the retained branch journal. The isolated Observatory store
downloaded with all four evaluated versions and 92 verified native objects.
Independent replay from that recovered history reproduced the observations.
Production source overwrites and restored/exported sessions were both zero.

## Updated recovery validation — 2026-10-08

Snapshot `backup-4acb9159-5c3f-4c8d-ad42-4637dfa11225` retained 2,784 objects
and 14,410,126 bytes. Its first restore Workflow exhausted the 10,000-subrequest
budget at object chunk 2480 and could not update the stale D1 `running` row.
The operator resumed that failed chunk using the documented provider API.
The restore then sealed successfully: 17 metadata tables, 14 native stores,
20 branches, nine experiment authorities, zero restored sessions and zero live
source replacements. The approved application code is unchanged; its operator
deployment now has a verified 100,000-subrequest configuration.

The read-only recovery selector served the approved main version
`a7634ae9cfea52e1610bbd912d0fa889f56740d21ab8037a34bb086582184b2d`.
Source bytes matched their identity, mutations returned HTTP 405 and removing
the selector returned traffic to the unchanged live references. The real ACE
engine verified all 65 versions and 646 objects of the restored self-development
history, including 54 source-linked evidence documents and nine passing/failing
project reports. That history contains source versions, so executable replay
was checked separately: `native-platform-v030` restored six versions and 143
objects, and a retained evaluation reproduced independently from restored code.

One bulk download stopped on HTTP 401; subsequent successful authenticated
control checks and a new pinned-version session completed verification using
hash-checked cached bytes. The separate authentication diagnosis remains open.
This is a successful controlled read-only recovery drill with operator
intervention, not evidence of automatic write failover or provider-wide outage
recovery.
