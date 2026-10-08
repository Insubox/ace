# Stable delivery acceptance

The remaining objectives are evaluated separately. This record does not turn
a partial result into a production qualification.

## Complete task campaigns and measured retrieval

`scripts/application-task.mjs` accepts 1–4 declared proposals for complete Python
Hello World, TicTacToe and Calculator projects. The source is frozen before
testing, dependencies and independent suites are protected, and each proposal
is compiled and tested in an offline Docker container. Invalid generator output
is distinct from incorrect code. Native source, reports, negative learning and
campaign summaries are retained. A branch advances only when the score improves
and every previously passing case remains passing. Passing a fixed public suite
does not qualify general correctness or performance.

Reproduce the controlled task and learning comparison without Cloudflare or
GitHub Actions:

```sh
cargo build --locked -p ace-cli
docker build -f applications/Dockerfile -t ace-applications:local .
node scripts/check-application-tasks.mjs --output /tmp/ace-task-check
```

The fixed fixtures are deliberate greeting and type-validation defects. The
expected observed task scores are Hello World 4/11 → 11/11, TicTacToe 19/20 →
20/20 and Calculator 28/29 → 29/29. A dependency-edit fault and an incorrect
proposal precede each repair. All winners and losers remain in native history.

The retrieval comparison learns a resolved strict-type problem from TicTacToe
and tests fresh Hello World and Calculator tasks. Both alternatives get one
proposal, the same baseline, image and independent suite. Observed scores are
10/11 versus 11/11 and 28/29 versus 29/29. The policy uses evidence only where the
target contract explicitly rejects boolean inputs; selected code is tested
again. This is a controlled benefit of a curated repair policy. It is not an
estimate of general LLM learning, and the supplied proposal identities are
caller declared. Real hosted model comparisons remain subject to spending,
daily quotas and current evaluator evidence.

## Approval and release gate

The v2 local complete-repository profile can capture an original verified native
version with `ace-project.mjs init --origin-store ... --origin-version ...`.
It rejects different materialized bytes and preserves the original version
identity when the source is unchanged. Previous v1 reports retain their original
ancestry rules and evaluator context.

`cloud/scripts/release-plan.mjs` requires an independently merged current `main`
version, all seven exact-source checks, a private operator-pinned evaluator
policy, and an uploaded Worker bound to `RELEASE_SOURCE_VERSION`,
`RELEASE_SOURCE_HASH`, `WORKER_VERSION` and enforced spending control. The plan
also records the provider's immutable script artifact identifier. Uploaded
caller labels cannot substitute for the operator's evaluation record.

`rollout.mjs --plan ...` rechecks the live approval and artifact before assigning
candidate traffic. Every candidate smoke check confirms the actual served
Worker UUID and approved source hash. Approval, branch, image, artifact or
source mismatch stops promotion; recovery to the prior version remains possible
when candidate authorization is lost. Provider writes lack atomic CAS, so
competing deployments stop the flow rather than being overwritten.

Both stable and candidate versions must expose provider version metadata before
the full rollout drill. A legacy Worker without this binding needs a separately
recorded instrumentation migration; its earlier smoke observations are not
proof that a version override was honored. A new merged composition must be
evaluated before a release plan can authorize it.

## Recovery traffic

After an isolated restore completes, an operator can seal readiness with
`POST /v1/backups/<backup-id>/ready`. Controlled native GET traffic using
`X-ACE-Recovery-Backup: <backup-id>` is served from the independent restored
bucket and coordinator namespace. Removing the header returns traffic to live
storage. This is a read-only recovery switch: mutations receive 405, ordinary
accounts cannot select the snapshot, current authentication is still required,
and source/version hashes and sealed readiness are verified. No restored
session is accepted.

Tests exercise the switch with the live database, bucket and native authority
unavailable, and reject corrupt restored source. This permits source access
during those failures. Full write failover, database promotion, provider-wide
outage recovery and disaster RPO/RTO are separate operational decisions.

## Security, concurrency and alert delivery

The Rust path-traversal fix and subsequent manifest/root hardening are documented
in `file-input-security.md`. The original Aikido finding could not be rescanned
under the available plan; the owner accepted code review and regression tests
as closure. This is not an external scanner pass.

`scripts/check-multi-user-concurrency.mjs --run --output /private/probe.json`
creates two dedicated probe accounts, exercises 40 simultaneous reads, a
20-contender journal race, 20 identical retries, and reader write denial.
Sessions are revoked afterward; diagnostic accounts and audit history remain.
Observed acceptance is 40 successful reads, one accepted publication, 19
conflicts, 20 successful retries, exact retained hashes and reader HTTP 403.
This is bounded consistency evidence. It does not establish sustained cloud
evaluator throughput. Two concurrent local application executions are also
checked under one CPU, 256 MiB and 16 processes per container.

The independent monitor uses private bounded regular state files and rejects
linked files. Authentication and other sensitive responses default to
`Cache-Control: no-store`. Actual continuous alert delivery still requires an
explicit receiver and a monitor host that remains running independently of this
development environment. A configured script alone is not delivered-alert or
uptime evidence.
