# Reuse complete-project evidence

ACE's `ace-self-development` pilot now retrieves passing, failing and incomplete
local runs from its own native history. In Observatory, select the project, open
**Learning**, and choose a **Complete-project learning** reference result. Each
observation links to the exact native result, source, report, logs and learning.
The same read-only interface is available to an authenticated development tool:

```sh
node cloud/scripts/project-learning.mjs --project ace-self-development \
  --baseline <published-complete-project-result-hash> --limit 16
```

The HTTP interface is `GET /v1/projects/{project}/learning?baseline={result}&limit=16`.
Project membership is checked before reading any report; an unrelated account
cannot query a private project. Existing session/operator authentication applies.
Do not put credentials in command arguments or retain them in evidence.

Retrieval verifies native publication, report/source ancestry, file identities,
the protected source tree and inline tests, locked dependencies, log references,
and matching derived learning. A successful label requires all seven completed
checks. Context includes the profile, protected source, inline tests, harness,
image and prepared-tool/dependency hashes. A changed suite, lock, image or tool
cannot silently inherit earlier outcomes. Matching is deliberately conservative:
even a protected documentation change establishes a different frozen profile.

Infrastructure failures remain unresolved observations, not negative code
results. Source and uploaded text are inert data. The response describes
**caller-reported local checks**, never a hosted verification receipt, cryptographic
provider provenance, production approval or universal correctness. Referenced
log hashes identify retained evidence; the query does not replay the evaluator.
Every new proposal still needs a fresh execution.

Each request scans at most 32 native versions, with four concurrent inspections.
It returns at most 32 observations and a `next_before` sequence cursor. Follow
that cursor with `before={sequence}` while retaining the same reference result.
Invalid and incompatible records are counted and excluded. Truncated result
pages do not skip compatible observations. Evidence bodies and source reads are
bounded; the latest 20 loaded Observatory versions determine its reference list.

The first approved capacity correction was freshly tested after the native merge
`137d62190fe0fe2765c91e7c5497ec0d8b0d9b47270b493b0af904c32e0b7632`.
Byte-identical merged source passed 127 Rust, 112 Worker and 23 client tests,
three capacity checks, compilation, TypeScript and schema comparison. The
new result is `f0be64316b077e01c135e451d433c42a5d2c33140eea961fad8d3417ff0858e3`.
A native attestation retains both merge and result parents. The 112 Worker checks
belong to that frozen source; the newer hosting/retrieval suite separately passed
124 tests. These distinct source contexts are not pooled as equivalent results.

This delivers evidence retrieval for the explicit ACE pilot. General task
profiles and measured benefits on fresh, novel agent tasks remain separate
acceptance criteria; displaying old winners does not complete them.
