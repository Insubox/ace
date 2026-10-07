# ACE — Agentic Code Evolution
## Architecture & Build Specification v0.2 — Cloudflare Clef edition

**Status:** Draft for implementation  
**Date:** 2026-10-05  
**Official domain:** https://ace.org.ai  
**Primary platform:** Cloudflare  
**Default fast decision models:** Workers AI `@cf/cloudflare/clef-flash` and `@cf/cloudflare/clef`  
**Core language:** Rust  
**Orchestration / Cloudflare integration:** TypeScript  
**Primary agent interface:** MCP  
**Human interface:** IDE plugin + web dashboard  
**Compatibility layer:** Git / Cloudflare Artifacts for durable champions, elites, export and interoperability
**Architecture decision:** ADR-009 replaces the previously proposed third-party fast judge with Cloudflare Clef/Clef-flash

---

## Changes in v0.2 — 2026-10-05

- Cloudflare Workers AI **Clef-flash (9B)** becomes the default L1 high-throughput probabilistic filter; **Clef (27B)** is the optional L1b second-opinion judge for ambiguous or high-impact finalists.
- Removed TypeSafe/Jev as an ACE dependency. The provider-neutral `FastJudge` contract remains so that ACE can run calibration comparisons or change models without modifying its core.
- Updated the evaluator, Cloudflare infrastructure map, manifest/provenance, analytics, security boundaries, implementation phases, backlog, ADRs and reference material.
- Added the verified Workers AI model identifiers, typed-question API contract, example Worker, calibration/fallback policy and the vendor-infrastructure boundary.
- **No benchmark or monetary improvement is guaranteed:** Cloudflare-published latency/quality measurements are reference points, not validation on ACE's code-evaluation domain.

---

# Official domain and service naming

ACE uses **ace.org.ai** as its official domain.

Recommended service endpoints:

```text
ace.org.ai             → public site
docs.ace.org.ai        → documentation
app.ace.org.ai         → developer dashboard
api.ace.org.ai         → control API
mcp.ace.org.ai         → MCP endpoint for agents
status.ace.org.ai      → service status
```

Naming principle:

```text
ACE
Agentic Code Evolution
ace.org.ai

Software that competes, learns and improves.
```

The domain is part of the project's canonical identity and should be used consistently in documentation, API examples, IDE integration, MCP configuration, dashboard links, deployment manifests and future SDKs.

---

# 1. Executive summary

ACE (Agentic Code Evolution) is an agent-first software engineering platform designed for a world in which AI coding agents can generate code orders of magnitude faster than human developers and can work in parallel as swarms.

ACE is **not a replacement for Git at the storage level**. Git remains excellent at content-addressed versioning, reproducibility, interoperability and human workflows. ACE replaces the workflow above Git for high-volume autonomous software development.

The core idea is to move from:

```text
repo → branch → commit → pull request → CI → merge
```

to:

```text
intent
  ↓
knowledge
  ↓
hypotheses
  ↓
experiments
  ↓
candidate population
  ↓
fast evaluation
  ↓
deep evaluation
  ↓
evidence
  ↓
elite set / champion
  ↓
canonical composition
  ↓
new knowledge
  ↺
```

ACE assumes that generating another implementation is relatively cheap. Therefore the scarce resources become:

1. determining which candidate is actually better,
2. evaluating candidates without spending full CI cost on each one,
3. preserving what was learned from both winners and losers,
4. isolating components so experiments cannot damage released software,
5. coordinating many heterogeneous coding agents at once,
6. knowing when further search is no longer worth its cost.

The central design principle is:

> **Champion is temporary. Knowledge is cumulative.**

ACE preserves the learning from experiments even when losing candidate code is later discarded.

---

# 2. Product thesis

Traditional version-control workflows optimize for humans:

- humans write relatively slowly,
- branches are relatively few,
- most branches are expected to matter,
- CI can run after a push,
- code review is centered on diffs,
- failed branches often disappear with little structured learning.

Agentic development changes those assumptions.

A single objective may reasonably produce:

- 100 hypotheses,
- 1,000–100,000 candidate implementations,
- multiple models working simultaneously,
- candidates created and discarded in seconds,
- more code than any human could review,
- repeated attempts at previously failed approaches unless knowledge is preserved.

Therefore ACE optimizes for:

```text
Generate cheaply
Evaluate aggressively
Eliminate early
Learn continuously
Materialize selectively
Promote safely
```

ACE treats software development more like an experimental science and optimization system than a sequence of commits.

---

# 3. Non-goals

ACE v0.x is **not** intended to:

- replace Git as a universal local source-control tool,
- replace `git diff`, local checkout or offline history for human developers,
- store every candidate permanently,
- allow autonomous agents to directly modify production,
- allow an LLM to be the sole judge of correctness,
- treat a probabilistic score as proof,
- force all code to be written in Rust,
- require one AI model or vendor,
- run full CI against every generated candidate,
- convert every function into a distributed microservice.

Git remains useful beneath ACE for durable artifacts and interoperability.

---

# 4. Core principles

## 4.1 Intent before code

Every experiment starts with a formal statement of what is being improved and what must not break.

Agents should not receive vague instructions such as:

```text
make search better
```

They should receive a structured Intent / EvalSpec.

---

## 4.2 Contract-first isolation

Every evolvable component is isolated behind an explicit contract.

An agent is permitted to change only the assigned component boundary and explicitly declared dependencies.

---

## 4.3 Candidates are ephemeral by default

A candidate is not automatically:

- a Git branch,
- a repository,
- a pull request,
- a deployment.

Most candidates should live only long enough to be evaluated.

---

## 4.4 Evidence before promotion

Nothing becomes canonical because an agent claims it is better.

Promotion requires evidence.

---

## 4.5 Use deterministic measurement whenever possible

Do not ask AI:

```text
Does this compile?
Which implementation is faster?
How much memory did this use?
```

Measure those directly.

Cloudflare Workers AI decision models **Clef-flash** and **Clef** are used for typed semantic/risk triage where deterministic measurement is too expensive or unavailable. They do **not** replace compilation, execution, independent Oracles or evidence-backed promotion.

---

## 4.6 Fail cheaply

The earlier a candidate can be eliminated, the less compute ACE should spend on it.

---

## 4.7 Knowledge survives losing code

A failed candidate can be deleted while preserving:

- hypothesis,
- strategy,
- failure reason,
- environment,
- important metrics,
- evidence references,
- learned constraints.

---

## 4.8 Model agnostic

Codex, Claude, Grok, Gemini and future models are candidate generators, planners, critics or repair agents.

No model is trusted as the canonical arbiter.

---

## 4.9 Promotion is a control-plane action

Coding agents may propose candidates.

They must not directly promote themselves to canonical production state.

---

## 4.10 Reproducibility is mandatory

Every champion must be reproducible from immutable provenance:

```text
code
base
environment
dataset
oracle
EvalSpec
knowledge version
evidence
model provenance
```

---

# 5. Domain model

ACE has seven primary domain primitives.

## 5.1 Cell

The smallest independently replaceable unit of software.

```text
Cell
├── contract
├── implementation
├── state contract
├── dependencies
├── permissions / capabilities
├── resource limits
├── observability
├── evaluator hooks
└── rollback compatibility
```

A Cell should be large enough to represent a meaningful architectural capability, but small enough that it can evolve independently.

Examples:

```text
SearchRanking
FraudScoring
PriceCalculation
CheckoutRouting
NotificationRendering
AuthTokenValidation
```

A Cell is **not automatically a microservice**. It may be:

- a library,
- module,
- Worker,
- process,
- WASM component,
- service.

The defining property is replaceability through a contract.

---

## 5.2 Intent

Defines what the system is trying to improve.

Example:

```yaml
intent:
  id: INT-001
  cell: SearchRanking
  objective: >
    Reduce p95 search latency by at least 20% without
    changing observable ranking behavior.

hard_constraints:
  correctness: 1.0
  api_compatibility: true
  authorization_unchanged: true
  data_loss: false
  error_rate_max: 0.001
  memory_mb_max: 256

optimize:
  p95_latency_ms: minimize
  compute_cost: minimize
  throughput_rps: maximize

budget:
  max_candidates: 10000
  max_wall_clock_minutes: 15
  max_compute_usd: 25

stop:
  min_improvement: 0.01
  generations_without_material_gain: 4
```

---

## 5.3 Hypothesis

A testable explanation for how the Intent might be achieved.

Example:

```text
H-821:
Repeated schema parsing dominates the hot path.
Caching the parsed representation should reduce p95
without changing observable behavior.
```

Knowledge should accumulate at the hypothesis/strategy level, not merely at the source-code level.

---

## 5.4 Experiment

The reproducible execution of one hypothesis against one or more candidates.

```text
Experiment
├── Intent
├── Hypothesis
├── Parent Knowledge Node
├── Candidate Population
├── Environment Fingerprint
├── EvalSpec
├── Oracle
├── Measurements
├── Evaluation Decisions
├── Evidence
└── Learned Knowledge
```

---

## 5.5 Candidate

A proposed implementation.

A Candidate should be represented initially as:

