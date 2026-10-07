# Phase 0: domain kernel

## Scope and decisions

The specification's immediate backlog is implemented as a Rust workspace. The
domain kernel does not depend on Cloudflare, an inference provider, a database,
a filesystem or the system clock. The CLI owns local persistence and supplies
timestamps. TypeScript orchestration, MCP, sandboxes and the dashboard arrive in
later phases; no placeholder services are started here.

Versioned domain references carry an ID and a nonzero version. IDs are separate
Rust types and must match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. They cannot contain
path separators. Numeric measurements must be finite, probabilities are in
`[0,1]`, and all timestamps use UTC Unix seconds. Raw credentials are not domain
data: environment configuration is represented by a hash, and capabilities
reference secret names only.

## Documents and validation

Every CLI domain document uses this envelope:

```json
{
  "schema_version": 1,
  "payload": {
    "kind": "project",
    "data": {"id": "PRJ-demo", "name": "Demo", "created_at": 1}
  }
}
```

`ace-protocol::decode` rejects unsupported versions, unknown fields, duplicate
object keys, trailing JSON and invalid typed primitives. It then runs local
semantic validation, including evidence seals, nonempty qualification evidence,
claim evidence requirements, self references and contradictory claim citations.

Individual schemas describe raw domain values; `document.schema.json` describes
the envelope. `evidence.schema.json` is the raw observation;
`sealed-evidence.schema.json` includes the content hash. Cross-field semantics
and hash verification are implemented in Rust, rather than JSON Schema alone.
Call `Validate::validate` after direct Serde deserialization outside the protocol
decoder; deriving `Deserialize` is not itself a semantic validation call.

These checks do not resolve foreign keys, authenticate an author, verify an
external artifact's bytes, or establish that a declared Champion is qualified.
The future trusted resolver and promotion plane must verify those facts against
immutable source records. An ID/version reference assumes the corresponding
version is immutable. A knowledge claim's `proven` label requires citations here;
their applicability and trust must be checked by that future resolver.

Generate schemas after changing types, and commit matching outputs:

```bash
cargo run --locked -p ace-cli -- schema --out schemas
cargo run --locked -p ace-cli -- schema --out schemas --check
```

Regenerate illustrative documents with:

```bash
cargo run --locked -p ace-protocol --example generate
```

## Content addressing and provenance

`ContentHash::of_bytes` computes standard SHA-256 for patches, locks and artifacts.
For typed documents, `ContentHash::of_json` hashes the byte prefix
`ace:canonical-json:v1\0` followed by compact JSON with recursively sorted object
keys. Array order is preserved. Domain sets serialize in sorted order; negative
zero measurements and probabilities normalize to positive zero. Numeric wire
format follows the pinned Rust/serde_json implementation in `Cargo.lock`.
This encoding is **ACE canonical JSON v1**, not RFC 8785/JCS. Cross-language
implementations must match this encoding before comparing hashes. Hashes provide
content integrity, not signatures or authenticated generator identity.

An environment fingerprint hashes all recorded execution inputs except its
human-assigned ID. Changing runtime, image, architecture, locks, data, traffic,
configuration, feature flags, model versions, Oracle or EvalSpec changes the
fingerprint. The general `ace hash environment.json` command hashes the entire
envelope; it is a document hash, not the environment fingerprint method.

Candidate provenance records generator identity, input hash, tool versions,
parent candidates and creation time. Optional fast-judge observations record
model, calibration, question schema, threshold policy, input/answer artifacts and
probabilities, without introducing an online inference dependency.

## Evidence and local persistence

`SealedEvidence` stores a SHA-256 content hash and exposes shared read access to
its observation. Altering an observation requires a new seal. `ace evidence seal`
accepts a raw observation and emits a sealed `evidence` document; it does not
assert that an evaluator or Oracle actually ran.

`ace init` atomically creates `.ace/project.json` without replacing an existing
project. `ace evidence record` publishes complete evidence files atomically under
`.ace/evidence/<id>.json` without overwriting existing names. Repeating an identical
record is idempotent. Reusing its ID with different content fails. Reads verify
the seal and stored ID. Users with filesystem access can still edit files;
the CLI detects an invalid seal but is not an authorization or tamper-proof
storage service.

## Deterministic policy v0

`PolicyInput` must come from the trusted Policy Plane. A candidate must not select
the policy, required checks, expected environment, Oracle or thresholds. The
local CLI accepts such input for development; it has no authentication boundary.

Evaluation binds the observation to the expected Cell, Candidate, Experiment,
environment fingerprint, EvalSpec and Oracle version. A mismatch or future-dated
observation is held. Evaluator and Oracle errors are held for investigation.
Observed failures of required deterministic checks, the independent Oracle,
deterministic evaluation or hard metric constraints reject a candidate.

L0 and L1 advance to real L2 execution after required static checks pass. L1
scores and an adapter's probabilistic failure label never reject a candidate
by themselves. L2 requires optimization and hard-constraint measurements and
advances to L3. L3 requires those measurements, successful deterministic
evaluation, all required checks and Oracle acceptance before producing an elite.
Missing checks, wrong units or incomplete final evaluation cannot qualify an
elite. There is no ranking or Champion promotion in this initial engine.

Every decision records its policy version, candidate and evidence IDs, evidence
hash, full input hash, reason and caller-supplied time. Calls with the same input
produce the same result. Probabilistic routing/calibration, Pareto selection,
budget enforcement and tournament stopping are later milestones.
