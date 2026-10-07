# Agent proposals and durable Git history

ACE 0.2.0 accepts agent-authored WAT proposals and archives verified evaluations
in a dedicated Git repository. The executable assembles WAT with an embedded
parser, evaluates the resulting WebAssembly with the same independent Oracle
and resource limits as its built-in generator, and preserves source that
assembles to the exact artifact evaluated.

## Submit source and evaluate it

From the source checkout, after installing the CLI:

```sh
ace propose examples/agent-proposals/proposals.json --output agent-population
ace proposal-status agent-population
ace run agent-population --output agent-run --jobs 2
ace knowledge agent-run
ace archive agent-run --repository agent-history
ace archive-status agent-history
git -C agent-history log --oneline
```

Choose fresh population, run and initial repository paths. Subsequent evaluations
can share the same clean ACE archive repository. The example contains manually
written fixtures representing two caller-declared generators: recursive Euclid,
incorrect addition, an infinite loop and a forbidden host import. They are
transport and evaluation examples, not evidence that external providers were
called. Actual execution should qualify the reference and recursive Euclid,
reject addition for correctness, reject the loop for resource exhaustion and
reject the host import for violating the contract.

The proposal file uses this shape:

```json
{
  "schema_version": 1,
  "cell": "Gcd",
  "candidates": [
    {
      "id": "C-agent-euclid",
      "wat": "(module (func $g (export \"gcd\") (param $a i32) (param $b i32) (result i32) local.get $b i32.eqz (if (result i32) (then local.get $a) (else local.get $b local.get $a local.get $b i32.rem_u call $g))))",
      "strategy": "recursive-euclid",
      "generator": {"provider": "my-agent", "model": "my-model", "revision": "my-revision"}
    }
  ]
}
```

Only `Gcd` is supported. The function must export `gcd(i32, i32) -> i32`, using
unsigned 32-bit inputs and outputs; `gcd(0,0)` is zero. Imports, including WASI
and host Oracle access, are forbidden by the runner. Registration accepts
1–100 unique candidates, at most 32 KiB of WAT per candidate, 3 MiB per CLI
batch and 1 MiB per assembled artifact. Candidate IDs contain only ASCII
letters, digits, hyphens and underscores, up to 64 characters; Windows device
names are rejected. `C-baseline` is reserved. Duplicate compiled artifacts,
including a duplicate of the baseline, are rejected. Strategy text is limited
to 1,024 bytes and each generator field to 256 bytes. Unknown fields are errors.

Agent inputs cannot override evaluation policy, Oracle or resource budgets.
`propose` writes source, WASM, `proposals.json`, `registration.json` and
`experiment.json`. The registration flags explicitly state that real evaluation
is still required and provenance is caller asserted. The declared provider/model
is not authenticated by ACE. Hashes detect changes and connect source to the
executable; they are not provider signatures. `proposal-status` and `run` verify
that the registered population still matches these receipts.

## Compare against a previous qualified winner

```sh
ace propose my-new-proposals.json --output second-population --baseline-run agent-run
ace run second-population --output second-run
ace archive second-run --repository agent-history
```

ACE validates the previous sealed run and its materialized Champion, copies
that artifact as the new baseline, and preserves its evaluation profile. It
records parent Champion, candidate, evidence and environment hashes. The new
baseline is evaluated again; previous qualification does not substitute for
new tests. Runs created by the local CLI preserve source, so inherited winner
WAT can also be copied. Older precompiled-only runs may lack source; evaluation
can still use their verified artifact, but Git archival requires source for
the resulting winner.

## What each Git commit preserves

`ace archive <run> --repository <path>` commits a complete snapshot under
`runs/<report-hash>/`. `ace evolve <campaign> --git-repository <path>` performs
the same save immediately after each completed generation. A generation that
does not improve still gets a commit: its failures and correct alternatives
remain useful observations.