```text
Champion/base artifact
        +
Candidate patch
        +
Candidate manifest
```

not necessarily as a complete repository copy.

Example metadata:

```json
{
  "candidate_id": "C-182912",
  "parent": "CH-818",
  "hypothesis": "H-991",
  "cell": "SearchRanking",
  "generator": {
    "provider": "openai",
    "model": "codex-x"
  },
  "environment": "ENV-71",
  "patch_ref": "r2://ace-candidates/C-182912.patch"
}
```

---

## 5.6 Evidence

Immutable observation produced by evaluation.

Evidence is the factual substrate beneath Knowledge.

Example:

```json
{
  "evidence_id": "EV-91821",
  "experiment": "EXP-8291",
  "candidate": "C-991",
  "environment": "ENV-17",
  "measurements": {
    "correctness": 1.0,
    "p95_ms": 61.2,
    "memory_mb": 122,
    "cost_relative": 0.82
  },
  "fast_judge": {
    "provider": "cloudflare-workers-ai",
    "model": "@cf/cloudflare/clef-flash",
    "question_schema_version": "ACE-L1-v1",
    "calibration_version": "CAL-v1",
    "typed_answers_ref": "r2://ace-evidence/EV-91821/fast-judge.json",
    "semantic_equivalence_probability": 0.992,
    "regression_probability": 0.008
  },
  "oracle": {
    "passed": true
  }
}
```

Evidence is immutable. A later system may reinterpret it, but must not rewrite the original observation.

---

## 5.7 Knowledge

The accumulated conclusions derived from Evidence.

Knowledge is not simply a Markdown summary.

It has three forms:

```text
Raw Evidence        immutable
Derived Knowledge   structured / versioned
Agent Summary       context-optimized view
```

Example:

```text
KNOWLEDGE K-992
Cell: SearchRanking

CHAMPION
S-1882

PROVEN
- batch sizes 16–32 improve throughput
- local parsed-schema cache reduces p95

REJECTED
- Redis lookup on hot path: +14ms
- pool sizes >32: contention
- global cache: stale reads

CONSTRAINTS
- memory <256MB
- ranking semantics unchanged

OPEN
- SIMD tokenizer
- batching + local cache interaction

EVIDENCE
12,891 experiments
```

An agent receives the compact summary first and queries underlying Evidence only when needed.

---

## 5.8 Champion

The best **known and currently qualified** implementation for a Cell.

Champion does not mean globally optimal forever.

It is always scoped by:

- environment,
- EvalSpec,
- Oracle version,
- production constraints,
- time.

---

## 5.9 Canonical Composition

The current production system is a composition of Cell champions.

Example:

```text
Composition PROD-819

Auth        → A182
Search      → S991
Pricing     → P77
Checkout    → C412
Fraud       → F82
```

A release can replace only:

```text
Search S991 → Search S1007
```

without re-versioning the entire application as the primary mental model.

---

# 6. Architecture overview

```text
                         AGENTS
               Codex / Claude / Grok / ...
                            │
                            │ MCP
                            ▼
                 ┌────────────────────┐
                 │ MCP Gateway Worker │
                 └─────────┬──────────┘
                           │
                     Intent / Cell
                           │
                           ▼
              ┌────────────────────────┐
              │ Experiment Orchestrator│
              │ Cloudflare Workflow    │
              └────────────┬───────────┘
                           │
              Knowledge    │    EvalSpec
                  ┌────────┴─────────┐
                  ▼                  ▼
          Hypothesis Generator     Oracle
                  │
              population
                  │
                  ▼
             Queues / shards
        ┌─────────┼───────────┐
        ▼         ▼           ▼
      worker    worker      worker
        │         │           │
        ▼         ▼           ▼
      candidate sandboxes / dynamic workers
        │         │           │
        └─────────┼───────────┘
                  ▼
         FAST EVALUATION L0/L1
      ┌───────────┼─────────────┐
      ▼           ▼             ▼
 deterministic Clef-flash   Knowledge
 measurements     / Clef    similarity
      │           │             │
      └───────────┼────────────┘
                  ▼
             Policy Engine
             kill / advance
                  │
                elites
                  │
                  ▼
            DEEP EVALUATION
       replay / load / hidden /
     integration / security / chaos
                  │
                  ▼
            Pareto Frontier
                  │
              Champion
                  │
          shadow / canary
                  │
                  ▼
        Canonical Composition
                  │
                  ▼
          Knowledge Update
                  ↺
```

---

# 7. Cloudflare service mapping

| ACE responsibility | Cloudflare primitive |
|---|---|
| Public / MCP API | Workers |
| Rust fast-path logic | Rust Workers / WASM |
| Agent authentication | Access / application auth |
| Experiment orchestration | Workflows |
| Per-experiment coordination | Durable Objects |
| Massive fan-out | Queues |
| Result aggregation | Queues + aggregation workers |
| Untrusted candidate execution | Sandboxes / Containers |
| Ultra-light JS evaluation | Dynamic Workers where applicable |
| Agent-generator model traffic | AI Gateway (external providers permitted) |
| Fast semantic triage | Workers AI: `@cf/cloudflare/clef-flash` |
| Ambiguous / high-risk triage | Workers AI: `@cf/cloudflare/clef` |
| Metadata | D1 |
| Raw Evidence | R2 |
| Semantic Knowledge | Vectorize |
| Durable champion/elites | Artifacts |
| Multi-tenant execution | Workers for Platforms where useful |
| Analytics events | Workers Analytics Engine |
| Final production rollout | Worker versions / gradual deployments |

Important implementation principle:

> Cloudflare is the substrate. ACE domain logic must remain portable.

**Cloudflare-first deployment boundary:** Workers AI (Clef models), compute, orchestration, state and observability are Cloudflare-hosted by default. The IDE extensions and code generators may run off platform or call external models; ACE does not promise that arbitrary third-party agent inference is hosted by Cloudflare.

The central evaluation and policy rules should not be inseparably coupled to Cloudflare APIs.

---

# 8. Rust / TypeScript boundary

ACE should not be 100% Rust merely for purity.

## Rust responsibilities

The deterministic core:

```text
ace-core
ace-eval
ace-policy
ace-knowledge
ace-lineage
ace-protocol
ace-cli
```

Rust owns:

- canonical domain types,
- hashing,
- provenance,
- environment fingerprints,
- evaluation result schemas,
- policy evaluation,
- tournament logic,
- successive halving,
- Pareto frontier selection,
- deterministic scoring rules,
- similarity / lineage metadata,
- stop policies,
- evidence validation,
- knowledge reduction rules where deterministic,
- reproducibility manifests.

Compile the core to:

```text
native
+
WASM
```

where practical.

The same policy logic should be executable locally and in Cloudflare Workers.

---

## TypeScript responsibilities

Cloudflare orchestration and human surfaces:

- MCP gateway Worker,
- Workflows,
- Queues producers/consumers,
- sandbox lifecycle control,
- Cloudflare bindings,
- dashboard,
- VS Code / Cursor extension,
- web APIs,
- streaming UI,
- integration adapters.

Principle:

> TypeScript orchestrates. Rust decides.

---

# 9. Repository structure

Recommended monorepo:

```text
ace/
│
├── README.md
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
│
├── crates/
│   ├── ace-core/
│   ├── ace-eval/
│   ├── ace-policy/
│   ├── ace-knowledge/
│   ├── ace-lineage/
│   ├── ace-protocol/
│   └── ace-cli/
│
├── workers/
│   ├── mcp-gateway/
│   ├── control-api/
│   ├── candidate-dispatcher/
│   ├── fast-evaluator/
│   ├── result-aggregator/
│   └── analytics-writer/
│
├── workflows/
│   └── experiment-orchestrator/
│
├── services/
│   ├── sandbox-controller/
│   ├── model-router/
│   └── fast-judge-adapter/
│
├── apps/
│   ├── dashboard/
│   └── vscode-extension/
│
├── schemas/
│   ├── cell.schema.json
│   ├── intent.schema.json
│   ├── hypothesis.schema.json
│   ├── experiment.schema.json
│   ├── candidate.schema.json
│   ├── evidence.schema.json
│   ├── knowledge.schema.json
│   ├── environment.schema.json
│   └── composition.schema.json
│
├── examples/
│   ├── function-optimization/
│   └── search-cell/
│
└── docs/
    ├── architecture.md
    ├── threat-model.md
    ├── evaluation.md
    ├── knowledge.md
    └── mcp.md
```

---

# 10. MCP surface

Agents should interact with ACE concepts, not Git primitives.

Avoid:

```text
git_commit()
git_push()
git_rebase()
create_branch()
```

Initial MCP tool surface:

```text
get_assignment()
inspect_cell()
query_knowledge()

create_candidate()
run_probe()
submit_candidate()

inspect_evidence()
```

Potential later tools:

```text
propose_hypothesis()
inspect_elites()
request_replay()
explain_decision()
```

The agent should not initially receive:

```text
promote()
modify_oracle()
modify_hidden_tests()
change_policy()
```

Those belong to a separate control plane.

---

# 11. What a coding agent receives

