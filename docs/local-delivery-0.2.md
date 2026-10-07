# ACE 0.2.0 local delivery — 2026-10-07

Source commit: `8fcdabb1b9d49823337f4ba73a746fbe1bce2c7e`.
This delivery adds agent-authored WAT proposals, source snapshots tied to evaluated
WASM, and a dedicated Git history of winning code and learning from all evaluated
candidates. CLI and twelve MCP tools expose the flow. Direct provider API adapters,
additional Cells, IDE UI and production promotion remain unfinished.

## Verified behavior

All 89 Rust tests passed, together with Clippy with warnings denied, formatting,
37 schema checks and portable WASM library builds. New integration checks cover
agent-authored proposals, successful and incorrect candidates, resource exhaustion,
forbidden imports, malformed and duplicate input rejection, caller-declared
provenance, inherited Champion re-evaluation and source preservation. Git tests
exercise multiple generation commits, repeat saves, clone verification, paths
with spaces, line-ending preservation even with `core.autocrlf=true`, rejection
of application repositories or pending changes, and rejection of an altered
winner even after the altered file is committed.

The static Linux x86-64 package was extracted into a fresh temporary directory.
Demo, generation, evaluation, replay, evolution and proposal/MCP checks ran with
an empty PATH and no provider credentials. Separate archive checks enabled Git
on PATH, still without provider credentials.

The package check verified:

- The usual demo's 13 programs: ten qualified, one incorrect, two resource failures.
- Sealed evidence validation and matching Champion replay.
- Three generations and a verified Champion/Knowledge history.
- Twelve discovered MCP tools, real proposal evaluation and Knowledge retrieval.
- Three Git snapshots containing winner sources, all learning and complete evidence.
- Identical verified snapshots after cloning the Git repository.
- MCP archival of an agent-authored proposal experiment.

The actual package result is committed as
[`validation/local-v0.2.0.json`](validation/local-v0.2.0.json).
Package SHA-256:
`987614b57a78dce0122068b4f09654962fe6abdf5b2eae1fb6fbd5ceb8436b5d`.
The locally tested archive is
`/workspace/.ace-env/releases/agent-git-v0.2.0/ace-0.2.0-x86_64-unknown-linux-musl.tar.gz`.
Release builds from other commits can have different package hashes; use each
download's accompanying checksum.

## A retained proposal and Git example

A separate real experiment retained under
`/workspace/.ace-env/validation/agent-git-v0.2.0/` evaluated a reference and four
manual WAT fixtures. Recursive Euclid became Champion; addition failed
correctness, a loop exhausted fuel, and a host import failed the contract.
The generator names are fixture metadata, not authenticated provider calls.

Its dedicated Git repository is `history/`, commit
`8468f473f168a7c4b9676e4630fe84a00dc09c39`.
The snapshot report hash is
`cc32e2d869d47a2e18c613f090d4cec30627cfa5215d7ef60fd092b7741192a6`.
It preserves 44 files, including the winning WAT/WASM, all candidate outcomes,
Knowledge with positive and negative evidence, original proposal receipts and
complete frozen source/evaluation records. These files are local validation
artifacts; generated binaries and experiment repositories are not included in
the ACE source repository.

## Distribution limits

The release workflow now checks proposal evaluation and Git archival for every
native target. Linux was exercised locally. GitHub Actions results, release
asset publication, macOS and Windows execution have not been independently
verified in this cloud task. The `v0.2.0` release workflow publishes packages
only after all platform jobs pass. GitHub access remains subject to repository
visibility and permissions. Git archival commits locally and does not configure
or push a remote.

Follow [the getting-started guide](getting-started.md) and
[agent proposals and Git history](agents-and-git.md) for the complete commands.
The [0.1.0 delivery record](local-delivery.md) remains a historical record.
