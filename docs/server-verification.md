# Independent verification of native evaluation versions

The server can independently evaluate a published ACE native snapshot, preserving
its original files and learning. Uploaded labels remain declared until checked.
The server validates the snapshot, source-to-WASM linkage, evidence and policy,
then executes every registered candidate again using the trusted Rust evaluator.
The resulting experiment has its own actual environment, observations, policy
and local Champion. It never authorizes production promotion.

| API | Purpose |
| --- | --- |
| `POST /v1/stores/:name/versions/:id/verify` | Request or explicitly retry verification; writer/administrator required |
| `GET /v1/stores/:name/versions/:id/verification` | Read state and the immutable server receipt |
| `GET /v1/stores/:name/versions/:id/verification/run` | Read the complete sealed server-generated run |

Only published evaluation versions can be checked. Source snapshots and generator
faults do not receive candidate qualification labels. Caller-supplied receipts
are not accepted. A reader can inspect results but cannot spend evaluation budget.

The Observatory's Trials view displays verification state and lets authorized
accounts request a check and inspect its receipt. It labels original host timing
and generator identity as declared even after deterministic reproduction.

## Meaning of the result

- **Reproduced:** candidate artifact IDs, correctness outcomes, checked calls,
  output traces, instruction fuel, peak linear memory, policy actions and Champion
  selection match the independent evaluation.
- **Mismatch:** complete deterministic observations or selection disagree.
- **Inconclusive:** an original or current evaluation has an infrastructure or
  execution-budget outcome; it cannot establish qualification or semantic failure.
- **Failed:** the server workflow could not finish, including invalid retained
  inputs, unavailable infrastructure or exhausted budget. There is no completed
  qualification receipt. Authorized users can request a new bounded attempt.

The original and server environments are recorded separately. Native timing is
excluded from comparison and its original environment is never rewritten. This
is empirical checking of the recorded GCD workload and its declared harness,
not mathematical proof over all inputs or a fresh undisclosed holdout. Provenance
and production suitability remain separate concerns.

## Integrity, retries and bounds

A receipt binds the native version, original report, new report, original/new
environments, exact evaluator executable SHA-256 and each candidate's artifact
and fresh evidence. Its server envelope also hashes every retained evidence/policy
JSON file. The D1 completion pointer appears only after all files are retained.
Downloaded receipts and runs are checked against their immutable identities.

Workflows perform at most two attempts each; a separate daily coordinator permits
eight actual verification attempts per deployment. Retrying a failed check starts
a new workflow, while duplicate requests repair startup. Completed receipts are
returned without re-execution. Superseded workflows cannot replace the current
result. Partial exports use distinct report identities, making retries safe.

Each check accepts at most 768 native files and 64 MiB of snapshot bytes, with
8 MiB per file. A server run metadata export is bounded to 8 MiB. The container
has networking disabled, runs as UID 1000 and is destroyed after each attempt.
The runner retains its existing fuel, memory and wall-clock limits.

## Deployment and development

Apply `0005_native_verifications.sql` in addition to earlier migrations. Bind the
`NativeVerificationWorkflow` as `NATIVE_VERIFICATIONS` and configure
`NATIVE_VERIFIER_BINARY_HASH` with the SHA-256 of `/usr/local/bin/ace` in the exact
pinned evaluator image. Updating evaluator code requires building/testing its
image and updating that binding together. A missing binding disables server
verification rather than silently trusting uploads.

The same independent verifier works locally:

```sh
ace cloud verify-snapshot /path/to/native-checkout --output /fresh/verification
```

It validates a complete evaluated snapshot created by `ace store checkout` and
writes `receipt.json` plus the fresh sealed run under the new destination. No
network, Git or external compiler is needed.

`cargo test --workspace --locked`, `npm test` and `npm run test:clients` cover real
re-execution, changed source, fabricated observations, tagged Rust policy receipts,
missing evidence, wrong version/evaluator identities, corruption, partial exports,
retries and access roles. Workerd uses an isolated trusted-RPC fixture.

The optional live `scripts/check-native-verification.mjs` reads a deployed receipt;
`--request` explicitly requests a bounded paid verification. Credentials stay in
the Node process. `ACE_EXPECT_SERVER_VERIFICATION=1` extends the Chromium UI check
to inspect the real server receipt.

## Live validation, 2026-10-07

Cloudflare independently reproduced the three observations of native version
`92c2a874f9264edfd80f44b9fd48b82e89c6b416b9b9ed05dfd03267ff991025`
in `native-platform-v030`: baseline qualified, recursive GCD qualified and retained
as local Champion, addition failed correctness. The receipt explicitly records a
different server environment and the complete fresh sealed run was retrieved.
An initial receipt format mismatch failed safely and was repaired through the
new attempt flow.

The tested evaluator executable hash is
`17753627dbee12a8a096d8729f1d2e80c4ae87a3fa0fbc486e49c38edd932974`;
its image manifest digest is
`sha256:5b1ece48bc6a449ece2306089b9aa34f042ca37a3524b2b0568076a754c1d9b9`.
