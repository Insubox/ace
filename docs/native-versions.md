# ACE's native version engine

ACE now has its own content-addressed version engine. It stores source snapshots,
version parents and an ordered hash journal without invoking Git. Qualified
source, unsuccessful evaluated candidates, immutable Evidence, Knowledge and
generator faults remain first-class ACE records. Git is an optional export.

This follows the user's clarified target of ACE as both the primary platform and
the version engine. It supersedes the original specification's non-goal of
replacing Git storage; [the scope decision](product-target.md) distinguishes the
implemented engine and private hosting from the remaining collaboration work.

## Save an evaluated version

With a downloaded executable:

```sh
ace demo first
ace store save first/run --store ace-history
ace store log ace-history
ace memory ace-history --baseline-run first/run
```

The saved native version contains exact source/WASM, every evaluated outcome,
evidence, policy decisions and retained learning. No Git, Node, account or server
is required. A generation fault has its own version kind and never becomes an
incorrect-code observation. Saving the same evaluation or fault is idempotent,
even after newer versions have been retained.

## Version your own source files

Create `files.json` listing exactly which regular files to retain:

```json
["Cargo.toml", "src/main.rs"]
```

Then:

```sh
ace store commit my-project --store my-history --files files.json --message "First source version"
ace store log my-history
```

Paths in `files.json` are relative to `my-project`. ACE preserves exact bytes,
including binary content and line endings, and shares identical objects between
versions. It captures only explicitly listed files. It does not recursively
collect credentials, ignored directories or unlisted project files.

The command returns a 64-character ACE version ID. By default the previous native
version becomes its parent. Use `--parent <existing-version-id>` to create a new
lineage from an earlier version. Two explicit parents can record a manually
combined source snapshot; automatic merge/conflict resolution is not implemented.
Capturing source never marks it correct or runs it. Qualified outcomes require
the independent evaluation workflow.

## Restore or copy

Copy the actual returned version ID into this command:

```sh
ace store checkout VERSION_ID --store my-history --output restored-project
ace store clone my-history copied-history
ace store log copied-history
```

Choose a fresh output folder. ACE verifies the content objects, versions and
journal before restoration. Checkout preserves file bytes, rather than executable
permission bits or symlinks. Clone preserves version IDs, ancestry and journal
hashes; it copies the referenced content objects and omits disposable views.

## Native agent campaigns

```sh
ace agent-start campaign --campaign my-agent --baseline-run first/run --store ace-history --rounds 4 --candidates 2 --attempts 3 --patience 2 --jobs 2
ace agent-next campaign
```

See [agent campaigns](agent-campaigns.md) for submissions and stopping rules.
The optional model bridge also uses native history by default. Legacy campaigns
with `--repository` remain inspectable through the Git compatibility backend.
Memory's historical `commit` field holds the native ACE version ID for native
stores; it is not a Git commit.

## Optional Git compatibility

```sh
ace store export-git ace-history --repository compatibility-copy
ace archive-status compatibility-copy
```

This requires installed Git and a fresh dedicated destination. The adapter
currently exports evaluated-version and generator-fault history. It rejects
stores containing arbitrary source versions before writing an export, so those
versions are never silently omitted. The native history remains unchanged. Git
hosting, account credentials and remote pushes are not part of the native engine.

## Storage and limits

`objects/<sha256>` contains immutable raw bytes. `versions/<version-id>.json`
contains a sealed file tree, version kind, message and parents. Ordered
`journal/<sequence>.json` entries link versions through a separate hash chain.
The version ID uses ACE's domain-separated canonical JSON hash; raw content uses
SHA-256. Evaluation views under `views/` are verified materializations for the
runner, not the source of native version identity.

The current preview supports 1,024 versions per store, 4,096 explicit files per
version, 8 MiB per file and 128 MiB total per version. Paths must be portable and
relative; aliases on case-insensitive filesystems, traversal, reserved Windows
names, individual-file symlinks and paths escaping their source/store roots are rejected. This is a bounded local engine,
not a claim of unrestricted production-scale repository hosting.

Writers use an exclusive store lock. Publishing the journal entry makes a
version visible; loose content objects or a sealed version left by interruption
are reusable. An abrupt termination can leave a lock, and an incomplete checkout
or cached view needs operator inspection. Automatic repair of every partial
filesystem state is not implemented.

Hashes detect changed objects, manifests and ancestry; they are not signatures
or authorization. Someone with write access to the whole store can remove or
replace history. [Hosted accounts and remote synchronization](native-hosting.md) now protect a
private projects through explicit membership and role ceilings. See [native collaboration](native-collaboration.md) for branch heads, bounded
diffs/merges and divergent DAG synchronization. Signed checkpoints, full hosted merge
execution and review workflows remain platform work.
