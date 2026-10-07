# Measured reuse of retained learning

Run the offline comparison after building the CLI:

```sh
cargo build --locked -p ace-cli
node scripts/check-learning.mjs --ace target/debug/ace --output fresh-learning-comparison
```

The script first evaluates an addition proposal and recursive Euclid, retaining
both the failure and the qualified source in ACE's native history. It retrieves
only learning compatible with the baseline's Cell, project, intent, evaluation
specification and recorded execution environment.

Both comparison arms then receive the same fixed pool: addition, iterative
Euclid and recursive Euclid. Each can evaluate two proposals plus the reference.
The arm without memory takes the first two proposals. The arm with memory
prioritizes the exact recorded qualified source and excludes exact artifact
hashes with resolved negative observations in this context. Every selected
proposal is evaluated again; prior qualification never substitutes for a fresh
measurement.

On the Linux development host on 2026-10-07:

| Arm | Qualified proposals | Rejected proposals | Best mean instruction fuel |
| --- | ---: | ---: | ---: |
| Without retained memory | 1 | 1 | 37.75 |
| With retained memory | 2 | 0 | 23.5 |

The best observed fuel decreased by about 37.7% with the same comparison budget.
Training has its own cost and is recorded separately. All three resulting
evaluation snapshots were downloaded from the local native store and replayed
by the independent verifier with matching deterministic observations. The script
writes the selected identities, source hashes, evidence and results for review.
No paid provider or model calls are required.

This tests a fixed pool and an explicit reuse policy, not whether an LLM learns
to generate better novel programs. A known winner is available in both pools;
the measured benefit comes from selecting it and avoiding an already observed
failure. The result does not establish generalization to other Cells, providers,
workloads or wall-clock production latency. The automatic agent path separately
passes compatible retained learning to its generator and re-evaluates proposals.