A Codex/Claude/Grok worker should receive only the context required for the experiment:

```text
1. Intent:
   What are we trying to improve?

2. Invariants:
   What must never break?

3. Knowledge:
   What has already been learned?

4. Hypothesis:
   What specific idea am I testing?

5. Cell:
   What architectural boundary may I touch?
```

It returns:

```text
Candidate
+
Hypothesis outcome
+
Observations
```

The agent should not need to understand:

- Cloudflare Queues,
- R2,
- D1,
- Artifacts,
- merge mechanics,
- other agents' internal execution,
- deployment routing.

---

# 12. Multi-model execution

ACE must support multiple agent vendors simultaneously.

Example:

```text
                Intent
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
     Codex       Claude        Grok
       │           │            │
      C101        C102         C103
       │           │            │
       └───────────┼────────────┘
                   ▼
               Evaluator
```

Models can operate in two modes.

## Competition

Multiple agents solve the same hypothesis independently.

```text
Claude candidate
Codex candidate
Grok candidate
      ↓
same evaluator
```

## Collaboration

Different models perform different roles.

Example:

```text
Claude   → architecture hypothesis
Codex    → implementation
Grok     → adversarial review
Codex    → repair
Evaluator → independent decision
```

Model provenance must be captured on every candidate.

Over time ACE may learn a `Model × Domain` performance matrix and dynamically allocate experiment budget, but this must be evidence-based rather than hardcoded model preference.

---

# 13. Candidate lifecycle

```text
CREATED
   ↓
STATIC_SCREEN
   ↓
FAST_EVAL
   ↓
TARGETED_EXECUTION
   ↓
DEEP_EVAL
   ↓
ELITE
   ↓
SHADOW
   ↓
CANARY
   ↓
CHAMPION
   ↓
CANONICAL
```

Terminal states:

```text
KILLED
REJECTED
INVALID
SUPERSEDED
ARCHIVED
```

Candidate code should remain ephemeral through early stages.

Artifacts are created only for:

- important elites,
- champions,
- reproducibility checkpoints,
- manual pinning,
- interoperability/export.

---

# 14. Evaluation architecture

The evaluator is arguably the most important component in ACE.

When generating code becomes cheap, determining which code deserves to survive becomes the scarce capability.

Evaluation should use four layers.

---

## L0 — Deterministic cheap truth

Target latency: milliseconds where feasible.

Examples:

- patch parses,
- schema valid,
- disallowed files untouched,
- declared dependency boundaries respected,
- static contract validation,
- hashing,
- provenance valid,
- known deterministic policy violations,
- syntax / type information when cheap enough,
- dependency impact calculation.

Avoid launching a container when L0 can reject the candidate.

---

## L1 — Fast intelligence (Workers AI)

Cloudflare's two-stage triage is implemented as **L1a: Clef-flash for the bulk of valid candidates** and **L1b: Clef only for uncertain, high-risk, high-value or sampled cases**. These are two routes within L1, not two unconditional calls per candidate.

Examples:

- Clef-flash typed probabilistic triage via Workers AI, with optional Clef escalation,
- likely regression risk,
- semantic equivalence,
- architectural compatibility,
- similarity to known failed strategies,
- novelty,
- expected information gain,
- likely value of spending deeper compute.

Important:

A score such as:

```text
semantic_equivalence = 0.97
```

does **not** mean “the code is 97% correct.”

It means the fast evaluator assigns that probability under its model/calibration.

Policy remains deterministic.

Routing policy (illustrative; **not** production-ready thresholds):

```text
L0 deterministic FAIL                         → KILL
L1 Clef-flash very low estimated risk          → eligible for L2
L1 Clef-flash uncertain / conflicting           → Clef or real execution
L1 known failed strategy, confirmed by policy → deprioritize or KILL
L1 high estimated risk but no hard proof        → sample/audit or L2, not blindly discard
L2/L3 hard-constraint or Oracle FAIL             → REJECT
```

An L1 output is a **model-estimated probability**, not a deterministic percentage of code correctness. Protect against **false elimination of potentially good candidates** using a calibrated recall target, uncertainty bands, stratified random audits of rejects and comparison to an L1-bypass control group. L1 should primarily allocate scarce compute, not silently declare functional truth.

Default fast-judge routing:

```text
FastJudge (stable provider-neutral interface)
├── WorkersAiClefFlashAdapter  → @cf/cloudflare/clef-flash (9B)
├── WorkersAiClefAdapter       → @cf/cloudflare/clef (27B)
└── FutureAdapter              → explicit, approved replacement
```

- Prefer **Clef-flash** on the bulk stream; call **Clef** selectively, not on every candidate.
- Record judge model ID, revision if exposed, question-schema version, input hash, threshold-policy version, and calibration version as Evidence provenance.
- If the judge errors or becomes unavailable, use a **fail-open-to-real-tests** path (subject to budget/backpressure) or pause the experiment. Never treat a timeout as proof of failure.
- Place Clef input state within the published **65,536-token context window**. Use summaries + immutable Evidence IDs, not huge unbounded code dumps.
- The Clef request supports **1–64 typed questions** (`noul`, `choice`, `score`); group related questions without making input construction expensive.
- No candidate code or untrusted repository instructions may control the Oracle, private questions, policies, model routing, or thresholds.

The adapter preserves portability without adding a non-Cloudflare runtime dependency.

---

## L2 — Targeted real execution

Only survivors receive meaningful execution budget.

Examples:

- affected tests,
- contract tests,
- microbenchmarks,
- deterministic replay samples,
- workload simulation,
- resource measurement,
- selected integration tests.

---

## L3 — Proof / deep evaluation

Reserved for finalists.

Examples:

- hidden Oracle,
- complete integration test set,
- security tests,
- concurrency,
- chaos,
- large production replay,
- compatibility tests,
- shadow traffic,
- production canary.

---

# 15. Successive halving / tournament design

ACE must not spend equal compute on every candidate.

Example:

```text
10,000 candidates
       │
       │ ~milliseconds each
       ▼
1,000 survivors
       │
       │ ~seconds
       ▼
100 survivors
       │
       │ deeper benchmarks
       ▼
10 finalists
       │
       │ hidden / integration
       ▼
3 elites
       │
       │ shadow / canary
       ▼
Champion
```

Candidate execution should support early termination.

If a hard constraint is violated:

```text
KILL immediately
```

If statistical bounds show a candidate cannot realistically catch leaders:

```text
KILL / stop evaluation
```

Freed compute is reallocated to promising candidates.

---

# 16. Selection semantics

ACE must not rely on a single opaque score for everything.

First enforce hard constraints:

```text
correctness
security
contract
data integrity
policy
```

Then optimize soft objectives:

```text
latency
cost
memory
throughput
complexity
energy
```

When objectives conflict, maintain a Pareto frontier.

Example:

```text
Elite A → fastest
Elite B → cheapest
Elite C → lowest memory
```

A Champion is chosen only when deployment policy requires one canonical implementation.

Elites can seed later generations.

---

# 17. Exploration vs exploitation

The Orchestrator should actively prevent premature convergence.

Example policy:

```text
70% compute → promising strategy families
30% compute → novel / unexplored hypotheses
```

Early generations should explore broadly.

Later generations should allocate more compute to successful families while retaining a novelty budget.

Potential signals:

- novelty score,
- strategy-cluster diversity,
- information gain,
- lineage distance,
- historical win rate.

---

# 18. Candidate similarity and clustering

`1,000 candidates` should not automatically be considered `1,000 unique experiments`.

ACE should cluster candidates by:

- behavioral similarity,
- architecture,
- changed dependency graph,
- semantic strategy,
- lineage,
- code similarity.

Output may be:

```text
1,000 candidates
→ 73 strategy families
```

This prevents wasting deep evaluation on hundreds of near-identical implementations.

---

# 19. Recombination

ACE should eventually support explicit inheritance between elite candidates.

Example:

```text
Elite A
great caching

Elite B
great concurrency

Elite C
excellent memory behavior
       ↓
Recombination experiment
       ↓
Candidate D
```

The system should record **which traits** are being recombined, not merely merge arbitrary code.

This requires:

```text
parent candidate IDs
trait/strategy annotations
expected interaction
result evidence
```

---

# 20. Stop policy

A search system that can always generate another candidate needs an explicit rule for stopping.

Potential conditions:

```text
budget exhausted
OR
wall-clock limit reached
OR
improvement < threshold for N generations
OR
expected value of next experiment < expected cost
OR
confidence / statistical evidence sufficient
OR
all meaningful hypothesis families exhausted
```

`stop_search()` is a first-class capability.

---

# 21. Total isolation framework

ACE depends on replaceable software units.

A candidate should not be allowed to create undeclared coupling.

Every Cell must declare:

```text
inputs
outputs
state access
allowed dependencies
allowed network
allowed filesystem
secrets
resource limits
side effects
rollback rules
```

The infrastructure must enforce these restrictions independently of agent instructions.

Prompt instructions are not a security boundary.

---

# 22. CellSpec

Initial conceptual schema:

