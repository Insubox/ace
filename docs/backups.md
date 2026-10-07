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
bytes. The Worker config admits 10,000 subrequests; workflows explicitly yield after
every 100 objects to release request budgets. Each Workflow step has bounded chunks, and snapshots stop rather than
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
