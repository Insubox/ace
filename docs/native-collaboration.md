# Native branches, differences and merges

ACE stores immutable source/version DAG nodes independently from publication order.
A version ID identifies its files, kind, message and parents. Importing the same
node into a different journal preserves its ID. Branch heads use a separate
append-only reference log with explicit compare-and-swap expectations and
fast-forward ancestry checks. There is no Git subprocess behind these operations.

## Local workflow

Start with `ace store commit` and its explicit JSON file list. Capture the returned
version ID, then name its branch:

```sh
ace store branch my-history main VERSION
ace store refs my-history
```

For a change on that branch, explicitly pass its current head as the parent:

```sh
ace store commit working-files --store my-history --files files.json --message "Change the implementation" --parent PREVIOUS
ace store branch my-history main NEW_VERSION --expect PREVIOUS
ace store diff PREVIOUS NEW_VERSION --store my-history
```

Replace uppercase IDs with the printed native hashes. A stale expectation or rewind
fails; old source and reference events remain retained. `ace store clone` copies
verified versions and references into a fresh native store.

`ace store fetch other-history my-history` imports missing verified DAG nodes in
ancestor order. It preserves both histories' version IDs and creates local journal
entries as needed. Existing local branch heads stay unchanged; the response exposes
incoming heads. An empty reference log can inherit the incoming verified log.

```sh
ace store merge OUR_VERSION THEIR_VERSION --store my-history --output fresh-merge --message "Combine both changes"
```

A clean merge writes exact files under `fresh-merge/merged`, publishes a source
version with both parents and writes `merge.json`. It does not qualify the merged
code; run evaluation again. An ambiguous common ancestor requires an explicit
`--base`. There is no arbitrary selection between competing merge bases.

Disjoint text edits can merge automatically. Conflicting edits, delete/edit changes,
binary changes and oversized text changes retain exact base/ours/theirs bytes under
`conflicts/NNNN`. Structural/path collisions also retain complete input trees under
`inputs`. A conflicted merge publishes no version. Resolve the preserved files,
commit the explicit resolved file list with both `--parent` hashes, then advance
its branch using `--expect`. The original working files are never overwritten.

Text previews/merges cover UTF-8 files up to 64 KiB and 256 lines; byte hashes and
full downloads cover larger/binary files. Diff previews cover at most 20 changed
files. Source-tree and 1,024-version limits continue to apply. Reference logs allow
4,096 events and branch names use 1–64 portable letters/digits/hyphens/underscores.
Branch deletion, forced rewinds, automatic rename detection and reference-log
compaction are not implemented.

## Hosted collaboration

The Observatory's **Versions** view lists named heads, opens their source and lets
project writers create/advance a branch to a published version. The server checks
the captured head, the reference seal, publication and ancestry atomically at the
reference publication boundary. A concurrent update fails instead of replacing a
newer head. Project read/write permissions and audit cover references too.

Use the current source checkout and current ACE executable for these Node clients:

```sh
node cloud/scripts/store-sync.mjs push my-history my-project --ace /absolute/path/to/ace --session /private/ace-session.json
node cloud/scripts/store-sync.mjs fetch my-history my-project --ace /absolute/path/to/ace --session /private/ace-session.json
```

When the remote contains missing nodes, fetch and merge before pushing. Independent
publication orders are reconciled by immutable version identity. Branch updates
are replayed against the captured remote heads with a new remote reference seal;
matching heads remain idempotent.

If both branches diverged and a merge combines them, first publish its DAG without
changing any remote branch, then explicitly advance the captured remote head:

```sh
node cloud/scripts/store-sync.mjs push my-history my-project --versions-only --ace /absolute/path/to/ace --session /private/ace-session.json
node cloud/scripts/store-sync.mjs advance my-project main MERGED_VERSION --expect REMOTE_HEAD --session /private/ace-session.json
```

This protects edits made while fetching or merging. Publication may retain uploaded
versions before a reference conflict; retrying repairs the publication without
replacing immutable nodes. There is no force push. Full hosted diff/merge execution,
reviews and issue workflows are further interface work; the native CLI performs
verified diffs and merges today.

## Validation

`node scripts/check-store-sync.mjs /absolute/path/to/ace` uses a fixture transport
and the real Rust engine to prove branching, exact restoration, corruption/stale
update rejection and divergent DAG reconciliation without network or Git.

The optional live check publishes a small source-only demonstration:

```sh
node scripts/check-native-collaboration.mjs --request --name native-branches-v04 --ace /absolute/path/to/ace --output /fresh/private/native-collaboration
```

It makes two local stores diverge, imports the hosted changes, merges disjoint edits,
publishes both ancestry paths and rejects a stale hosted head. No fake accounts or
paid model calls are created. Existing projects and evaluation records are untouched.
Global private backups retain native reference histories as well as source nodes.

## Live validation — 2026-10-07

The source-only `native-branches-v04` history contains four canonical versions.
Two independently modified stores were fetched and merged; hosted publication
retained both ancestry paths and advanced `main` to
`e6c5007f18dfd852bec23c6dc270234133381df359de9c2d885a2d13a5d9372c`.
A stale hosted expectation was rejected, matching-head retries were idempotent,
and a fresh pull passed Rust's complete native verification. No model calls or
production accounts were created. The deployed Observatory branch form also passed
Chromium desktop/mobile checks using isolated account mutations and real read-only
source/evidence data. Local MCP now exposes thirty tools, including native branch,
diff, merge and fetch operations within the selected workspace.

Interrupted native downloads retain a credential-free `.ace-pull.json` checkpoint
in the destination. After restoring authentication or connectivity, explicitly
resume the same pull with the same origin, project and remote store:

```sh
node cloud/scripts/store-sync.mjs pull ./incoming REMOTE --resume --session PRIVATE_SESSION_FILE --ace /absolute/path/to/ace
```

HTTP 401 and 403 stop immediately; the client never retries authentication.
Resume pins the original journal and branch references, rejects changed snapshots,
checks cached canonical versions and object hashes, and includes reused objects in
the 512 MiB limit. It refuses symlinks, foreign files and corrupt existing files
rather than overwriting them. Successful Rust verification removes the checkpoint.
If the remote history advanced or local files were corrupted, choose a fresh
destination. Keep the destination private and avoid concurrent local writers;
a partial checkpoint or partially written file requires a fresh destination.
