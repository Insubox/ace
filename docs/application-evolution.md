# Agent evolution of complete applications

Observatory's Applications view can start a bounded Workers AI campaign from an
existing **server-tested** Hello World, TicTacToe or Calculator run. Select the
baseline, Qwen or Llama, at most four rounds, a patience limit and an optional
result branch. The campaign continues on the server if the page closes. Writers
can stop future attempts; an attempt already running retains its result.

Each generation receives the exact retained application, its fixed public
contract, test outcomes and scoped learning from preceding proposals. Source,
agent strategy and provider output are untrusted. The model may propose changes
to `main.py` and `core.py` for Python or `src/main.cjs` and `src/core.js` for JavaScript; it cannot replace manifests, dependency locks, tests,
reports or verdicts. Raw context, request, response and normalized proposal/fault
are retained with source and ancestry in ACE's native engine.

Every distinct valid proposal consumes a fresh offline application container.
The independent evaluator compiles and runs the public suite, retaining both
successful and unsuccessful code. ACE accepts a new best version only when it
passes strictly more cases **and preserves every previously passing case**.
Ties do not churn the best source. Duplicate proposals and provider faults are
recorded without repeating candidate execution. Faults do not prove code incorrect.

The objective is public-suite correctness. A baseline already passing all cases
stops with no inference or container call. The campaign does not assert speed,
universal correctness, hidden-test success or production promotion. This is a
repair/evolution workflow, rather than an unmeasured quality ranking.

Campaigns stop on full success, stagnation, model-budget exhaustion, cancellation
or the round limit. Application attempts share the existing daily request and
container budgets; actual model attempts share the generator budget. There are
no automatic paid inference or candidate execution retries. Publication repair
uses retained generation/result bytes. Account role and project write access
are checked again during execution.

The final native version contains best source and `campaign/learning.json` with
all proposal references and accepted/rejected outcomes. An optional branch moves
only for a fully passing result and only if its head still matches the tested
baseline or it is a new branch. Concurrent contributor work is preserved.
Campaign records and native learning are included in private backups.

From a source checkout, an authenticated developer can also use:

```sh
node cloud/scripts/application-evolve.mjs --project my-project \
  --baseline app-<completed-run-hash> --model qwen --rounds 2 \
  --patience 2 --branch agent-result
```

Use `--resume campaign-<hash>` to observe the same campaign without starting
another. Credentials use the existing `ACE_API_URL` / `ACE_API_TOKEN` client
configuration; never put tokens in source files or command arguments.

Project APIs:

- `GET/POST /v1/projects/:project/application-campaigns`
- `GET /v1/projects/:project/application-campaigns/:id`
- `POST /v1/projects/:project/application-campaigns/:id/cancel` (empty body)

Apply migration `0011_application_campaigns.sql` and bind
`APPLICATION_CAMPAIGNS` to `ApplicationCampaignWorkflow` before deployment.

## Recorded live validation

A real Qwen campaign improved a deliberately incorrect calculator from 0/29
to 28/29 public cases. Later proposals tied at 28/29 and were rejected as
improvements. Source, raw generation records and losing/winning learning were
retained. The result branch did not move because the boolean-operand test still
failed. A subsequent adapter revision makes that existing contract explicit in
the system prompt; no claim is made that this revision has produced a fully
passing real model candidate. Provider quality and full correctness remain
distinct from the functioning campaign/evaluation pipeline.

## Measuring retained outcomes

`application-evolve.mjs --learning-mode outcomes` supplies recorded case outcomes
and prior rounds (the default). `--learning-mode contract_only` keeps the same
source, fixed public contract, model settings and evaluator, but removes evaluator
outcomes from the generator prompt. Both modes still independently evaluate every
new proposal and enforce the same strict gain and regression rules.

A bounded comparison starts two one-round real-model campaigns without advancing
any branch:

```sh
node cloud/scripts/application-learning-compare.mjs --project my-project \
  --baseline app-<completed-failing-run> --model qwen \
  --state /private/learning-comparison.json --run
```

Repeat the command with the same private state to resume admission after an
interruption. Omit `--run` to inspect both campaigns without admitting new work.
Each pair needs up to two model calls and two remaining container reservations.
A baseline from an older evaluator must first be replayed; exhausted replay or
trial budgets are not bypassed. Generator faults and incomplete executions do not
produce a gain comparison. Native campaign summaries retain the mode and the
winning and losing observations. A single pair records an observed difference,
not a causal or general claim that learning improves models.
