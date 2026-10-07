# Local ACE delivery — 2026-10-07

The native CLI now runs a complete local GCD evolution loop: candidate
generation, bounded parallel evaluation, deterministic qualification, Champion
inheritance, linked Knowledge and stop rules. The executable also exposes eight
MCP stdio tools for development agents. External coding-agent API adapters,
additional Cells, Vectorize retrieval, the IDE extension and production promotion
remain unfinished. This delivery is a local technical preview, rather than a
claim that the complete architecture has been implemented.

## Verified experience

Source commit: `140854566fd07b1fd150474eb02cb7d8080bd533`.
The Linux x86-64 executable was built for `x86_64-unknown-linux-musl` and verified
as a statically linked executable. Its 3 MB compressed package includes the CLI,
the getting-started guide and build metadata, with an external SHA-256 checksum.
The package was extracted into a fresh temporary directory. Child processes ran
with an empty PATH and no provider credentials, so no candidate compiler,
Cloudflare account or external development tool supplied the demo behavior.

The downloaded-package check passed:

- 13 programs evaluated: ten qualified, one correctness failure and two resource failures.
- Sealed run validation and Champion replay matched.
- Three successive generations executed and their complete history verified.
- MCP initialization, discovery of eight tools, population generation, real
  evaluation and Knowledge retrieval worked through the packaged executable.

The full default four-generation campaign, tested separately, produced mean
fuel values of 44.25, 37.75, 37.75 and 37.75. It stopped after two generations
without improvement. Each baseline's hash matched the preceding qualified
Champion, and each derived Knowledge node referenced its predecessor. The
initial bounded divisor-scan baseline used 1,193.333333 mean fuel. These figures
describe this configured GCD workload, not general CPU speed or AI filtering ROI.

The package SHA-256 is recorded in
`/workspace/.ace-env/releases/local-v0.1.0-final-validation.json`, together with
the executable's source commit and the actual verification results. The package
is at
`/workspace/.ace-env/releases/local-v0.1.0-final/ace-0.1.0-x86_64-unknown-linux-musl.tar.gz`.
No package binaries or private credentials were committed to the source repository.

## Developer and agent interfaces

[`demo`, `generate`, `run`, `evolve`, `history`, and MCP configuration](getting-started.md)
are documented with instructions for downloads and source builds. Populations
contain 4–100 candidates, including three explicit diagnostic controls, plus a
baseline. The local grammar explores 98 correct algorithm/parameter choices;
it does not pretend to be a model provider. Inputs reproduce from seed and
configuration; duplicate WASM hashes are rejected. All 64 seed bits survive
JSON/MCP transport through decimal strings. No generated native source or shell
command is executed.

The local MCP server requires an operator-selected workspace. It rejects invalid
local names, existing output destinations and paths escaping the workspace,
including pre-existing symlinks. Read tools validate sealed records before
returning measurements. The test harness exercised this stdio interface directly;
it does not establish that a particular external agent application has been
installed or configured. Clients can prepare other precompiled GCD WASM
populations and use the same evaluation contract.

## Tests and distribution

Passed: 83 Rust tests, 18 Worker tests and eight Node integrity tests, plus
Clippy, formatting, TypeScript, portable WASM builds and all 33 schema checks.
The new integration tests cover tool-free demos, 100-candidate populations,
deterministic generation, correctness/resource controls, replay, generation
lineage, stopping, corrupted source/evidence rejection, MCP tool calls,
workspace confinement and integer precision. Source-build checks also used a
fresh checkout, and the installed CLI's demo passed.

The release workflow builds and tests native packages for Linux x86-64, macOS
Apple silicon, macOS Intel and Windows x86-64. It tests the executable, extracts
the resulting package, repeats the tool-free experience and uploads archives
and checksums. A matching `v<version>` tag publishes a technical preview only
after every platform job passes. Local validation covers Linux. Remote Actions
results and macOS/Windows execution have not been independently verified in this
cloud task. Downloads remain subject to the repository's GitHub access settings.
