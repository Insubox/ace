# Phase 1: isolated local experiment

## Supported Cell and execution boundary

The first runner handles a pure mathematical GCD Cell with the WASM ABI
`(i32, i32) -> i32`, interpreted as two unsigned 32-bit inputs and one unsigned
32-bit result. `gcd(0,0) = 0`. This proves the experiment model on a small,
deterministic, benchmarkable component; it is not a general native-code runner.

`experiment.json` registers the baseline, candidate modules, strategies, generator
provenance, workload, resource limits and selection threshold. It is trusted
evaluation configuration, not candidate-controlled input. Read the generated
`schemas/local-experiment.schema.json` for its shape. Rust validation additionally
enforces supported bounds. Candidate IDs must be unique, module paths stay beneath
the input directory (including symlink resolution), and artifacts are limited to
1 MiB. All bytes are read and frozen before candidates execute. The configured
experiment ID is retained as a request label; each execution gets a fresh
experiment identity so separate runs cannot reuse observation identities.

The runner does not compile arbitrary candidate source or launch native programs.
Build reviewed example sources with `bash examples/function-optimization/build.sh`,
or register precompiled modules from another controlled build. A candidate patch in
this first adapter is a **whole WASM Cell replacement**, not a unified source diff.
Its content-addressed artifact and the baseline artifact are retained together.

Execution uses pinned WASMI 2.0.0 in deterministic, portable-dispatch mode. All
imports are rejected, including WASI. There are no host functions through which
candidate code can access files, the network, processes, private Oracle state,
policies or canonical source. Each candidate gets its own disposable Store.
Instantiation/start functions and calls have bounded fuel; linear memory is
limited to the configured pages, with at most one memory, one table and 1024 table
entries. Excess growth traps. Memory metrics refer to candidate linear memory,
not total interpreter-process RSS.

`--jobs` admits 1–8 workers; the default is one. The baseline executes first and
worker results retain registration order. The shared wall-clock budget stops
remaining work cooperatively between calls. Fuel bounds each individual call;
the wall clock is not a hard OS timeout for parsing/compiling a module. Interrupted
or budget-exhausted evaluations remain incomplete, and host allocation errors are
held for investigation. Neither case is classified as failed correctness.

## Harness, Oracle and measurements

All modules run against the same public workload and independently generated
Oracle cases, with the same configuration. The host computes expected results
using mathematical Euclidean GCD. Candidates receive only scalar inputs, never
expected outputs or a reference to the complete Oracle dataset. The example seed
is public demo data; this is not a protected dataset service for coding agents.

Every benchmark invocation is also checked against the Oracle. Results include
the number of checked calls, the input/output trace hash, mean consumed WASMI
instruction fuel, median host duration per benchmark call and peak linear memory.
Each detailed evaluation is an immutable artifact referenced by the sealed domain
Evidence. Failed candidates retain their observations and reasons.

The optimization target is **mean instruction fuel per workload call**, a
deterministic measure of work inside this pinned interpreter. Timing is real,
but includes host-to-interpreter call overhead and changes with scheduling, build
profile and hardware. Neither metric establishes production latency, cloud cost,
full-CI savings or improvements over every possible GCD input.

Environment fingerprints record the runtime, host OS/kernel/CPU/architecture,
Cargo lock and runner-source hashes, workload, configuration, concurrency, Oracle
and content-derived EvalSpec identity. Changes invalidate reproduction claims.
The Oracle version identifies mathematical GCD; bump it when changing correctness
semantics. Keep source hashes in the environment when evolving the local harness.

## Local selection and knowledge

The deterministic Policy Plane checks the evidence. Contract/ABI/import failures
are rejected at L0. Incorrect outputs and execution/resource failures are rejected;
only complete, correct observations qualify as elites. The first adapter combines
public execution, deep Oracle checks and benchmarks into one L3 observation; it
does not implement distributed staged evaluation or successive halving.

The local selector builds a Pareto frontier over fuel and linear memory. It retains
the qualified baseline unless another candidate meets the configured fuel-gain
threshold and does not regress linear memory. Ties resolve by Candidate ID.
Baseline qualification is persisted separately. If the baseline cannot qualify,
no local Champion is selected. Selecting a local Champion never changes canonical
source or deploys anything.

Knowledge preserves one scoped claim per evaluated strategy, citing its immutable
Evidence. Passing and rejected observations become structured claims; incomplete
or infrastructure-error cases remain open. Statements explicitly concern the
recorded workload and environment, not universal correctness or model reputation.

## Saved runs and replay

A run directory contains frozen modules, versioned domain documents, detailed
evaluations, evidence, decisions, baseline qualification, knowledge and the
materialized `champion.wasm` when selection succeeds. `run.json` seals the complete
report and is written last. Existing output paths cannot be reused; a partial run
without a valid completion manifest is not loadable. The CLI verifies the report,
linked documents, evaluation artifacts, WASM hashes and deterministic selection
before displaying or reproducing results.

```bash
ace run examples/function-optimization --output /tmp/ace-gcd-run --jobs 2
ace status /tmp/ace-gcd-run
ace champion /tmp/ace-gcd-run
ace knowledge /tmp/ace-gcd-run
ace explain /tmp/ace-gcd-run C-incorrect
ace replay /tmp/ace-gcd-run C-euclid
```

Replay runs the saved module even if the original input file has changed. It
requires the recorded environment to match, then compares outcome, checked-call
count, input/output trace, fuel and linear memory. Timing is reported but excluded
from equality. Replay emits a new report and does not rewrite original Evidence.
It runs one retained candidate, rather than reproducing the original parallel
worker contention; its timing therefore has no equality guarantee.
Budget-exhausted observations may not reproduce exactly when rerun with a fresh
budget; the difference is reported, rather than rewritten as a passing original.

Normal candidate rejections do not make `ace run` exit unsuccessfully: inspect
its summary for outcomes and Champion availability. Invalid setup/persistence
errors return nonzero. Replay returns nonzero on an observation mismatch or stale
environment. Saved files have content-integrity checks, not authentication or
authorization against a user who can rewrite the entire local store.

## Validation scope

Tests execute real WASM, including imports, invalid binaries, wrong signatures,
incorrect output, infinite loops, malicious start functions, memory/table limits,
and arithmetic traps. They exercise frozen-artifact replay, corrupted storage,
non-overwrite behavior, path boundaries, thresholds, stable selection, and 100
registered candidates with bounded parallelism. The 100-candidate test uses
repeated copies of a known implementation; it proves orchestration/storage, not
100 diverse AI-generated strategies or a full-CI cost advantage.

Native execution, source patch compilation, model providers, cloud inference,
Workflows/Queues, production promotion, multigeneration search and cross-platform
performance certification remain later work.