```yaml
cell:
  id: SearchRanking
  version: 1

contract:
  input_schema: ./schemas/search-request.json
  output_schema: ./schemas/search-result.json

capabilities:
  read:
    - Catalog
    - SearchIndex
  write: []
  network: deny
  secrets: []

resources:
  memory_mb: 256
  cpu_ms: 1000

invariants:
  - ranking_semantics
  - tenant_isolation

state:
  mode: read_only
  schema_version: 7

evaluation:
  evalspec: SearchRankingEval-v3

rollback:
  backward_compatible: required
```

---

# 23. State isolation

Source code is easier to swap than state.

ACE must never let experimental code mutate canonical state directly.

Preferred mechanisms:

```text
canonical state
      │
      ├── snapshot / clone
      ├── copy-on-write
      └── deterministic event replay
              ↓
        candidate sandbox
```

Different Cells may require different approaches.

---

# 24. Counterfactual replay

A powerful ACE feature should be deterministic replay of production inputs.

Example:

```text
production event stream
R1
R2
R3
...
       ↓
┌───────────────┬───────────────┐
Champion CH81   Candidate C991  Candidate C992
       │               │               │
       └───────────────┼───────────────┘
                       ▼
                 compare outputs
```

Metrics:

```text
                CH81     C991     C992
correctness     100%     100%     99.97%
p95              89ms     61ms      54ms
memory           110MB    122MB     280MB
cost             1.00     0.82      0.73
```

C992 may be faster but fail constraints.

Replay gives stronger evidence than purely synthetic tests.

---

# 25. Environment fingerprint

Evidence is valid only within an environment.

Every evaluation must record an immutable Environment Fingerprint.

Example:

```text
runtime
OS / image
CPU architecture
dependency lock hashes
database version
schema version
dataset hash
traffic-profile hash
configuration
feature flags
model versions
Oracle version
EvalSpec version
```

If relevant environment inputs change, associated Evidence can be marked:

```text
potentially stale
```

and selectively re-evaluated.

---

# 26. Evidence validity and re-evaluation

A Champion is not permanent.

Changes in:

- runtime,
- dependencies,
- traffic,
- hardware,
- security rules,
- database,
- business objective,
- external API behavior

may invalidate prior Evidence.

ACE needs a dependency graph between:

```text
Evidence → Environment properties
```

When a property changes, re-evaluate only impacted champions/elites.

---

# 27. Oracle

The Oracle defines what “correct” means.

It must be logically separated from the Evaluator.

```text
Evaluator:
runs and measures

Oracle:
defines correctness / acceptance
```

The Candidate Plane cannot modify the Oracle.

Potential Oracle sources:

- exact assertions,
- golden outputs,
- behavioral equivalence,
- hidden datasets,
- formal invariants,
- domain constraints,
- production-grounded expected outcomes.

Bad Oracle design can reliably select the wrong solution.

Oracle design is therefore a first-class architecture concern.

---

# 28. Trust boundaries

Logical planes:

```text
Candidate Plane
Evaluation Plane
Oracle Plane
Policy Plane
Promotion Plane
```

Candidate agents cannot directly:

```text
read hidden tests
modify Oracle
modify evaluator thresholds
modify production metrics
change promotion policy
access production secrets
write canonical state
```

Changes to these systems require separate privileged workflows.

---

# 29. Security model

Threats include:

- prompt injection from repository content,
- malicious generated code,
- dependency attacks,
- test/evaluator gaming,
- hidden-test exfiltration,
- secret access,
- network exfiltration,
- cross-tenant data access,
- sandbox escape,
- malicious package install,
- evaluator manipulation.

Minimum safeguards:

- sandbox untrusted code,
- default-deny network,
- capability-based access,
- no production secrets in candidate environment,
- immutable hidden Oracle,
- signed/hashed evaluation manifests,
- tenant isolation,
- explicit outbound proxy where needed,
- dependency allowlists/policies,
- audit log,
- resource quotas,
- execution timeouts,
- kill switches.

---

# 30. Data/storage model

## D1 — structured metadata

Suggested tables:

```text
projects
cells
intents
hypotheses
experiments
candidates
candidate_parents
evaluations
evidence_index
knowledge_nodes
knowledge_claims
knowledge_links
environments
oracle_versions
evalspec_versions
champions
compositions
model_performance
budgets
promotion_events
```

D1 stores metadata and indexes, not giant logs.

---

## R2 — raw Evidence and ephemeral artifacts

Buckets/prefixes:

```text
ace-evidence/
ace-candidates/
ace-replays/
ace-traces/
ace-datasets/
ace-build-cache/
```

Examples:

```text
/evidence/{project}/{experiment}/{candidate}/...
/candidates/{candidate}.patch
/replays/{environment}/{dataset}
/traces/{experiment}/{candidate}.jsonl
```

---

## Vectorize — semantic Knowledge

Index useful knowledge snippets and strategy descriptors:

```text
"Redis lookup on hot path caused +14ms p95"
"pool sizes >32 produced lock contention"
"batching 16–32 improved throughput"
```

Metadata filters:

```text
project
cell
environment_family
language
framework
hypothesis_family
result_class
```

Vector retrieval must point back to structured Evidence IDs.

---

## Artifacts — durable software

Use Artifacts for:

- Champion source,
- selected elites,
- reproducibility checkpoints,
- exports to standard Git clients,
- interoperability with existing tooling,
- production Workers Builds where appropriate.

Do **not** create an Artifact repository for every throwaway candidate unless a specific workload proves that beneficial.

As of 2026-10-01 Cloudflare Artifacts is in open beta, so ACE must keep an adapter boundary around it.

---

# 31. Result taxonomy

Do not reduce every experiment to `pass/fail`.

Initial outcomes:

```text
WIN
ELITE
PROMISING
INCONCLUSIVE

FAILED_CORRECTNESS
FAILED_PERFORMANCE
FAILED_SECURITY
FAILED_CONTRACT
FAILED_RESOURCE_LIMIT
FAILED_STATE_COMPATIBILITY

DUPLICATE_APPROACH
KNOWN_BAD_STRATEGY
INVALID_EXPERIMENT
EVALUATOR_ERROR
ENVIRONMENT_ERROR
```

This taxonomy improves Knowledge extraction and future routing.

---

# 32. Knowledge architecture

Knowledge must be grounded in Evidence.

Never permit:

```text
LLM summary → accepted fact
```

without traceability.

Architecture:

```text
Raw Evidence
   ↓
structured claims
   ↓
claim confidence / scope
   ↓
Knowledge Node
   ↓
agent-optimized summary
```

Every claim needs:

```text
claim_id
statement
supporting_evidence[]
contradicting_evidence[]
scope
confidence
environment applicability
created_at
superseded_by?
```

---

# 33. Knowledge inheritance

A child experiment inherits the parent's accumulated Knowledge.

Example:

```text
Parent K42
├── champion
├── proven strategies
├── failed strategies
├── constraints
├── unresolved questions
└── evidence index
       ↓
new experiment population
       ↓
results
       ↓
K43
```

K43 should **add learning**, not merely overwrite K42.

---

# 34. Hot / warm / cold retention

Not all artifacts require equal retention.

```text
HOT
- current champion
- active elites
- current Knowledge
- current experiment evidence

WARM
- important historical experiments
- meaningful failed strategies
- selected traces

COLD
- raw candidate artifacts
- full execution traces
- old replay material

PRUNED
- redundant candidate source
```

Even when candidate source is pruned, retain:

```text
candidate hash
hypothesis
strategy/family
model provenance
result
failure reason
key measurements
important evidence IDs
```

---

# 35. Scientific provenance

Every materialized Champion gets a reproducibility manifest.

Example:

```text
Champion CH-991

code_hash
base_hash
cell_spec_hash

environment_hash
dataset_hash

intent_hash
hypothesis_id
oracle_version
evalspec_version

knowledge_node
evidence_root

generator_provider
generator_model
generator_config
```

This becomes ACE's equivalent of the most valuable property of a Git commit: exact identity.

---

# 36. IDE integration

The developer should remain inside VS Code / Cursor / compatible IDE.

The ACE extension connects to the control API/MCP-compatible backend.

Primary panels:

```text
Current Cell
Intent
Hypotheses
Running Experiments
Leaderboard
Evidence
Knowledge
Champion
Composition
```

Example:

```text
SEARCH CELL
Intent: reduce p95 latency >20%

Hypotheses
H-81 Local cache       34 candidates
H-82 Query batching    27 candidates
H-83 SIMD tokenizer    41 candidates

Current leaders
C-821 Claude   -31.4%
C-917 Codex    -29.1%
C-632 Grok     -25.8%

Champion
S-441          78ms

Best Candidate
C-821          53ms
```

Clicking a candidate opens:

- patch/diff,
- hypothesis,
- evaluator stages,
- measurements,
- evidence,
- reason advanced/eliminated.

No checkout required for inspection.

---

# 37. Evolution Graph

Replace the Git graph as the primary visualization with a Knowledge/Evolution Graph.

