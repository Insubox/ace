# ACE 0.3.0 development validation

This milestone delivers ACE's own bounded version engine, private native hosting,
workspace accounts, agent campaigns with verified memory, a Workers AI generator
bridge and an interactive offline inspector. Git is an optional compatibility
backend/export. This follows the user's clarified target of ACE as both platform
and version engine; automated evaluation remains limited to the GCD Cell.

## Verified locally

- 105 Rust tests passed, covering native exact-byte snapshots, ancestry/journal,
  checkout/clone, campaign limits, memory filtering, baseline retesting, source
  retention, generator faults, interrupted receipt recovery, workspace containment
  and CLI/MCP export.
- Clippy with warnings denied, formatting and 44 generated schemas passed.
  Portable libraries compiled for `wasm32-unknown-unknown`.
- 36 Worker tests and 14 Node transport/integrity/session tests passed.
- The Node bridge completed two actual native evaluation rounds with fixture
  transport and zero paid calls: invalid-WAT recovery, a recursive winner,
  incorrect-code retention, three evaluated native versions, one generator fault
  and completed resume without another request. Fixture results are distinct
  from model results.
- Native sync fixture checks used actual Rust verification with Git absent from
  PATH. Two source versions shared two objects, retained Unicode filenames/line
  endings, restored after pull, reused publication and rejected corruption/divergence.
- Chromium rendered the offline inspector through a local HTTP server. The
  13-program leaderboard, filters, search, source, evidence and policy worked
  with no external requests. The managed browser blocks `file:` URLs; direct
  file opening was not validated here.

## Live native platform

The authenticated deployment at
`https://ace-control-plane.nex-insure.workers.dev` retained `native-platform-v030`:
six versions, 143 distinct objects, three evaluated snapshots, one generator
fault and two arbitrary source versions, including Unicode paths and inert
script-tag text. Real push/pull preserved journal tip
`f92f5e43de438fe863ebfc06f16d5426afde368bb4b90eb9d56f844763f4330b`.

The freshly downloaded 415,572 bytes passed native Rust verification. Retrieved
memory matched the original, including negative learning; checkout restored
exact winning WAT. The restored recursive winner replayed successfully with
its original environment/output/fuel observations (mean Wasmi fuel 23.5).
This winner came from a manual fixture, not a successful model trial.

Chromium loaded deployed HTML and all six live versions through a local read-only
bridge. Source hashes, inert script display, setup-fragment removal, password
confirmation and administrator/reader views passed. Real API credentials stayed
in Node. Browser account mutations used an isolated fixture and created no
production accounts. Workerd tests exercised actual account storage/authorization.
The first real administrator must choose their credentials through a setup link.

## Real provider trials

The Worker invoked Qwen `@cf/qwen/qwen2.5-coder-32b-instruct` and Llama
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, retaining raw task/request/response/
attempt bytes and hashes in R2. Local ACE checked these before accepting WAT.
The current adapter is `wat-generator-v4`. The final deployed Worker version
is `9098b856-ca26-4580-8195-3d9f48abd810` on 2026-10-07.
The static Linux package is checked separately before tagging the release.

Early trials produced one assembled candidate, which failed independent
correctness checks. Others failed WAT parsing (unknown labels/missing parentheses).
Later bounded trials stopped at generation attempt limits. The qualified baseline,
raw submissions and generator faults were retained; generator failure never
became an evaluated incorrect-code conclusion. Earlier trial archives keep their
original Git compatibility format and remain inspectable.

These trials demonstrate live generation, byte integrity, evaluation routing,
fault retention and bounded stopping. They do **not** demonstrate a model-produced
qualified improvement or AI-filtering savings. Compiler diagnostics feed later
attempts as untrusted debugging data; hidden Oracle diagnostics stay private.
Prompt versions preserve earlier generation records.

The cloud evaluator image remains
`sha256:d1b545d60ed75281385048cb1845b62623d6ff974b2b024471c2f3b3d017c1e4`.
Agent trials evaluate through local ACE 0.3.0 and use the Worker for generation.
They do not establish distributed evaluation using a new 0.3.0 image.

## Remaining platform work

Accounts share one workspace. Per-repository permissions, isolated tenants,
account recovery/removal, named branches, automatic merges, review/issues,
additional evaluated Cells, IDE integration, canonical Composition/promotion and
measured 100-container concurrency remain unfinished. Checkout preserves bytes,
rather than executable bits/symlinks. Native/campaign limits are documented;
hashes are not signed authorization proofs.

GitHub Actions, published release assets and native macOS/Windows binaries have
not been inspected or executed here. GitHub distributes ACE's source/packages;
it is not ACE's native product storage engine.
