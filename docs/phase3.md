# Phase 3 — advisory judge and calibration foundation

This milestone adds a provider-neutral `ace-eval` Rust library and a Workers AI
adapter for `@cf/cloudflare/clef-flash` (L1a) and `@cf/cloudflare/clef` (L1b).
It runs in shadow mode: advice can request a second opinion but cannot reject,
qualify or promote candidates. The distributed evaluator continues to execute
every registered candidate through Wasmi and deterministic Rust policy.

## Questions and routing

`gcd-triage-v1` asks four typed questions: behavior-change risk and similarity to
known failures (`noul` probabilities), architectural fit (`choice`) and strategy
novelty (`score`). Model IDs, typed request/response contracts and input prices
were checked against the official Cloudflare model catalog:
[Clef-flash](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/clef-flash.json)
and [Clef](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/clef.json).

Rust validates probabilities and distributions before routing. L1a uncertainty
or declared high impact requests L1b; L1b always continues to real execution.
A deterministic 10% audit cohort, keyed by artifact hash, bypasses escalation
and retains clones in the same cohort. Errors, timeouts, malformed answers and
exhausted inference budgets continue to real execution. High predicted risk is
recorded as a hypothetical filter for calibration only.

The live provider rounds outputs to four decimal places. Adapter v2 accepts a
residual of at most 0.0005 in probability sums and weighted scores, then
renormalizes the distributions. Raw values remain retained, the adapter version
participates in cache identity and calibration cohorts, and Rust still requires
normalized distributions to sum to one within 0.000001. Larger inconsistencies
remain invalid responses.

The Worker accepts contexts only for registered Gcd candidates with the exact
artifact hash. Public summaries are caller assertions; they are not verified
source-to-binary provenance. Reference retrieval requires completed same-Cell
reports, matching Evidence IDs/hashes and deterministic correctness/resource
failures. It excludes the current artifact's own label. It supplies only the
generic outcome and registered strategy, never Oracle messages or hidden inputs.
Use public text only in the summary; candidate text is explicitly treated as data.

## Retained records and limits

Authenticated routes are `POST /v1/judge/flash`, `POST /v1/judge/clef` and
`GET /v1/judgements/<id>[/context|request|response|attempt]`. These are separate
from the four existing MCP read tools. `cloud/wrangler.jsonc` adds the `AI` binding.

R2 retains exact public context, expanded provider request, raw response when
available, normalized attempt, and a manifest with raw SHA-256 fingerprints.
One immutable internal record precedes document publication and the manifest
comes last. Retrying identical context bytes repairs interrupted publication
without repeating an inference already retained. A crash before that record can
spend another attempt after the reservation expires; this is not exactly-once
inference across provider/Worker failures.

A transactional daily coordinator limits actual attempts to 64 across both
models and holds each reservation for 120 seconds. A 10-second response deadline
does not cancel an already-running native provider invocation. Context is bounded
to 32 KiB, each public summary to 8 KiB, expanded requests to 48 KiB and retained
responses to 256 KiB. Byte bounds are not precise tokenizer limits.

Provenance includes model, provider, stage, question version, input/request hashes,
latency and reported token usage. Unreported revision, calibration version or
token usage remain null. Input cost estimates use the catalog's $0.09/M tokens
for Flash and $0.24/M for Clef; they exclude output charges and are not invoices.

## Reproduce a shadow evaluation

Build/install the current CLI and use a verified downloaded distributed run.
Set `ACE_API_URL` and `ACE_API_TOKEN` through secure environment settings. In the
managed environment, use `NODE_USE_ENV_PROXY=1` for Node clients and preserve CA
trust. Each output path must be fresh.

```bash
source /workspace/.ace-env/activate.sh
cd /workspace/ace
cargo install --path crates/ace-cli --locked --debug
node cloud/scripts/judge-context.mjs /path/to/verified-run C-euclid \
  examples/function-optimization/src/euclid.rs /tmp/ace-public-context.json
NODE_USE_ENV_PROXY=1 node cloud/scripts/judge.mjs \
  /tmp/ace-public-context.json /tmp/ace-judge-euclid
ace judge policy
ace judge route /tmp/ace-judge-euclid/context.json \
  /tmp/ace-judge-euclid/flash/attempt.json
```

The client verifies downloaded document hashes and uses Rust routing to request
Clef only when necessary. It records `real_execution_required: true`; it does not
start or skip evaluations. The context helper verifies the saved run first and
uses its IDs and failure references without including its hidden workload.

## Evidence-linked calibration

```bash
node cloud/scripts/judge-calibration.mjs /path/to/verified-run \
  /tmp/ace-calibration /tmp/ace-judge-euclid /tmp/ace-judge-other
ace judge calibrate /tmp/ace-calibration/dataset.json --run /path/to/verified-run
```

Keep L1a and L1b datasets separate. Duplicate artifact hashes, mixed model/stage/
revision/question cohorts, contradictory probabilities and mismatched context
bytes are rejected. Live datasets require `--run`; Rust loads and validates the
source artifacts, sealed evidence and policy decisions, and checks each label,
winner flag and evidence reference against that run. Synthetic datasets are
explicitly marked and cannot establish live performance. Provider records are
trusted observations from the authenticated adapter, not provider signatures.

The report includes regression Brier score, qualified/winner recall under the
hypothetical filter, audit count, p50/p95 inference latency, tokens and provider
faults. Brier scoring compares qualified versus correctness-failed candidates;
contract, resource and infrastructure failures are excluded from that semantic
metric. Missing usage is counted, never treated as free inference.