```text
Knowledge K18
      │
      ├── H1 caching
      │     ├── C1 ✕
      │     ├── C2 ✕
      │     └── C3 ★
      │
      ├── H2 batching
      │     ├── C4
      │     └── C5 ★★
      │
      └── H3 SIMD
            ├── C6 ✕
            └── C7
                  ↓
             CHAMPION C5
                  ↓
             Knowledge K19
```

The user sees the software learning, not merely files changing.

---

# 38. Canonical Composition view

IDE and dashboard should display:

```text
PRODUCTION COMPOSITION

Auth
A-21
stable

Search
S-91
candidate S-102: +18%

Pricing
P-44
stable

Checkout
C-31
experiment running
```

This makes software reconfiguration visible at the Cell level.

---

# 39. Ask ACE / Ask Evolution

The developer should be able to query the Evidence graph.

Examples:

```text
Why is S91 still Champion?

What have we already tried to reduce memory?

Why was global caching rejected?

Which hypotheses are producing meaningful gains?

What changed in production composition today?

Show evidence that C102 is safe to promote.
```

Responses must cite internal Evidence IDs and never invent unsupported conclusions.

---

# 40. Analytics model

Workers Analytics Engine can receive high-cardinality experiment events.

Candidate evaluation event:

```text
timestamp
project_id
cell_id
experiment_id
hypothesis_id
candidate_id
model_provider
model_name
generation
stage

correctness
latency
memory
cost

fast_judge_model_id
fast_judge_question_schema_version
fast_judge_calibration_version
fast_judge_semantic
fast_judge_regression
fast_judge_latency_ms
fast_judge_token_usage
fast_judge_routing_stage

status
result_class
```

Required dashboards:

- candidates generated per minute,
- survival rate by stage,
- compute spent,
- improvement by generation,
- hypothesis leaderboard,
- strategy-family leaderboard,
- model × domain performance,
- Clef-flash vs Clef routing frequency / incremental benefit,
- L1 false-elimination rate and audited reject cohorts,
- Workers AI inference throughput, p95 and estimated cost,
- kill reasons,
- evidence latency,
- time-to-champion,
- cost-to-improvement,
- production composition changes,
- stale Evidence count.

---

# 41. Fast Judge — Cloudflare Clef-flash + Clef on Workers AI

ACE should define a provider-neutral Rust interface; the TypeScript Worker handles Cloudflare AI bindings and normalizes provider-specific output:

```rust
trait FastJudge {
    fn evaluate(&self, context: FastJudgeContext) -> FastJudgeResult;
}
```

**Workers AI binding and model identifiers (verified 2026-10-05):**

```toml
# wrangler.toml for the Worker hosting the fast-judge adapter
[ai]
binding = "AI"
```

```typescript
// Example only: the provider adapter must validate inputs and normalize results.
// The "noul" spelling is the *actual* Cloudflare API question type.
const response = await env.AI.run("@cf/cloudflare/clef-flash", {
  model: "clef-flash",
  state: {
    intent: publicIntentSummary,
    cell_contract: authorizedContractSummary,
    candidate_patch_summary: verifiedDiffSummary,
    known_failure_summary: evidenceBackedKnowledge,
  },
  questions: {
    behavior_change_risk: {
      type: "noul",
      instructions: "Is this candidate likely to change observable behavior?",
    },
    prior_failure_similarity: {
      type: "noul",
      instructions: "Does it repeat a documented failed strategy?",
    },
    architectural_fit: {
      type: "choice",
      instructions: "How does it fit the declared Cell contract?",
      criteria: {
        good: "Consistent with declared boundaries",
        uncertain: "Insufficient evidence",
        poor: "Likely inconsistent with declared boundaries",
      },
    },
    novelty: {
      type: "score",
      instructions: "Rate the novelty of this candidate's strategy",
      criteria: ["Duplicate", "Incremental", "New", "Highly novel"],
    },
  },
});
// Read response.answers by the request's question IDs; validate the
// typed response before translating it into ACE Evidence.
```

For deeper L1b review, invoke the same System One-shaped request using:

```typescript
const response = await env.AI.run("@cf/cloudflare/clef", {
  model: "clef",
  state: normalizedCandidateState,
  questions: approvedQuestionSchema,
});
```

The documented `state` accepts structured JSON or strings. `noul` returns the yes probability; `choice` returns option probabilities, and `score` returns probabilities over an ordered rubric. Do not assume those scores prove code is correct.

**Normalize to an ACE contract:**

```text
FastJudgeResult
├── model_id
├── question_schema_version
├── input_fingerprint
├── calibration_version
├── latency_ms
├── probabilities / typed rubric outcomes
├── evaluation_quality_flags
└── evidence_ref
```

Desired evaluations include **estimated** behavioral-regression risk, architecture fit, prior-failure similarity and novelty. Correctness, latency, memory and throughput are measured by L0/L2/L3 instead of fabricated by Clef.

**Deployment/cost:** Clef-flash (9B) is the default hot path and Clef (27B) is reserved for uncertainty/high-impact decisions; both are hosted on Workers AI and can be used through Workers AI bindings, REST or AI Gateway. Confirm quotas, input-token pricing, throughput and rate limits for the ACE account before finalizing budget policies. Cloudflare documentation as of 2026-10-05 lists an input price of **$0.09/M tokens** for Clef-flash and **$0.24/M tokens** for Clef; these may change and do not cover generation, containers or all other costs.

**Failure and correctness handling:**

- Never advance a candidate solely on Clef's confidence when a deterministic hard gate fails.
- Do not auto-kill marginal candidates solely on a probabilistic risk score; preserve a randomized audit sample to estimate false-negative rate.
- High-impact Cells and low-confidence decisions go to Clef and/or real test execution.
- Timeouts/provider faults result in retry with bounded backoff, L1 bypass to real tests or experiment pause—not silent rejection.
- Persist original typed responses as immutable Evidence with the configuration/model ID.
- Separately validate the quality and value of each question. Do not assume the published generic task benchmarks transfer to software correctness.

The Policy Engine owns thresholds. Neither Clef model directly promotes candidates.

---

# 42. Policy Engine

Policy is deterministic, auditable and versioned.

Example conceptual rules:

```text
IF deterministic_contract == FAIL
  → KILL

IF semantic_equivalence_probability < threshold
  → KILL

IF likely_regression_probability > threshold
  → KILL

IF known_failure_similarity > threshold
  AND novelty < minimum
  → KILL

IF expected_information_gain high
  → ADVANCE even if predicted win probability is moderate

IF hard_constraint violated
  → KILL

IF final Oracle fails
  → REJECT
```

Every decision outputs:

```text
policy_version
decision
reason codes
inputs
timestamp
```

---

# 43. Experiment orchestration

One Workflow per high-level experiment.

Workflow responsibilities:

1. load Intent,
2. load CellSpec,
3. load Knowledge,
4. create/gather hypotheses,
5. allocate model/compute budget,
6. dispatch candidate-generation jobs,
7. dispatch L0/L1 evaluation,
8. run successive-halving stages,
9. identify elites,
10. schedule deep evaluation,
11. produce Evidence,
12. update Knowledge,
13. determine stop/continue,
14. if qualified, request shadow/canary promotion.

Workflows must not synchronously carry massive candidate payloads.

Store IDs and references instead.

---

# 44. Durable Object design

Use one logical coordinator per experiment or shard:

```text
ExperimentDO:EXP-123
```

Avoid:

```text
GlobalACECoordinator
```

The DO should track compact state:

```text
generated
alive_by_stage
elite_ids
budget_used
best_metrics
generation
status
```

Do not stream every candidate log into the DO.

Evaluation workers send results through queues/aggregation.

---

# 45. Queue design

Do not depend on one global queue.

Logical queues/shards:

```text
candidate-generation
fast-eval-{shard}
sandbox-eval-{shard}
deep-eval
result-aggregation
knowledge-update
promotion
```

Sharding can consider:

```text
project
cell
experiment
tenant
priority
```

Backpressure should throttle candidate creation when evaluator capacity is saturated.

---

# 46. Sandbox execution

Use Cloudflare Sandboxes/Containers for candidates that require:

- filesystem,
- npm/cargo/pip,
- compiler,
- child processes,
- test runners,
- binaries,
- Linux tooling.

Use lighter execution where possible before starting containers.

Sandbox preparation:

```text
base champion snapshot
+
candidate patch
+
fixed environment
+
allowed dependencies
+
test harness
```

Candidate execution should be stateless or disposable wherever possible.

---

# 47. Build/cache strategy

ACE must outperform traditional CI partly through aggressive reuse.

Cache by content hash where valid:

```text
dependency lock hash
compiler version
base Cell hash
module hash
test harness hash
environment fingerprint
```

Potential reusable outputs:

- installed dependencies,
- compiled dependencies,
- unchanged module builds,
- deterministic test results,
- known valid subtrees,
- test fixtures.

Do not reuse Evidence when environment dependencies relevant to the claim changed.

---

# 48. Validation evidence graph

Instead of rerunning everything after every candidate, track what has already been proved.

Conceptual:

```text
Cell root
├── module A ✓ evidence E1
├── module B ✓ evidence E2
└── module C changed
      ↓
invalidate only impacted evidence
```

At final certification ACE asks:

