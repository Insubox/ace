# Diverse live calibration — 2026-10-07

Cloudflare completed experiment
`EXP-36a011208b918caa9933f9c0506956030cd2be02694a0358ca457a3b3f926035`.
All 25 independently hashed WASM artifacts executed. The downloaded run passed
Rust artifact, evidence-seal, provenance, environment and policy validation.
Both distributed and independent local integration runs produced 13 qualified,
10 correctness failures and two bounded resource failures. Evaluation performed
6,305 checked calls; every qualified implementation passed all 480 calls.

Recursive remainder candidate `C-v09` became Champion at 19 mean Wasmi fuel per
public-workload call, compared with the bounded divisor-search reference's
1,248.642857: approximately 98.5% less fuel on this workload. This is not a
general CPU speedup or a model-induced improvement. The models did not generate
or select implementations. Actual 100-container concurrency remains unverified.

## Inputs and split

[The static corpus](../examples/judge-corpus/README.md) includes twelve intended
correct algorithms, ten semantic mutations and two resource mutations. Its build
rejects duplicate optimized modules. [Build metadata](validation/diverse-v1/build-manifest.json)
records compiler, flags and source hashes; it is not independently attested
source-to-WASM provenance. [Context freezing](validation/diverse-v1/context-freeze.json)
occurred before the local run and cloud submission. Requests include source,
public contract, neutral identities and optimization intent, with no test cases,
Oracle seed, outcomes, family, split or failure references.

Eight candidate IDs were reserved before execution: v03, v06, v09, v12, v15,
v18, v21 and v24. Sixteen form development; the reference belongs to neither
subset. No thresholds were tuned on either subset. This handcrafted holdout
shares families with development. Eight examples do not establish statistical
generalization or independence from provider training data.

## Policy comparison

All 25 Flash and 25 Clef responses were retained without faults and their
context/request/raw-response/attempt hashes verified. Default
`shadow-routing-v1` thresholds and deterministic 10% audit remained unchanged.
These are offline policy replays on the same sealed labels. All real evaluations
already ran. Telemetry includes only opinions each route actually reaches.

| Population | Route | Hypothetical filters | Qualified retained | Champion retained | Included attempts | Input tokens | Recorded latency sum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| All 25 | Bypass | 0 | 13/13 | 1/1 | 0 | 0 | 0 ms |
| All 25 | Flash | 1 | 13/13 | 1/1 | 25 | 20,672 | 5,144 ms |
| All 25 | Flash + Clef | 2 | 13/13 | 1/1 | 27 | 22,280 | 5,799 ms |
| Development 16 | Flash | 1 | 8/8 | absent | 16 | 13,086 | 3,322 ms |
| Development 16 | Flash + Clef | 1 | 8/8 | absent | 17 | 13,882 | 3,710 ms |
| Holdout 8 | Flash | 0 | 4/4 | 1/1 | 8 | 6,721 | 1,350 ms |
| Holdout 8 | Flash + Clef | 1 | 4/4 | 1/1 | 9 | 7,533 | 1,617 ms |

Flash would filter only `C-v20` (addition). The combined route also filters
`C-v15` (a zero-input bitwise mistake). Eight other semantic failures and both
resource failures remain for real evaluation. Flash's regression Brier score
is 0.280352 over 23 semantic rows, compared with 0.021388 in the earlier
six-artifact illustration. Holdout Brier is 0.233075 over seven semantic rows.
Lower is better; resource failures are excluded. Preserving this Champion does
not establish dependable triage. Production filtering remains disabled and
bounded execution with the independent Oracle remains necessary.

Development contains no global Champion, so its Champion recall is null.
The corpus holdout and routing audit are separate: the audit retains three
artifacts overall, including one in the holdout. Two second opinions were
requested, with no missing telemetry or provider faults. The other 23 Clef
opinions remain available but are excluded from combined-route totals.

## Artifacts and limits

[Interactive offline comparison](validation/diverse-v1/comparison.html) and
JSON reports for [all artifacts](validation/diverse-v1/all-comparison.json),
[development](validation/diverse-v1/development-comparison.json) and
[holdout](validation/diverse-v1/holdout-comparison.json) are committed, alongside
their calibration reports. [The evidence index](validation/diverse-v1/evidence-index.json)
records run/environment hashes, per-candidate outcomes, evidence hashes and
all 50 remote judgement IDs/document hashes. Full sealed runs and provider
documents remain in R2 and under
`/workspace/.ace-env/cloud-deployment/diverse-v1-*` in this environment.

Actual collection used 20,672 input tokens per model (41,344 total), with zero
reported output tokens. At documented input prices of $0.09/M for Flash and
$0.24/M for Clef, the input-only estimate is $0.00682176. It is not a bill and
excludes cloud infrastructure costs. Actual collection included all second
opinions, rather than only the two reached by the replay. Recorded latency
sums are neither wall-clock duration nor measured time to Champion. No
execution saving, causal ROI or production filtering is claimed.

Validation passed: 75 Rust tests, 18 Worker tests, eight Node integrity tests,
Clippy, formatting, TypeScript, portable WASM builds and all 31 schema checks.
Corpus integration passed on local and distributed runs. Batch resume verified
all 50 complete records without new inference. CI compiles distinct corpus
artifacts, executes them and checks outcomes and complete workloads. No Worker
redeployment was needed; the existing WASM and judge protocols serve this work.
