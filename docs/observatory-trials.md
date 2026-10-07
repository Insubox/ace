# Run a proposal from the Observatory

Sign in, choose **new project**, and give your private project a portable name.
Open **Trials**, describe the hypothesis, and paste WAT source. The example button supplies a real implementation you can inspect and change.
Select Gcd, MaxU32 or MinU32 before entering the proposal. Nothing
runs until you select **Run on server**.

ACE compares one manual proposal with a reference for its selected Cell. Export
`gcd`, `max_u32` or `min_u32`, respectively, with ABI `(i32, i32) -> i32` and
unsigned 32-bit inputs and results. Each Cell has its own independent oracle.
Signed maximum/minimum implementations fail checks containing inputs above
`i32::MAX`; a matching export name alone does not qualify code. A
trusted embedded assembler compiles WAT as data. Fresh containers have no network
access and run as an unprivileged user. The Wasmi evaluator rejects host imports
and checks public and deterministic hidden cases against an independent host
oracle, with fuel, memory and wall-clock limits. The fixed evaluation profile
uses at most 60 seconds per evaluator. Native timing is recorded separately;
the optimization objective is measured Wasmi instruction fuel.

Progress survives leaving the page. Completed trials publish an ACE native
evaluation version containing the reference and proposal sources and modules,
every observation, the policy decisions, the local Champion and retained
learning. A losing proposal remains downloadable. This is an evaluated local
Champion, not an application deployment or proof about other workloads.

Invalid assembly or infrastructure failures retain the original proposal and an
audit event without assigning a new correctness verdict. **Inspect original
proposal** retrieves the exact saved input. **Retry retained proposal** repairs
a failed workflow under the same experiment identity. Already completed
distributed evaluations are reused; their timestamps and observations remain
unchanged. Editing the source creates a new trial. A timed-out HTTP submission
can be retried with the same request UUID and exact source, without duplication.

Only project owners and writers with a writable workspace account can submit or
retry. Project readers can inspect progress, source and learning. Unjoined
administrators cannot read private project trials. Execution continues under
the accepted request after the submitting session ends.

The current workspace-wide daily limits are eight new manual trials and sixteen
actual assembly/archive container attempts. Each phase allows at most one retry.
The existing distributed evaluator separately limits each candidate and
aggregation to three attempts. These are execution bounds, not a dollar estimate.
LLM generation and independent snapshot verification have separate budgets.

API routes:

| Route | Operation |
| --- | --- |
| `GET /v1/projects/:project/trials` | Latest 100 trials and declared limits |
| `POST /v1/projects/:project/trials` | `{request_id: UUID, wat, strategy, cell?: Gcd|MaxU32|MinU32}` |
| `GET /v1/projects/:project/trials/:id` | Status, evaluation progress and native version |
| `GET /v1/projects/:project/trials/:id/proposal` | Exact retained original source |
| `POST /v1/projects/:project/trials/:id/retry` | Repair a failed workflow, empty body |

Caller-supplied outcomes, measurements, oracle settings and additional fields
are rejected. The `EXP-OBS-` namespace is reserved for trusted server assembly.
Manual generator provenance remains a declared authorship label.

## Validation

On 2026-10-07, two real Cloudflare trials in `observatory-v04` completed their
assembly, distributed evaluation, native publication, download and independent
Rust replay. The Euclidean proposal qualified and reduced mean instruction fuel
from **1193.3333** for the declared reference workload to **37.75**. An addition
proposal failed the independent correctness check; its exact source and all
evidence were retained. These values describe this profile only.

The initial archival attempts exposed a missing-module reconstruction defect.
After correction, both trials recovered under their original experiment IDs
without re-running the completed candidate evaluations. Browser checks cover
private project creation, owner/reader controls, retrying an interrupted HTTP
submission, mobile layout, inert source previews and clearing private data on
logout. Browser account mutations use an isolated transport fixture; the cloud
evaluation and native replay above use the actual deployed services.

Read an existing trial without starting new paid work:

```sh
node scripts/check-observatory.mjs --project observatory-v04
```

For a deliberately requested end-to-end test, `--request --kind euclid` submits
one bounded trial. Add `--output` with a fresh directory and `--ace` pointing to
the current CLI to download and replay it. `--kind addition` checks losing-code
retention. Use `--id` and `--wait` to inspect an existing pending request.

Current limits: three bounded mathematical Cells, one manual proposal per trial, a fixed reference rather
than automatic inheritance of the previous Champion, no hosted general-language
builds and no automatic production rollout.

The request defaults to Gcd for compatibility. Selecting another Cell changes
the ABI, oracle, intent and learning context together. Legacy Gcd configuration
serialization and native version identities are preserved. Cross-Cell Champion
inheritance and incompatible retrieved memory are rejected. Automatic grammar
generation remains Gcd-only; manual proposals and agent tasks support all three.

To validate a selected unsigned Cell with one deliberately requested trial:

```sh
node scripts/check-observatory.mjs --request --cell MaxU32 --output fresh-max --ace target/debug/ace
```

For MaxU32/MinU32, `--kind addition` instead tests an incorrect signed comparison;
it does not implement addition. The checker asserts rejection and retained
source before independent replay.

The deployed evaluator with binary SHA-256
`6e0bfca4c74284f3dfac890a40a9ca013b152845c0c7797267203e7930fa6ffa`
completed two additional real trials on 2026-10-07: MaxU32 unsigned selection
qualified with mean fuel 7, tied its reference, and retained the reference as
Champion; MinU32 signed comparison failed correctness and retained its source
and negative observations. Both native versions downloaded and reproduced in
independent Rust replay. A correct proposal is not necessarily an improvement.