```text
What evidence remains valid?
What evidence became invalid because of composition?
What must be re-run?
```

This is more efficient than blind full-CI execution for every change.

---

# 49. Promotion flow

No candidate jumps directly to production.

```text
Candidate
   ↓
Elite
   ↓
Deep validated
   ↓
Shadow
   ↓
Canary 1%
   ↓
Canary 10%
   ↓
Canary 50%
   ↓
Champion
   ↓
Canonical
```

Promotion policies may differ by Cell risk class.

Example:

```text
documentation Cell
→ minimal canary

authentication Cell
→ strict hidden tests + extended shadow + human approval
```

---

# 50. Rollback

Canonical production should reference Cell champion IDs, allowing narrow rollback.

```text
before
Search → S91

promoted
Search → S102

rollback
Search → S91
```

Rollback eligibility requires explicit state compatibility.

Every Candidate must declare / prove:

```text
backward compatibility
forward compatibility
migration requirements
downgrade requirements
```

If a candidate writes state that the previous champion cannot read, ACE must not advertise instant rollback.

---

# 51. Git / Artifacts role

Git becomes:

```text
compatibility
durable source artifact
exact snapshot
external ecosystem bridge
```

It is not the primary experimentation model.

Flow:

```text
10,000 ephemeral candidates
       ↓
tournament
       ↓
3 elites
       ↓
champion
       ↓
Artifact / Git-compatible representation
```

This preserves interoperability without requiring branches/PRs for every candidate.

---

# 52. Human governance

ACE should support progressive autonomy.

Modes:

```text
OBSERVE
agents propose; human selects

ASSIST
ACE selects finalists; human promotes

SUPERVISED
ACE promotes low-risk Cells automatically;
human approves material changes

AUTONOMOUS
policy-controlled automatic promotion
```

The initial MVP should operate in **ASSIST** mode.

---

# 53. MVP thesis

The first ACE MVP should prove one statement:

> Given one isolated Cell and one measurable Intent, ACE can generate many candidate implementations, evaluate them in parallel, eliminate bad solutions cheaply, preserve structured learning, and produce a qualified Champion faster/cheaper than running full CI on every candidate.

Do not start by building a general autonomous software ecosystem.

---

# 54. MVP demonstration

Recommended demo:

```text
Cell:
pure or mostly pure function / service

Intent:
improve throughput or latency
without changing output behavior

Population:
100 candidates

Agents:
at least 2 model providers if available

Evaluation:
L0 deterministic
L1 fast semantic
L2 benchmark
L3 hidden correctness

Output:
Champion
+
3 elites
+
Knowledge Node
+
Evidence
```

Example observable run:

```text
Generation 1 → +18%
Generation 2 → +6%
Generation 3 → +2%
Generation 4 → +0.1%

STOP
```

---

# 55. MVP functional requirements

## FR-001 Project

Create an ACE project.

## FR-002 Cell

Register one Cell with a CellSpec.

## FR-003 Intent

Submit an Intent/EvalSpec.

## FR-004 Knowledge

Create and retrieve Knowledge Node.

## FR-005 Hypothesis

Create hypotheses manually or via an agent.

## FR-006 Candidate

Create candidate patches against a champion.

## FR-007 Parallel evaluation

Evaluate candidates concurrently.

## FR-008 Fast kill

Eliminate candidates at cheap deterministic stages and use Cloudflare Clef-flash/Clef only with calibrated probabilistic triage rules and a false-elimination audit cohort.

## FR-009 Evidence

Persist immutable Evidence.

## FR-010 Leaderboard

Show current survivors and elites.

## FR-011 Champion

Select a champion under deterministic policy.

## FR-012 Knowledge update

Extract structured successful/failed learning.

## FR-013 Explain

Explain why a candidate won/lost with Evidence references.

## FR-014 Reproduce

Re-run a selected candidate under the recorded environment.

## FR-015 Artifact

Materialize the Champion into Artifacts/Git-compatible storage.

---

# 56. MVP non-functional requirements

Initial targets, to be validated:

```text
candidate metadata creation       <100ms p95
L0 decision                       <100ms where feasible
experiment state query            <250ms p95
100 candidate fan-out             <5s dispatch
no canonical mutation by candidate
100% Evidence traceability
deterministic Policy decisions
measured L1 false-negative / winner-elimination rate
L1 inference outage cannot silently mark a candidate as FAILED
one-command local reproduction
```

Do not prematurely promise 10,000-way execution until the 100-way architecture is measured.

---

# 57. Implementation phases

## Phase 0 — domain kernel

Build:

```text
ace-core
ace-protocol
schemas
ace-cli
```

Deliverables:

- IDs/types,
- Intent,
- Cell,
- Hypothesis,
- Candidate,
- Evidence,
- Knowledge,
- Champion,
- Composition,
- policy decision model,
- serialization,
- hashing/provenance.

No cloud execution yet.

---

## Phase 1 — single-machine experiment

Build a local ACE runner.

```text
ace run ./examples/function-optimization
```

Capabilities:

- generate/register candidate patches,
- run same harness,
- produce measurements,
- choose elite/champion,
- create Knowledge.

This proves the model before distributed infrastructure.

---

## Phase 2 — Cloudflare execution

Add:

- MCP/API Worker,
- Workflows,
- Queues,
- Experiment DO,
- D1,
- R2,
- Sandbox evaluation.

Goal:

```text
100 candidates parallel
```

---

## Phase 3 — Cloudflare Clef Fast Judge

Add:

- Workers AI bindings and **Clef-flash (L1a)** and **Clef (L1b)** adapters,
- typed question-schema versioning (`noul` / `choice` / `score`),
- calibration dataset,
- uncertainty-routing and deterministic threshold policies,
- falsified/winner candidate holdouts to detect **false eliminations**,
- known-failure retrieval,
- novelty/information-gain experiments,
- actual per-model latency, token usage and budget dashboards.

Measure total compute, *end-to-end time-to-Champion*, winner recall and Champion quality against both a full-CI baseline and an **L1-bypass** baseline. Do not deploy hard thresholds from generic vendor benchmarks.

---

## Phase 4 — Knowledge system

Add:

- structured claims,
- Vectorize retrieval,
- parent/child Knowledge,
- evidence-backed summaries,
- failed-strategy memory,
- stale-evidence handling.

---

## Phase 5 — Multi-agent / multi-model

Adapters:

```text
Codex
Claude
Grok
Gemini
generic MCP/A2A-compatible generator
```

Implement:

- competition mode,
- collaboration mode,
- model provenance,
- model/domain analytics.

---

## Phase 6 — IDE

VS Code first.

Build:

- project status,
- hypothesis tree,
- live candidate leaderboard,
- candidate diff,
- Evidence view,
- Champion comparison,
- Ask ACE.

---

## Phase 7 — replay / shadow

Add:

- event capture,
- deterministic replay,
- shadow execution,
- comparison,
- environment fingerprints.

---

## Phase 8 — production promotion

Add:

- Artifact materialization,
- Worker version deployment,
- gradual rollout,
- production Evidence,
- automatic rollback policy,
- canonical composition.

---

## Phase 9 — scale

Only after measurements:

```text
100 → 1,000 → 10,000 candidates
```

Optimize:

- queue sharding,
- container reuse,
- batch evaluation,
- caching,
- evidence compaction,
- clustering,
- early stopping,
- budget allocation.

---

# 58. Initial Rust types

Illustrative only:

```rust
pub struct ProjectId(pub String);
pub struct CellId(pub String);
pub struct IntentId(pub String);
pub struct HypothesisId(pub String);
pub struct ExperimentId(pub String);
pub struct CandidateId(pub String);
pub struct EvidenceId(pub String);
pub struct KnowledgeId(pub String);
pub struct ChampionId(pub String);

pub struct Candidate {
    pub id: CandidateId,
    pub parent: ChampionId,
    pub cell: CellId,
    pub hypothesis: HypothesisId,
    pub patch_hash: String,
    pub environment_hash: String,
    pub provenance: Provenance,
}

pub struct Evidence {
    pub id: EvidenceId,
    pub experiment: ExperimentId,
    pub candidate: CandidateId,
    pub environment_hash: String,
    pub measurements: Vec<Measurement>,
    pub oracle: OracleResult,
    pub evaluator: EvaluatorResult,
}

pub enum Decision {
    Kill(KillReason),
    Advance(EvaluationStage),
    Elite,
    Champion,
}
```

---

# 59. API sketch

Control API:

```text
POST /projects
POST /projects/:id/cells

POST /intents
GET  /intents/:id

POST /experiments
GET  /experiments/:id
POST /experiments/:id/stop

POST /experiments/:id/hypotheses
POST /experiments/:id/candidates

GET  /candidates/:id
GET  /candidates/:id/evidence

GET  /cells/:id/knowledge
GET  /cells/:id/champion

GET  /projects/:id/composition
```

Streaming:

```text
GET /experiments/:id/events
```

Potential SSE/WebSocket event types:

```text
candidate.created
candidate.killed
candidate.advanced
candidate.elite
hypothesis.updated
champion.changed
knowledge.updated
experiment.stopped
composition.changed
```

---

