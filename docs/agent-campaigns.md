# Agent campaigns with retained learning

ACE can feed a verified ACE winner and evidence-linked observations back into a
coding agent. Each round assembles untrusted GCD WAT, re-evaluates the baseline,
executes independent Oracle/resource checks, selects a qualified Champion and
retains all evaluated outcomes in its native content-addressed version engine.
Git is an optional compatibility export.

The public task contains the ABI, semantics, public cases, resource bounds,
winning WAT and a bounded set of positive, negative and unresolved observations.
It excludes hidden Oracle cases, the Oracle seed and raw correctness diagnostics.
Memory compares only matching project, Cell, Intent, environment and EvalSpec.
Measurements describe the recorded workload; passing it does not prove all inputs.

## Run with your existing coding agent

Install the native ACE executable, then choose fresh folders:

```sh
ace demo baseline --jobs 2 --json
ace agent-start campaign --campaign first-agent --baseline-run baseline/run --store history --rounds 4 --candidates 2 --attempts 3 --patience 2 --jobs 2
ace agent-next campaign
```

Give the returned `task` object to the coding agent. Ask it for a proposal batch
following [the proposal format](agents-and-git.md); keep the contract unchanged.
Save a submission as `submission.json`:

```json
{
  "context_hash": "COPY_THE_TASK_CONTEXT_HASH",
  "proposals": {
    "schema_version": 1,
    "cell": "Gcd",
    "candidates": [
      {
        "id": "C-my-agent",
        "wat": "COMPLETE_IMPORT_FREE_GCD_MODULE_FROM_YOUR_AGENT",
        "strategy": "Describe the proposed algorithm",
        "generator": {"provider": "your-agent", "model": "your-model"}
      }
    ]
  },
  "provider_receipt": null
}
```

The placeholder values above must be replaced with the actual task and source.
Then:

```sh
ace agent-submit campaign submission.json
ace agent-next campaign
ace agent-status campaign
ace memory history --baseline-run baseline/run --limit 16
ace store log history
```

Continue with the next frozen task until `stop_reason` is set. The next task
includes learning from completed rounds. A baseline keeps its source and is
retested even when its candidate ID becomes `C-baseline` in a later round.
Provider metadata and optional receipts are caller assertions; the independent
evaluation establishes candidate outcomes.

If generation fails before evaluation, record `fault.json` with the matching
`context_hash`, `provider_receipt: null` and one of `unavailable`, `timeout`,
`invalid_response`, `invalid_proposal`, `duplicate_proposal`, `budget_exhausted`.
Run `ace agent-fault campaign fault.json`, then `agent-next`. Parsing faults may attach an optional `compiler_diagnostic`
(up to 2,048 bytes), which becomes untrusted debugging data in the next task.
The automatic bridge shares WAT parsing errors; it never forwards hidden Oracle
failure diagnostics. Faults enter native history as
generator events and consume attempt budgets; they never become incorrect-code
observations. A completed evaluation cannot be converted into a generator fault.

Campaigns allow 1–16 rounds, 1–4 proposals per round, 1–3 generation attempts per
round, 1–16 rounds without improvement and 1–8 evaluation jobs. Baseline and
campaign job counts must match. Existing files are retained without overwriting.

## Use Qwen and Llama through Workers AI

This optional path requires a source checkout, Node 24, a matching
ACE 0.3.0 executable, and your deployed authenticated Worker with AI/R2 bindings.
Follow [the deployment guide](phase2.md) first. Configure `ACE_API_URL` with your
Worker origin and `ACE_API_TOKEN` with its bearer token through your secure local
environment or secret manager. Do not commit credentials.

From the checkout:

```sh
node cloud/scripts/agent-evolve.mjs my-agent-campaign --ace /absolute/path/to/ace --rounds 4 --candidates 2 --attempts 3 --patience 2 --models qwen,llama
```

On Windows, use an absolute path to `ace.exe`. Qwen uses
`@cf/qwen/qwen2.5-coder-32b-instruct`; Llama uses
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The current adapter version is
`wat-generator-v4`. Models rotate across rounds and retry attempts. Provider
generation can fail or produce incorrect code; ACE preserves the qualified
baseline and records the outcome.

The Worker separately limits paid generation to 16 attempts per UTC day, with
4,096 output tokens and a 45-second inference deadline per attempt. Local round
and patience limits also apply. These are inference limits, not a dollar price
guarantee. The judge budget is separate.

For each inference, R2 retains the exact public task, provider request, available
raw response, normalized attempt and a file-hash manifest. The bridge downloads
and checks those bytes before submitting WAT to local ACE. Worker authentication
identifies the caller; the supplied local context hash is caller asserted.
The Worker does not replace local evaluation or authenticate arbitrary local Git
history. No application source is promoted or deployed by this command.

## Resume and inspect

After a transport interruption, repeat the bridge command with identical origin,
models, adapter version and bounds, adding `--resume`. Completed campaigns return
their verified status without another inference. Identical provider input reuses
retained results. If a completed evaluation lacks its final step receipt,
resubmitting the same submission repairs that receipt without evaluating again.

The bridge stores `driver.json` without credentials, baseline evidence,
`campaign/`, `history/`, raw `providers/` documents and final `result.json`.
`history/` is a dedicated cloneable ACE native store with winning source, evaluated
losers, evidence and generation faults. See [native versions](native-versions.md) for checkout, clone and optional Git export.

A changed evaluator/environment requires a fresh campaign. An incomplete native
run, incomplete startup or a lock left by abrupt process termination needs
operator inspection; automatic repair of every partial write is not implemented.
Do not delete retained evidence to make verification pass.

## MCP clients

The same workflow is available through `ace_memory`, `ace_agent_start`,
`ace_agent_next`, `ace_agent_submit`, `ace_agent_fault` and `ace_agent_status`.
The start tool takes a campaign name, baseline run name, native store name
and bounds. Campaigns live under `agents/<name>` and stores under
`stores/<name>` inside the explicitly selected MCP workspace. Tool schemas
describe exact arguments. MCP exposes no shell or native candidate compiler.

Development checks include `node scripts/check-agent-driver.mjs target/debug/ace`,
which runs real native evaluations with fixture transport and zero paid calls.
Real-provider results are recorded separately; fixture tests do not establish
model availability or optimization quality.
