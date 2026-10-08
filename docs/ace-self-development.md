# ACE developing ACE

The project's seven remaining objectives are now defined in
[`self-host/objectives.json`](../self-host/objectives.json), with explicit acceptance
criteria. They cover complete applications, demonstrated agent improvements,
useful learning, developer packages, production promotion, security/operations
and editor integration. A private `ace-self-development` project can retain those
objectives as Observatory tasks linked to exact native source.

The first task is deliberately measurable: match local native history capacity to
hosting, accept 1,024 versions and 4,096 branch events, reject the next append,
and clone/restore the full valid history without breaking existing checks.

## Local complete-project pilot

This is a new Linux local evaluator for the ACE Rust/TypeScript repository. It is
separate from the three hosted application profiles. It does not establish
support for arbitrary builds or hosted full-repository campaigns.

Prepare Rust 1.99, Node 24 and the repository's locked dependencies normally,
with TLS/checksum verification. Cargo's registry cache must contain the locked
crates; `npm ci` must have completed. Prepare the evaluator image from the
repository root:

```sh
cargo build --locked -p ace-cli
npm ci --no-audit --no-fund
docker build -f self-host/Dockerfile -t ace-project-evaluator:local .
node scripts/ace-project.mjs init . ../ace-self-history --ace target/debug/ace
node scripts/ace-project.mjs test ../ace-self-history/baseline ../ace-self-history \
  --ace target/debug/ace --rust /absolute/rust-toolchain-directory \
  --node /absolute/node-runtime-directory --registry /absolute/cargo-registry \
  --dependencies /absolute/ace/node_modules --agent baseline
```

The Rust directory contains `bin/rustc` and `bin/cargo`; the Node directory
contains `bin/node`. On rustup installations, obtain the toolchain directory from
`rustc --print sysroot`. Pass the Cargo **registry directory**, not all of
`CARGO_HOME`: credentials and configuration must not enter the container.

`init` discovers explicitly tracked files with Git solely as an input list.
`--files explicit-path-list.json` supplies that list without Git. Source is
captured and restored using ACE's own native engine; Git does not store its
experiment history. Private settings, build output and dependency trees are
excluded. Descriptor-rooted Linux reads reject symlinks and special files.

`test` checks the complete explicit tree and accepts edits only to the first
task's declared `crates/ace-cli/src/store.rs`. Integration tests, inline tests,
manifests, locks, objectives and the harness remain protected. A different task
requires an explicitly reviewed, newly captured profile. Additional files outside
the list are neither mounted nor evaluated. They do not become part of a proposal.

The container has no network, host credentials, Docker socket or writable host
mounts. Baseline source, candidate file, prepared tools and dependencies are
read-only. Separate temporary storage holds compiler outputs and scratch data;
it is destroyed after the attempt. Limits are two CPUs, 8 GiB memory, 256 PIDs,
6 GiB build scratch, bounded command output and at most 20 minutes per attempt.
No cloud candidate containers, inference calls or GitHub Actions are launched.

The host runs fixed Rust build/workspace tests, TypeScript checks, Worker tests,
client tests, the independent native-capacity contract and schema comparison.
Candidate code can execute during compilation/tests, so isolation is required.
The report retains check exit statuses, durations, log hashes, the image identity,
prepared executable/lock hashes, source identity and declared agent provenance.
This is local evidence from the trusted operator; it is not a hosted independent
verification receipt or proof of all possible behavior.

Evaluate a proposal from another directory with the same command and its source
path as the first argument. Every attempt retains original code, its report,
logs and positive/negative learning as native versions. Infrastructure failures
remain distinct from completed check failures. Existing versions are immutable.
Passing the suite leaves promotion subject to review.

## Observatory objectives

Publish the native store with the existing authenticated store-sync client, then
register objectives against a published source version:

```sh
node cloud/scripts/store-sync.mjs push ../ace-self-history/native \
  ace-self-development --ace target/debug/ace
node cloud/scripts/project-objectives.mjs --project ace-self-development \
  --version <published-native-source-hash> --owner <existing-project-owner>
```

Use the existing private client configuration; do not put tokens in commands.
The script grants only the explicitly named existing account, uses stable task
identities, and preserves existing tasks on retries. Seven objective tasks and
the first concrete task are registered. A passing capacity pilot does not close
all seven objectives. The project owner can inspect the complete source, failed
and passing evidence, and review the proposed native branch in Observatory.

## Recorded first improvement

A matched pair of fresh offline containers used the same image, prepared inputs
and protected harness. The baseline passed the existing 127 Rust, 112 Worker and
23 client tests plus TypeScript and schema checks, but failed all three new
native-capacity checks. A Codex-authored proposal changed only the permitted
source file, passed all three target checks, and preserved the existing checks.
The agent identity is declared provenance, not a provider-signed receipt.

The retained baseline result is
`a31028b242807a181c96cedb9b852f1a5dbeff5435c406362846083919092f60`;
the passing result is
`f7b214a6c166c39f4aff70838c0e2017c08facbfac165618beb7363e42639f38`.
Both reports and their compiler/test logs are in native history. Earlier pilot
runs used an invalid Worker-test invocation; those completed failures remain
retained and are not counted as approved improvements. The comparison above
uses the corrected, identical harness for both attempts.

Publishing ACE's repository also exposed sequential object-metadata checks and
a 128-file browser merge limit. Hosting now checks shared object metadata once
with at most eight concurrent reads and supports 4,096 merge paths while keeping
the 128-conflict resolution limit. Regression checks cover a 377-file publication,
shared bytes exceeding the total budget, missing objects, and an independently
reviewed 377-file merge. Those hosting fixes are separate from the frozen capacity
proposal; final Worker validation passed 114 tests. The local controller's three
checks cover symlinks/special files, private-file exclusions and protected suite,
lock and inline-test boundaries.

A final offline integration run also passed all seven controls against the
combined repository: 127 Rust tests, 114 Worker tests, 23 client tests, three
capacity checks, TypeScript and schema comparison. Its retained result is
`a28e87ede32b0a0d5f614cdfe45d1f21369bd45f4659238e8784d0f5139915eb`.
An authenticated download of the first published history was verified with the
native Rust CLI. A Chromium check of deployed Observatory opened the eight tasks,
their linked 379-file source, the one-file capacity comparison and its passing
report. It also checked mobile layout and that logout cleared private views;
account transport was an isolated fixture and production requests were reads.

The independent reviewer can select `ace-self-development`, open **Reviews**,
and inspect **ACE develops ACE: match native history capacity**. Approval applies
only to the frozen source/target pair; the request author cannot approve their
own changes. The seven objective tasks retain their separate acceptance criteria.

The proposal branch can be reviewed by the project owner. Source-only merging
still requires a fresh evaluation before any production promotion. The seven
larger objectives remain open; this first capacity correction and local evaluator
do not complete general hosted builds, novel multi-model campaigns, public
packages, production rollout, external security scanning or an IDE extension.