# 60. Event model

Internal events:

```text
ExperimentCreated
HypothesisProposed
CandidateCreated
CandidateEvaluationStarted
EvidenceRecorded
CandidateEliminated
CandidateAdvanced
EliteSelected
ChampionSelected
KnowledgeClaimAdded
KnowledgeClaimSuperseded
EvidenceInvalidated
PromotionStarted
PromotionSucceeded
PromotionRolledBack
CompositionChanged
```

Events aid auditability and Knowledge reconstruction.

---

# 61. Budget model

Every experiment gets a budget.

```text
max candidate count
max token spend
max sandbox compute
max wall time
max monetary cost
max deep-eval count
```

Track:

```text
cost per candidate
cost per surviving candidate
cost per 1% improvement
cost per useful Knowledge claim
```

The Orchestrator should stop when expected value falls below expected cost.

---

# 62. Quality metrics for ACE itself

ACE must evaluate ACE.

Platform KPIs:

```text
Time-to-Champion
Cost-to-Champion
Compute avoided vs full-CI baseline
Champion improvement
False elimination rate
Bad promotion rate
Rollback rate
Evidence reuse rate
Knowledge reuse rate
Repeated-failure rate
Candidate diversity
Agent/model utilization
Time to first useful result
```

One of the most important:

```text
Repeated-failure rate
```

If Knowledge works, agents should stop repeatedly rediscovering the same bad strategies.

---

# 63. Benchmark against Git + CI

Create a formal benchmark suite.

For each task:

```text
Baseline:
N candidate branches
full CI each

ACE:
same N candidate proposals
progressive evaluation
```

Compare:

```text
wall-clock
compute seconds
monetary cost
best solution quality
failures discovered
time to first valid candidate
time to best candidate
stored bytes
human review effort
```

This is required to prove ACE's central efficiency claim.

---

# 64. Open architecture decisions

These must be explicitly resolved during implementation.

## OD-001 Cell granularity

What is the minimum practical Cell?

Avoid both:

```text
entire monolith
```

and:

```text
every function is a Cell
```

---

## OD-002 State strategy

For each data system determine:

- snapshot,
- copy-on-write,
- event replay,
- synthetic fixture,
- read-only production mirror.

---

## OD-003 Oracle authoring

Who creates and reviews Oracle definitions?

---

## OD-004 Knowledge claim promotion

How much Evidence is required before an observation becomes:

```text
PROVEN
REJECTED
LIKELY
UNKNOWN
```

---

## OD-005 Fast Judge calibration

How are probabilities calibrated by:

- domain,
- language,
- Cell type,
- failure class?

---

## OD-006 Statistical racing

What confidence bounds permit early termination?

---

## OD-007 Champion selection

When do we choose one Champion versus maintain multiple runtime variants?

---

## OD-008 Recombination

How do we represent reusable traits beyond source diffs?

---

## OD-009 Cross-Cell changes

How are experiments handled when a hypothesis legitimately requires changing multiple Cell contracts?

---

## OD-010 Human approval policy

Which risk classes may ever auto-promote?

---

## OD-011 Knowledge compression

How do we summarize millions of Evidence records without losing critical negative knowledge?

---

## OD-012 Artifact retention

When is losing candidate source deleted versus archived?

---

# 65. V0.1 technical stack

Recommended:

```text
Core:
Rust

Cloudflare:
Workers
Workflows
Queues
Durable Objects
D1
R2
Sandboxes
Vectorize
Workers Analytics Engine
Artifacts

Orchestration/UI:
TypeScript

Dashboard:
React-based stack suitable for Workers

IDE:
VS Code extension first

Agent protocol:
MCP

Fast Judge:
Cloudflare Workers AI: Clef-flash (default) + Clef (escalation), via portable `FastJudge` adapter

Source interoperability:
Git-compatible Artifacts
```

---

# 66. Local developer experience

Desired:

```bash
git clone ace
cd ace

pnpm install
cargo build

ace init demo
ace cell add examples/function-optimization/cell.yaml
ace intent create examples/function-optimization/intent.yaml

ace experiment run
ace status
ace champion
ace knowledge
ace explain C-123
ace replay C-123
```

Cloud execution:

```bash
ace login
ace deploy-control-plane
ace experiment run --cloud
```

---

# 67. First example Cell

Choose a target that is:

- deterministic,
- benchmarkable,
- isolated,
- cheap to execute,
- easy to verify.

Good examples:

```text
JSON transformation
search ranking function
routing algorithm
batching strategy
parser/tokenizer
cache policy
```

Avoid for the first MVP:

```text
authentication
payments
database migrations
distributed transactions
```

The first demo should optimize a measurable property without ambiguity.

---

# 68. First milestone acceptance criteria

ACE Alpha is successful when all of the following work:

1. A developer defines one Cell.
2. A developer submits one Intent.
3. Two different agent generators can produce candidates.
4. At least 100 candidates can be handled in one experiment.
5. Candidates are isolated from canonical code/state.
6. L0 rejects invalid candidates without full sandbox evaluation.
7. Surviving candidates execute against the same harness.
8. Evidence is persisted immutably.
9. A deterministic Policy Engine produces finalists.
10. A Champion can be reproduced.
11. Failed approaches appear in Knowledge.
12. A subsequent experiment can query and use that Knowledge.
13. Champion source can be materialized into Artifacts.
14. IDE/dashboard shows the hypothesis leaderboard and Champion.
15. ACE demonstrates lower total evaluation compute than running the full test suite against all 100 candidates.

---

# 69. Second milestone acceptance criteria

ACE Beta should add:

1. 1,000-candidate experiments.
2. Successive halving.
- Clef-flash L1a and optional Clef L1b, calibrated against real ACE code evaluations.
4. Multi-model competition.
5. Strategy clustering.
6. Parent/child Knowledge Nodes.
7. Replay Evidence.
8. Shadow execution.
9. Cell-level canonical composition.
10. Gradual Champion deployment.
11. Automated rollback.
12. Model × domain analytics.

---

# 70. Product terminology

Official vocabulary:

```text
ACE
Agentic Code Evolution

ACE Project
ACE Cell
ACE Intent
ACE Hypothesis
ACE Experiment
ACE Candidate
ACE Evidence
ACE Knowledge
ACE Elite
ACE Champion
ACE Composition
ACE Oracle
ACE Evaluator
```

Avoid centering product language around:

```text
branch
pull request
merge
commit
```

unless interacting with Git compatibility.

---

# 71. CLI vocabulary

Initial commands:

```text
ace init
ace cell
ace intent
ace run
ace status
ace hypotheses
ace candidate
ace elites
ace champion
ace knowledge
ace explain
ace evidence
ace replay
ace composition
```

Potential:

```text
ace evolve SearchRanking
```

---

# 72. Core product statement

> **ACE is an agentic experimentation and software evolution system that generates competing implementations, evaluates them progressively, preserves evidence from both success and failure, and promotes the best qualified implementation as the current Champion.**

Shorter:

> **Software that competes, learns and improves.**

---

# 73. Architectural statement

```text
Git preserves changes.

ACE preserves learning
and materializes the best-known software.
```

The two can coexist.

---

# 74. Immediate build backlog

Start in this order.

### Epic A — Domain kernel

- [ ] Create monorepo
- [ ] Create Cargo workspace
- [ ] Define canonical IDs
- [ ] Define CellSpec
- [ ] Define Intent/EvalSpec
- [ ] Define Hypothesis
- [ ] Define Candidate
- [ ] Define Evidence
- [ ] Define Knowledge
- [ ] Define Champion
- [ ] Define Composition
- [ ] JSON schemas
- [ ] hashing/provenance
- [ ] Policy Engine v0
- [ ] local serialization tests

### Epic B — Local experiment engine

- [ ] local candidate registry
- [ ] patch application
- [ ] command harness
- [ ] deterministic measurement
- [ ] parallel local runner
- [ ] result taxonomy
- [ ] selection
- [ ] Knowledge generation
- [ ] replay selected candidate
- [ ] CLI

### Epic C — Cloud control plane

- [ ] MCP Gateway Worker
- [ ] Control API
- [ ] D1 schema
- [ ] R2 evidence storage
- [ ] Experiment Workflow
- [ ] Experiment Durable Object
- [ ] Queue topology
- [ ] result aggregation
- [ ] event stream

### Epic D — Sandboxed evaluation

- [ ] base sandbox image
- [ ] Cell snapshot mount/materialization
- [ ] candidate patch application
- [ ] resource limits
- [ ] default-deny network
- [ ] test harness
- [ ] execution metrics
- [ ] cleanup
- [ ] build cache

### Epic E — Fast evaluation

- [ ] L0 static evaluator
- [ ] FastJudge trait
- [ ] Workers AI binding and access/quota setup
- [ ] Cloudflare Clef-flash adapter (`@cf/cloudflare/clef-flash`)
- [ ] Cloudflare Clef escalation adapter (`@cf/cloudflare/clef`)
- [ ] Versioned question schema (`noul`/`choice`/`score`)
- [ ] FastJudge response validation and provenance
- [ ] L1 fallback on timeout/quota/error
- [ ] False-elimination audit cohort and baseline without L1
- [ ] calibration dataset
- [ ] threshold policy with no uncalibrated correctness claims
- [ ] dynamic Clef escalation on uncertainty/risk
- [ ] known-failure similarity
- [ ] novelty
- [ ] information-gain experiment