| File | Contents |
| --- | --- |
| `winner.wat` | Source that assembles to the selected qualified Champion |
| `winner.wasm` | The Champion artifact actually evaluated |
| `learning.json` | Structured Knowledge and every candidate's measured outcome, evidence and policy decision |
| `run/sources/*.wat` | Frozen available source for winning and losing candidates |
| `run/sources.json` | Source, artifact and input metadata hashes linked to the exact run report |
| `run/proposal-registration.json` | Frozen proposal receipt, including parent Champion/evidence references when inherited |
| `run/proposal-batch.json` | The exact agent proposal batch and caller-declared generator metadata |
| `run/generation.json` | Built-in generator receipt, when present |
| `run/knowledge.json` | Versioned Knowledge with supporting and contradicting evidence references |
| `run/knowledge-linked.json` | Evolution Knowledge with the preceding generation as parent, when present |
| `run/candidates/` | Each candidate's provenance, evaluation, sealed evidence and decision |
| `run/artifacts/` | Evaluated executable artifacts for reproduction |
| `run/run.json` | Sealed experiment report |
| `manifest.json` | Snapshot identity and hashes of archived files |

No-winner runs retain learning and evidence without inventing a winner source.
Learning claims describe only the recorded workload and environment; an
incorrect candidate's failure is not a general claim that its strategy always
fails. Incomplete evaluations remain unresolved. Current archival retains
available losing source too; automatic pruning is not implemented.

The repository is created on branch `ace-history`, using a local `ACE
<ace@localhost>` commit identity. Git must be installed and available on PATH;
the ordinary demo, generator, proposal assembler and evaluator need no external
compiler or provider credentials. A fresh initial repository path is required.
ACE later accepts only a clean dedicated ACE archive repository, preserves
previous commits and returns the existing commit for an identical save.
Repositories containing pending changes are rejected. Commit hooks and signing
are disabled for these generated archive commits. Interrupted archive writes
leave files for inspection; automatic recovery is not implemented.

`archive-status` verifies committed snapshots, file hashes, run evidence,
source-to-WASM identity and learning against measured outcomes. You can clone
the repository and run the same command against the clone. Replay of an archived
candidate still requires the recorded runner/environment fingerprint; otherwise
run a new experiment. Local archival does not configure a remote or push to
GitHub. An archive can be published with ordinary `git remote` and `git push`
commands after its owner selects the remote.

## MCP tools for an agent

Configure the executable as described in [getting started](getting-started.md).
The local server now exposes twelve tools. To submit the batch above:

```json
{"name":"ace_propose","arguments":{"experiment":"agents","proposals":{"schema_version":1,"cell":"Gcd","candidates":[{"id":"C-agent-euclid","wat":"(module (func $g (export \"gcd\") (param $a i32) (param $b i32) (result i32) local.get $b i32.eqz (if (result i32) (then local.get $a) (else local.get $b local.get $a local.get $b i32.rem_u call $g))))","strategy":"recursive-euclid","generator":{"provider":"my-agent","model":"my-model"}}]}}}
```

Then call, in order:

```json
{"name":"ace_run","arguments":{"experiment":"agents","run":"agents"}}
{"name":"ace_knowledge","arguments":{"run":"agents"}}
{"name":"ace_archive","arguments":{"run":"agents","repository":"history"}}
{"name":"ace_archive_status","arguments":{"repository":"history"}}
```

These are `tools/call` parameters, not complete JSON-RPC request frames. Each
MCP frame remains limited to 64 KiB, so smaller proposal batches may be required.
An optional `baseline_run` argument to `ace_propose` names a saved run under
the selected workspace's `runs/`. Archives stay under `archives/<repository>`.
The MCP process needs Git on PATH for its two archive tools. The server launches
Git with fixed arguments; it exposes no general shell or native compiler.
Direct vendor API calls, other Cells, IDE UI and production promotion remain
unfinished architecture work.