`production_filtering_authorized` is always false. A handful of known GCD
examples is an integration check, not sufficient calibration for production
thresholds. Model selection with held-out populations, confidence bounds,
information-gain experiments, L1-bypass/L1a/L1a+L1b ablations, measured ROI and a
dashboard remain later Phase 3 work. Source provenance, Vectorize similarity
retrieval and candidate generation remain separate milestones.

## Live integration checkpoint — 2026-10-06

The authenticated deployed Worker completed seven Flash and three Clef requests
with adapter v2, with no provider faults. Six Flash results cover the baseline,
Euclidean GCD, binary GCD, incorrect addition, infinite loop and memory-growth
examples. Binary GCD and the loop escalated because of uncertainty; an additional
declared-high-impact probe exercised the two-stage client. That declaration was
a routing probe, not a production impact assessment.

The six-artifact Flash dataset was verified against the original sealed run.
Its four semantic scoring rows have Brier score 0.0213884875. The hypothetical
threshold retained 3/3 qualified artifacts and 1/1 Champion in these examples.
Flash p50/p95 recorded inference latency was 184/371 ms; 7,917 input tokens and
zero output tokens were reported. No production filtering is authorized.
The ten adapter-v2 records have a summed input-only catalog estimate of
$0.00181353, excluding the initial v1 normalization-fault probe. This does not
establish a cloud invoice, end-to-end latency or cost savings.

An identical Euclid request returned byte-identical cached manifest and retained
documents. Live calibration without a source run and deliberately altered ground
truth were rejected. After deployment, a new six-module distributed experiment
completed, its downloaded artifacts/seals/policy passed Rust validation, and
Euclid remained Champion. Old completed experiment state also remained accessible.
An initial transient 404 during rollout cleared without resetting coordinator
state.

Worker version: `f98df7d8-5fb1-47c8-9563-98da039384a5`.
Evaluator registry digest:
`sha256:d1b545d60ed75281385048cb1845b62623d6ff974b2b024471c2f3b3d017c1e4`.
New experiment:
`EXP-5dfeda429c5e9016cda6a7d5955d0a3ffbc0a40bb57eb45d5f29ee0ba0285bf0`.
Detailed contexts, requests, responses, attempts, calibration and downloaded run
are retained under `/workspace/.ace-env/cloud-deployment/phase3/`.

Local validation passed 69 Rust tests, 18 Workerd tests, Clippy, formatting,
TypeScript checking, all 29 schema checks, portable WASM compilation and the
Docker/Worker builds. These integration results cover known hand-written modules;
they do not demonstrate generalization or statistically reliable winner recall.

## Compare bypass, L1a and L1a+L1b

`ace judge compare` adds an offline comparison on the same unique artifacts and
sealed execution labels. It produces three arms: bypass (all real evaluations),
Flash-only, and Flash with requested Clef second opinions. No candidate is
actually skipped and no new paid inference occurs when building the comparison.

```bash
node cloud/scripts/judge-compare.mjs /path/to/verified-run \
  /tmp/ace-comparison /tmp/ace-judge-euclid /tmp/ace-judge-other
ace judge compare /tmp/ace-comparison/comparison-dataset.json \
  --run /path/to/verified-run
npm run test:clients
```

The client generates a calibrated first-stage dataset, the comparison dataset,
an auditable JSON report and an interactive offline `comparison-report.html`.
Every retained document, including the raw response, is checked against its
manifest hash. Context, model, stage, adapter, question version and request hashes
must agree. Successful records require the raw response. Rust checks each source
label against verified runs and rejects duplicate artifacts, unmatched second
opinions, wrong stages and mixed model cohorts within a stage.

Uncertain or high-impact Flash advice goes to real evaluation if the second stage
is disabled, missing or failed. Missing opinions and telemetry are counted;
missing data never becomes a zero-cost score or grounds for rejecting a candidate.
The audit cohort overrides hypothetical filtering. This differs from the earlier
calibration report's raw threshold recommendation: the comparison applies audit
and routing safeguards before counting hypothetical eliminations. Unrequested
second opinions remain available records but are excluded from an arm's totals.
Custom policies can be compared with `--policy`; newly required but unrecorded
opinions remain explicitly missing, rather than invented.

The first real comparison, based on the six saved GCD artifacts and two matching
Clef opinions, produced:

| Route | Hypothetical eliminations | Qualified retained | Champion retained | Included attempts | Input tokens | Recorded latency sum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bypass | 0 | 3/3 | 1/1 | 0 | 0 | 0 ms |
| Flash only | 1 | 3/3 | 1/1 | 6 | 7,917 | 1,226 ms |
| Flash + Clef | 2 | 3/3 | 1/1 | 8 | 10,585 | 2,462 ms |

Flash's hypothetical filter identifies incorrect addition; the combined arm
also identifies the infinite loop. The memory-growth failure remains unfiltered
by this semantic-risk advice and is still caught by actual bounded execution.
The previously declared-high-impact Euclid probe has different public bytes and
is excluded from this cohort. All six artifacts already have deterministic
evaluation results. The figures summarize stored model responses; they do not
measure three separately executed scheduling strategies, actual execution savings,
full-CI performance or time to Champion. Both measurement flags and
`production_filtering_authorized` remain false. No population-wide reliability
claim follows from preserving one known Champion.

Comparison artifacts are under
`/workspace/.ace-env/cloud-deployment/phase3/comparison-v2/`.
The current library has 31 schemas; this addition passed 75 Rust tests and five
Node client integrity tests, plus Clippy, formatting, TypeScript and portable WASM
checks. This local analysis feature does not require a Worker redeployment.

The [expanded live validation](diverse-validation.md) adds 24 distinct variants,
one reference, public contexts frozen before execution, a predeclared eight-item
holdout and 50 matched real model responses. It exposes substantially weaker
semantic triage on the broader corpus and keeps production filtering disabled.