### Epic F — Knowledge

- [ ] Evidence index
- [ ] knowledge claims
- [ ] evidence links
- [ ] Knowledge parent inheritance
- [ ] Vectorize indexing
- [ ] query_knowledge
- [ ] stale Evidence rules
- [ ] summaries with traceability

### Epic G — Multi-model

- [ ] generic Generator interface
- [ ] Codex adapter
- [ ] Claude adapter
- [ ] Grok adapter
- [ ] competition scheduling
- [ ] provenance
- [ ] per-model metrics

### Epic H — Human experience

- [ ] dashboard shell
- [ ] experiment live view
- [ ] hypothesis leaderboard
- [ ] candidate Evidence page
- [ ] Evolution Graph
- [ ] Composition view
- [ ] VS Code extension
- [ ] Ask ACE

### Epic I — Production lifecycle

- [ ] Champion Artifact creation
- [ ] production version mapping
- [ ] shadow mode
- [ ] canary
- [ ] promotion policy
- [ ] rollback
- [ ] state compatibility declaration

### Epic J — Benchmark

- [ ] define Git+CI baseline
- [ ] run 100-candidate comparison
- [ ] run L1-bypass and L1a/L1b ablations
- [ ] measure false negatives and winner recall
- [ ] measure compute
- [ ] measure time
- [ ] measure solution quality
- [ ] publish benchmark report

---

# 75. First engineering decision record

**ADR-001: Git is a compatibility/persistence layer, not ACE's primary domain model.**

Decision:

Candidate experimentation is represented by ACE primitives:

```text
Intent
Hypothesis
Experiment
Candidate
Evidence
Knowledge
Champion
```

Git/Artifacts is used for durable qualified states and interoperability.

Rationale:

A high-volume agent swarm produces far more transient candidate states than are useful as permanent branches/commits.

---

# 76. Second engineering decision record

**ADR-002: Rust owns deterministic ACE core logic; TypeScript owns Cloudflare orchestration.**

Rationale:

- strong type system,
- reproducible policy logic,
- performance,
- native + WASM portability,
- Cloudflare's strong TypeScript integration for orchestration and Sandbox control.

---

# 77. Third engineering decision record

**ADR-003: Evidence is immutable; Knowledge is derived and versioned.**

Rationale:

Knowledge summaries may change.

Observations must remain reproducible and auditable.

---

# 78. Fourth engineering decision record

**ADR-004: Candidate agents never write canonical state directly.**

All promotion flows through:

```text
Candidate
→ Evidence
→ Evaluation
→ Policy
→ Promotion
```

---

# 79. Fifth engineering decision record

**ADR-005: The evaluator is layered and progressively expensive.**

Never run full CI blindly for every candidate.

---

# 80. Sixth engineering decision record

**ADR-006: A fast probabilistic judge is a filter, not proof.**

Cloudflare Clef-flash/Clef may rank, triage and—only under calibrated, audited rules—deprioritize candidates; a probabilistic score is not functional correctness. The independent Oracle, execution evidence and deterministic policy remain authoritative. Audit false eliminations and permit uncertain candidates to escalate to real tests.

---

# 81. Seventh engineering decision record

**ADR-007: Champion and Knowledge are separate.**

Champion:

```text
best implementation currently qualified
```

Knowledge:

```text
what the system has learned
```

The Champion can change or regress.

Knowledge should generally become richer over time.

---

# 82. Eighth engineering decision record

**ADR-008: The canonical production release is a composition of Cell Champions.**

This allows local evolution and narrow rollback.

---

# ADR-009 — Cloudflare Clef is ACE's default probabilistic evaluator

**Status:** Accepted for implementation (2026-10-05). Supersedes the earlier TypeSafe/Jev integration plan; preserves ADR-006.

## Decision

1. Use **Workers AI `@cf/cloudflare/clef-flash`** as the primary **L1a** fast decision model for candidate triage.
2. Use **Workers AI `@cf/cloudflare/clef`** selectively as **L1b** for uncertain, sensitive or strategically promising candidates.
3. Keep `ace-eval` / `FastJudge` **provider-agnostic**, with model-specific adapters outside the canonical Rust policy kernel.
4. Return typed probability distributions and rubrics only; **never call them deterministic correctness percentages**.
5. Preserve **L0 static hard gates, L2 targeted execution, L3 hidden Oracle/security/integration testing**, and progressive shadow/canary promotion.
6. Record the input/question/answer fingerprints, model name/revision (if available), calibration identifier, threshold policy and inference cost/latency for every decision.
7. A statistically monitored holdout of otherwise filtered candidates must bypass the fast judge for deeper testing, measuring whether Clef incorrectly excludes potential winners.
8. A Clef outage must not be mistaken for candidate failure. Use fallback, bounded retries, backpressure or pause.

## Reasoning

This makes Cloudflare the default **hosting platform for ACE's evaluator, inference and control plane** and eliminates the extra online dependency on TypeSafe's Jev. The models are still probabilistic and may change in quality on domain-specific tasks. A second-stage model should be used only where it adds predictive value that outweighs the extra cost and latency.

## Validation required before production thresholds

- [ ] Generate a stratified corpus of real passing, failing, near-duplicate, novel and adversarial Candidate/Evidence pairs.
- [ ] Compare L1a against L1a+L1b and an **L1-bypass** evaluation baseline on the same candidate population.
- [ ] Calibrate probabilities by Cell family, programming language, test failure class and input size.
- [ ] Measure recall for eventual winner candidates; false-elimination rate is more important than raw classification accuracy.
- [ ] Run load/latency/price tests with actual Workers AI bindings and project limits; measure p50/p95 and throughput.
- [ ] Verify ROI: reduced *end-to-end* cost-to-Champion, not just cheaper model invocation.
- [ ] Version and freeze accepted question schemas/policies and preserve the exact source Evidence.

---

# 83. Current external-platform assumptions

These platform assumptions were checked against Cloudflare documentation on **2026-10-05** and must be revalidated during implementation:

1. Cloudflare Workers supports Rust through `workers-rs`.
2. Cloudflare Sandboxes provide isolated execution for untrusted/model-generated code and support container-based and Dynamic Worker execution models.
3. Cloudflare Artifacts provides Git-compatible versioned storage and is currently in open beta (announced 2026-10-01).
4. Artifacts can be managed programmatically and integrated with Workers.
5. Cloudflare has Queues, Workflows, Durable Objects, D1, R2, Vectorize and Workers for Platforms suitable for the proposed control/data-plane architecture.
6. Cloudflare Workers AI hosts **`@cf/cloudflare/clef-flash` (9B)** and **`@cf/cloudflare/clef` (27B)**. Use `env.AI.run()` with the corresponding `model` selector (`clef-flash`/`clef`). Both accept a `state` and up to 64 typed questions. Their published performance benchmarks are **not** proof of accuracy, latency or cost for ACE's code-evaluation workload.
7. Infrastructure can be hosted on Cloudflare, but external candidate generators (Codex/Claude/Grok) may still depend on non-Cloudflare AI services. Calling ACE a 100%-Cloudflare **backend** must not be confused with vendor-neutral agents also being hosted there.

Keep adapters around vendor-specific services so ACE core concepts remain portable.

---

# 84. References

Cloudflare Workers — Rust  
https://developers.cloudflare.com/workers/languages/rust/

Cloudflare Workers  
https://developers.cloudflare.com/workers/

Cloudflare Sandboxes  
https://developers.cloudflare.com/sandbox/concepts/

Cloudflare Artifacts  
https://developers.cloudflare.com/artifacts/

Cloudflare Artifacts — how it works  
https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/

Cloudflare Artifacts — build and deploy  
https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/

Cloudflare Workers for Platforms  
https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/

Cloudflare Clef and Clef-flash release, API type definitions and examples  
https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/

Workers AI — Clef model and pricing  
https://developers.cloudflare.com/workers-ai/models/clef/

Workers AI — Clef-flash model and pricing  
https://developers.cloudflare.com/workers-ai/models/clef-flash/

Cloudflare — Clef technical background and published benchmarks  
https://blog.cloudflare.com/clef-decision-models/

Workers AI — setup and bindings  
https://developers.cloudflare.com/workers-ai/configuration/bindings/

---

# 85. Next action

Create the repository and implement **Phase 0 — Domain Kernel** first.

The first code to write should not be the dashboard, Cloudflare orchestration, or model connectors.

It should be the canonical Rust types and schemas for:

```text
Cell
Intent
Hypothesis
Experiment
Candidate
Evidence
Knowledge
Champion
Composition
Environment
OracleResult
PolicyDecision
```

If these abstractions are correct, Cloudflare and agent integrations become implementation details.

If these abstractions are wrong, no amount of infrastructure will rescue ACE.

---

**ACE — Agentic Code Evolution**  
*Software that competes, learns and improves.*
