# Click: first external open-source project

The owner selected [Pallets Click](https://github.com/pallets/click) as ACE's next
project. This explicit local profile freezes Click **8.3.1**, upstream commit
`1d038f270701498433cb432f54db89f95f07a845`, and retains its BSD-3-Clause license.
It does not replace Click's maintainers, create an upstream pull request, or
change the visibility or license of ACE's own repository.

## Reproduced problem and repair contract

`Choice.convert` uses Unicode `casefold()` for case-insensitive matching, but
`Choice.shell_complete` uses `lower()`. For example, `Choice(["Straße"],
case_sensitive=False)` accepts `STRASSE` and does not suggest `Straße` for the
prefix `STRASS`. Final Greek sigma and Unicode ligatures expose the same
inconsistency. The task is to use the conversion's existing Unicode semantics
for prefix matching **while preserving original suggestion spelling**.

The profile independently builds a real wheel with `flit_core`, imports that
built package, compiles its Python modules, runs Click's original suite, and
runs 15 public regression cases in `pilots/click/test_completion.py`. It does
not insert a defect into upstream source. Only `src/click/types.py` is mutable;
tests, manifests, dependency locks, other source and the evaluator are protected.
Unlisted source files are never mounted or committed.

All 144 tracked upstream files are retained as exact native source versions.
Each result links to its source parent and keeps the frozen context, report,
case identities, JUnit evidence, stdout, stderr, harness and scoped learning.
The branch advances only after all executed checks pass, the pass count improves,
every previously passing case still passes, and existing skipped/expected-failure
cases retain their status. A timeout, unavailable container or missing evaluator
report is an infrastructure failure, distinct from a build or test failure.

## Run locally

This profile currently requires **Linux**, Node 24, Git, Docker, Python 3.11+
for dependency preparation and the ACE executable. macOS/Windows native CLI
verification is a separate distribution task. Run commands from the ACE checkout.
The source and dependency download need network access; evaluation has none.
Use fresh directories and preserve any existing files.

```sh
git clone --depth 1 --branch 8.3.1 https://github.com/pallets/click.git click-upstream
git -C click-upstream rev-parse HEAD
# Must print: 1d038f270701498433cb432f54db89f95f07a845
python3 -m pip download --require-hashes --only-binary=:all: --no-deps \
  -r pilots/click/requirements.lock -d click-wheels
```

The six pure Python wheels have pinned versions and SHA-256 checksums. Five
match Click's original `uv.lock` test dependency closure for Python 3.11+;
the build backend is separately pinned to flit-core 3.12.0 within Click's declared
`>=3.11,<4` range. The evaluator checks every wheel again before mounting it.
`pilots/click/dependencies.json` records their official PyPI artifact URLs.

Prepare the existing local Python image if needed:

```sh
docker build -f self-host/Dockerfile -t ace-project-evaluator:local .
```

Managed cloud environments must preserve their configured proxy and CA trust
when building/downloading. No TLS bypass is required. No new image build was
needed for the recorded run; it reused an existing image by immutable ID.
Candidate containers run without network, credentials, privileges or a Docker
socket, with a read-only root/source/dependencies, 2 CPUs, 768 MiB memory,
128 processes, bounded temporary storage and a 240-second attempt deadline.
Only disposable work and result directories are writable.

Run the reproducible example with two **declared, curated** proposals:

```sh
node scripts/click-pilot.mjs --source click-upstream --wheels click-wheels \
  --output click-campaign --ace /absolute/path/to/ace \
  --curated-example --agent codex-declared-local
```

Alternatively, give your coding agent the frozen task above and save 1–4 proposals
in a JSON array. Each item has exactly `strategy` and `files`; `files` contains
only `src/click/types.py` with the complete replacement file. Use
`--proposals submissions.json` instead of `--curated-example`. Tests and verdicts
are not part of a submission. Invalid submissions are rejected before execution.
There is no paid provider call, hosted application endpoint, or automatic deployment.

`summary.json` contains the baseline, every rejected/accepted proposal and the
best exact source ID. `native/` is the ACE store; `native-validation.json` records
its verified journal. Inspect or copy it with the actual returned source ID:

```sh
ace store log click-campaign/native
ace store clone click-campaign/native click-history-copy
ace store checkout BEST_SOURCE_ID --store click-history-copy --output click-winner
```

All snapshots preserve license bytes. ACE checkout preserves regular-file bytes,
rather than Git permission bits; this Python project is evaluated through Python.

## Recorded result

On the existing Linux Python 3.11 evaluator, the unchanged upstream suite passed
1,314 tests, skipped 21 platform-dependent cases and retained one expected failure.
With the 15 fixed repair cases, the baseline passed **1,325** and failed **4**.
The losing proposal discarded original capitalization/spelling and was rejected.
The repair passed **1,329**, failed zero, retained the same 21 skips and one
expected failure, and preserved every previously passing case.

These are local observed outcomes on one frozen public suite. They do not establish
general agent learning, provider authenticity, every supported Python/OS behavior,
or hosted qualification. The proposals were explicitly declared; there was no
paid inference. The native history contains source and learning for the baseline,
loser and winner, and the winner is ready for an independent review.

See `pilots/click/acceptance.json` for retained version IDs and exact evaluator
identity. Further tasks need fresh executions and their own frozen context.

## Inspect in Observatory

The private **click-pilot** project contains all seven versions and 166 content
objects. A fresh hosted download of 3,364,780 bytes passed the actual native
engine's verification. The existing ACE project owner has access.

In **Versions**, inspect the baseline, losing/winning source, results and learning.
In **Reviews**, the request **Click: corregir autocompletado Unicode conservando
la escritura original** pins the winner branch `click-unicode-completion` and
the baseline `main`. Its ID is `42e9e45a-75cd-4c70-bf6c-0ac1ea1cf3c8`.
Independent approval is pending; `main` retains the original upstream source.
The full `types.py` exceeds the browser's 256-line diff preview; download its
exact bytes in Versions. The review comment records the two-call correction
and links to the winning evidence version. No production Worker changed.
