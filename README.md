# ACE — Agentic Code Evolution

ACE is an agent-first software evolution platform: experiments produce candidates,
evaluation produces immutable evidence, and deterministic policy qualifies elites.
Knowledge survives discarded code. The official project domain is **ace.org.ai**.

The complete-task repair campaigns, measured retrieval comparison and gated
release/recovery procedures are described in
[stable delivery acceptance](docs/stability-acceptance.md). They include
reproducible local checks that do not use GitHub Actions or paid cloud execution.

## Download, run, and test

The local CLI now generates candidates and runs complete GCD experiments without
Cloudflare, accounts, API keys or Docker. Build from source below, or download the
[verified Linux 0.4.0 preview](https://github.com/Insubox/ace/releases/tag/ace-0.4.0-linux-preview-20261008).
The repository is private, so downloads require repository access. The
[delivery record](docs/linux-preview-delivery.md) includes its checksum and checks
run against the actual GitHub download; current Windows/macOS packages remain unverified.
The four-platform package workflow remains available; development currently
validates locally while the GitHub Actions account limit is unresolved.
See the [step-by-step guide](docs/getting-started.md) for Linux, macOS and Windows.

The [complete-project learning guide](docs/complete-project-learning.md) explains
retrieval of exact-source reports from ACE's own development pilot.

From a source checkout with Git and Rust installed:

```sh
git clone https://github.com/Insubox/ace.git
cd ace
cargo run --locked -p ace-cli -- demo
cargo run --locked -p ace-cli -- evolve ace-evolution --generations 4 --store ace-history
cargo test --workspace --locked
```

`demo` creates a candidate population, evaluates it, rejects three diagnostic
controls, verifies the saved evidence and prints the Champion. `evolve` carries
qualified Champions and linked Knowledge across generations, with bounded
stopping rules. `ace history` checks the entire campaign. Generation uses a local
deterministic GCD grammar. An optional Workers AI adapter generates untrusted WAT with Qwen and Llama.
Additional Cells, the IDE extension and production promotion remain unfinished. This is a working
local technical preview of ACE; development continues toward the architecture.
An interactive offline inspector displays verified source, candidate outcomes,
evidence, policy and retained learning: `ace inspect ace-demo/run --output ace-report.html`.
The same executable exposes thirty [local MCP tools](docs/getting-started.md#connect-a-development-agent-through-mcp)
so development agents can generate populations, run experiments and inspect
verified evidence inside an explicitly selected workspace. Agents can submit their own
WAT through `ace_propose`; the declared provider metadata remains caller asserted.
ACE owns a [native version engine](docs/native-versions.md) for source snapshots,
version ancestry, verified winners and learning from all evaluated versions.
[Native branches, diffs and merges](docs/native-collaboration.md) preserve exact
source and explicit conflicts; remote sync reconciles version DAGs by identity.
Git export remains an optional compatibility adapter. See [agent proposals and Git history](docs/agents-and-git.md).
[Bounded agent campaigns](docs/agent-campaigns.md) feed verified winning source and
positive/negative learning into subsequent proposals, retain generator faults,
and expose CLI/MCP control plus an optional paid model bridge.
The [native hosting guide](docs/native-hosting.md) covers account login, private
source browsing and remote push/pull with ACE version identities.
The deployed private preview is at [ACE](https://ace-control-plane.nex-insure.workers.dev/);
its data requires an ACE account. The [Observatory](docs/observatory.md) is the main
interface for native versions, completed trials and learning from winners and losers.
[Browser reviews and application projects](docs/collaboration-and-applications.md)
add source comparisons, line comments, independent approval and native branch merge,
plus assigned tasks, private notifications and conflict resolution requiring new approval.
Hello World, TicTacToe and Calculator have Python console and
[visual JavaScript projects](docs/visual-applications.md), compilation and retained pass/fail tests. Create an example locally with
`ace app init calculator my-calculator`; `ace app test my-calculator --store ace-history`
uses Docker and a prepared local image as described in the guide.
[Application agent campaigns](docs/application-evolution.md) reuse tested source
and retained learning, independently evaluate each new proposal and keep a new
best only when it improves public-suite correctness without regressions.
[Independent server verification](docs/server-verification.md) checks uploaded
evaluations and retains separate server evidence. [Private project permissions](docs/native-hosting.md)
and account recovery protect hosted access. [Automated backups](docs/backups.md)
restore into isolated resources for verification. Local experiments remain account-free.

The [0.4.0 delivery record](docs/local-delivery-0.4.md) distinguishes tested behavior
from the remaining architecture and remote platform checks. The
[2026-10-08 validation record](docs/validation-2026-10-08.md) documents application
evolution, browser collaboration, isolated recovery and the visual examples.
[ACE developing ACE](docs/ace-self-development.md) turns the remaining objectives
into private project tasks and introduces an offline, isolated Rust/TypeScript
repository evaluator with protected tests and retained native results.

This repository implements **Phase 0: the domain kernel** and **Phase 1: a local
WASM experiment runner**, plus the **Phase 2 Cloudflare control plane implementation**
and the **Phase 3 shadow-mode judge foundation** from the
[architecture specification](docs/architecture.md). The first executable
Cell is mathematical GCD. The Cloudflare deployment has completed real experiments
with 5, 10 and 100 known candidates, plus their baselines. Actual 100-container
concurrency remains unverified; external model proposals can now enter bounded local agent campaigns.
See the [live validation record](docs/cloud-validation.md).
Phase 3 also includes a [diverse 24-candidate corpus](examples/judge-corpus/README.md)
with frozen public model inputs and a predeclared eight-candidate holdout.
See its [real cloud results and model comparison](docs/diverse-validation.md).

## Implemented

- `ace-core`: typed identifiers, Cell, Intent/EvalSpec, Hypothesis, Experiment,
  Candidate, Evidence, Knowledge, Champion, Composition, Environment and provenance.
- `ace-policy`: versioned deterministic evaluation gates. Incomplete or erroneous
  evaluation is held for investigation; probabilistic judge scores do not establish
  correctness. Qualified finalists become elites, with promotion left to a future
  privileged workflow.
- `ace-protocol`: strict versioned JSON documents and 17 generated JSON schemas.
- `ace-cli`: project initialization, document validation/hashing, evidence sealing
  and immutable local storage, schema generation, policy evaluation, experiments,
  status, Champion, knowledge, explanations and replay, plus offline generation,
  self-contained demos and successive-generation campaigns. Additional schemas
  describe generation, evolution, proposals, frozen sources and Git snapshots.
  The full schema set totals 45, including the native version engine, verified memory
  and agent campaign documents.
- `ace-runner`: import-free WASM execution with fuel and linear-memory limits,
  an independent host Oracle, real measurements, Pareto elites, conservative local
  Champion selection and frozen artifacts for reproduction. Additional
  schemas describe local plans, saved runs, replay and distributed tasks.
- `ace-eval`: portable FastJudge contracts, conservative L1a/L1b routing, stable
  audit cohorts, evidence-linked calibration and comparisons of bypass, Flash
  and Flash with Clef. Nine schemas describe advisory evaluation. Judge
  advice always continues to real execution.
- `cloud/`: authenticated TypeScript API/MCP Worker, Workflow, evaluation/finalization
  queues, transactional experiment coordinator, D1 indexes, immutable R2 storage
  and a disposable container adapter using the Rust evaluator and policy.

## Develop

Prerequisites: Rust 1.99.0 (pinned in `rust-toolchain.toml`) and a native linker.
The portable libraries also compile to `wasm32-unknown-unknown`. Cloudflare
credentials and running services are not needed for the local workflow.

In the prepared Codex cloud environment, activate the installed tools:

```bash
source /workspace/.ace-env/activate.sh
cd /workspace/ace
```

On another machine, install the pinned toolchain with rustup, then run:

```bash
cargo build --workspace --locked
cargo test --workspace --locked
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo build --locked --target wasm32-unknown-unknown -p ace-core -p ace-policy -p ace-protocol -p ace-eval
cargo run --locked -p ace-cli -- schema --out schemas --check
```

## Try the local CLI

```bash
cargo install --path crates/ace-cli --locked --debug
ace init /tmp/ace-demo --id PRJ-demo --name "ACE demo"
ace validate examples/domain-kernel/candidate.json
ace hash examples/domain-kernel/environment.json
ace evidence record examples/domain-kernel/evidence.json --project /tmp/ace-demo
ace evidence show EV-example --project /tmp/ace-demo
ace policy examples/domain-kernel/policy-input.json
```

The example policy returns `elite`, **not** an automatic production promotion.
All measurements and artifact references in `examples/domain-kernel` are
illustrative fixtures, not the output of a real candidate experiment.

## Execute a real local experiment

```bash
bash examples/function-optimization/build.sh
ace run examples/function-optimization --output /tmp/ace-gcd-run --jobs 2
ace status /tmp/ace-gcd-run
ace champion /tmp/ace-gcd-run
ace knowledge /tmp/ace-gcd-run
ace explain /tmp/ace-gcd-run C-incorrect
ace replay /tmp/ace-gcd-run C-euclid
```

Use a fresh output path for each run. Omitting `--output` creates a unique directory
under `.ace/runs` and prints its path. The example registers a divisor-scan baseline,
Euclidean and binary GCD candidates, an incorrect implementation, an infinite loop
and excessive memory growth. Measurements come from actual isolated execution;
the incorrect and resource-exhausting candidates are rejected. The selected local
Champion is materialized as `champion.wasm`; canonical source files are not changed.

Read [Phase 0's format](docs/phase0.md) and [Phase 1's execution and reproduction
contract](docs/phase1.md), and [Phase 2's distributed execution and deployment
instructions](docs/phase2.md), and [Phase 3's advisory judge and calibration](docs/phase3.md).
Native candidate execution and additional vendor adapters are not implemented yet. Agent-authored WAT proposals are accepted through CLI/MCP.
The built-in grammar generates bounded
WASM candidates without compiling or starting generated native code.

The main Observatory also supports [creating private projects and running manual
proposals on the server](docs/observatory-trials.md), with exact source and native
retention for both winning and losing results.
