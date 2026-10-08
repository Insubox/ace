# Browser collaboration and application projects

ACE's Observatory now has **Reviews** and **Applications**, alongside the existing
source history and mathematical Cell experiments. These workflows use native ACE
versions; no Git repository is used as their storage engine.

Changing projects preserves the authenticated session, including when the previous
project is still loading or a project request fails. Sign-out cancels outstanding
requests and clears private views. Browser account sessions use a 12-hour, host-only HttpOnly cookie;
reloading the page or opening another tab restores the session. Mutations using a cookie require the exact ACE Origin. Sign-out revokes the session and clears private views in other account tabs. Operator tokens remain in page memory.

## Reviews

Open a private project, then Reviews. Compare any two published version IDs.
A comparison verifies source objects and shows changed paths and bounded text
before/after: at most 20 files, 64 KiB and 256 lines per file. The browser displays
up to 16 KiB per text block; exact files remain downloadable in Versions.

Create two named branches in Versions, select a source and target in Reviews,
and request review. Project writers/owners can add general comments or annotate
a changed file and a source line. Another contributor with current write access
must approve. The author cannot approve their own request. Requests for changes
block merging until those contributors approve instead.

Reviews pin both branch heads. When either changes, the author or project owner
must refresh the request, and prior approvals no longer apply. Removed members
and accounts changed to reader cannot supply a qualifying approval. Readers can
inspect reviews but cannot post comments, approve or merge.

A clean merge writes a two-parent **source** version and advances the target
branch in the same Durable Object transaction as the review completion and
native journal publication. Concurrent history updates are rejected. Immutable
R2 and D1 mirrors can be repaired by retrying the same merge. Merge requests and
comments are included in private backups and isolated restoration.

Three-way merge follows the native Rust engine's bounded line/LCS semantics and
preserves exact newlines. Binary or overlapping edits produce explicit conflicts;
they do not publish a merged version. Modify the source branch, refresh and
review again. An ambiguous ancestry requires an explicit base through the API.
Browser merge supports at most 4,096 file paths, with at most 128 unresolved
conflicting files. Shared object metadata is checked once, in batches of eight,
so full repositories can publish without serial waits for every file. Each project currently supports
32 requests, with 64 events per request. These preview limits are explicit.

An approval means a contributor reviewed the source. A merge does not inherit
Cell qualification or automatically become a Champion.

## Applications

Applications provides complete **Hola Mundo / Hello World**, **TicTacToe**, and
**Calculator** examples. Each contains:

- `main.py`: JSON stdin/stdout application entry point;
- `core.py`: application behavior, editable in Observatory;
- `ace-app.json`: fixed runtime and application contract;
- `dependencies.lock.json`: explicit local dependency and no external packages;
- `README.md`: direct usage.

Load an example, inspect its files, choose a parent and optional branch, then
compile/test. Original source is retained before execution. A fresh offline
container compiles the Python sources and executes an independent fixed public
suite: 11 Hello World cases, 20 game cases, or 29 calculator cases. Expected
results are compared outside the candidate interpreter. Candidates cannot submit
their own reports or verdicts. Results retain exact source, suite and runtime
identities, pass/fail cases and scoped learning in a subsequent native version.
Syntax failures and wrong outputs are retained as failures; infrastructure failure
has a separate state and does not claim the application failed its contract.

Game tests cover moves, wins, draws and invalid/occupied cells; the calculator
covers four operations, numeric types and division by zero. The application API
is JSON, so these are usable console applications. Interactive graphical app
frontends and third-party dependency installation are future work.

To inspect and retest a merged application, open its exact version in Versions
and choose **Build and test this application**. This loads retained files and
sets that version as parent; it does not reset them to the example template.

Branches advance with an expected previous head. If another contributor advances
the branch while testing, the result remains retained without overwriting their
work. Failed application results can be branch history too; branch membership
never claims correctness. Applications and mathematical Trials share eight new
requests and 16 assembly/archive/application containers per UTC day. One
application attempt uses one container; automatic retries for candidate execution
are disabled. Publication repairs reuse a completed report.

The Python child has 2 seconds of CPU, a 3-second wall deadline, 128 MiB address
space, 16 KiB output files, no subprocess creation, bounded descriptors and no
core dumps. Cloud execution uses the existing fresh UID-1000, network-disabled
container; local execution additionally uses read-only root/source files, dropped
capabilities, no-new-privileges, 256 MiB container memory, a PID limit and tmpfs.
The two environments are recorded separately. This is a bounded Python preview,
not a general native build system or a proof of arbitrary-code sandbox security.

Passing establishes only the recorded public suite. There is no hidden application
oracle, performance comparison, automatic promotion or novel-learning claim.

## Local developer use

Install Docker and prepare a Python image once:

```sh
docker pull python:3.11-slim-bookworm
cargo build --locked -p ace-cli
./target/debug/ace app init calculator ./my-calculator
./target/debug/ace app test ./my-calculator --output ./calculator-result --store ./ace-history
./target/debug/ace store log ./ace-history
```

`app test` uses an existing image and resolves its immutable local image ID before
starting; it never downloads an image implicitly. `--image` selects another local
Python 3.11+ image. No provider credentials are required. Templates and test
contracts are embedded in the CLI, so example creation needs no Node or Python
on the host; testing needs Docker and the prepared image. Direct trusted example
usage is `echo '{"op":"add","a":2,"b":3}' | python3 my-calculator/main.py`.

Full local functional validation:

```sh
node scripts/check-applications.mjs --ace target/debug/ace --image python:3.11-slim-bookworm
```

This executes all three examples, wrong output, syntax failure and infinite-loop
controls, verifies retained failing learning and native clone/checkout, and
rejects unlocked external dependencies. The optional Chromium check is
`node scripts/check-collaboration-apps-browser.mjs` with a dedicated debugging
browser on port 9222. Run browser checks sequentially when sharing one tab.
`node scripts/check-project-session-browser.mjs` checks switching during the
initial login load, project failures, invalid credentials and logout races.

## Validation of this increment

Local checks passed: 125 Rust tests, 88 Worker tests, 21 client tests, TypeScript
checking, formatting and Clippy with warnings denied. Chromium covered comparisons,
review creation, line comments, independent approval, merge, edited application
source, safe HTTP retries, reader restrictions, mobile layout and private-data
clearing on sign-out. The session regression reproduced the old project-switch
logout and passed after the fix.

The deployed Worker compiled and tested all three applications: Hello World 11/11,
TicTacToe 20/20 and Calculator 29/29. A deliberately incorrect calculator failed
0/29. All four retained source/report versions were pulled through ACE's native
protocol, checked out and tested again in fresh local containers with matching
source and suite hashes and outcomes. This used four paid cloud containers;
subsequent verification was read-only or local, with no GitHub Actions runs.

A separate real hosted review rejected author self-approval, accepted an independent
writer's approval and merged two branches. Pulling and independently merging the
same inputs with the Rust CLI produced the exact same two-parent version identity
and CRLF source. Merge retry did not duplicate history. A local isolated backup
restore also preserved review comments and branches. This increment did not run a
new production failover or expand the three application profiles to arbitrary builds.

## API and deployment

All routes require authentication and explicit project membership:

- `GET /v1/stores/:project/compare?left=:version&right=:version`
- `GET/POST /v1/stores/:project/reviews`
- `GET /v1/stores/:project/reviews/:id`
- `POST /v1/stores/:project/reviews/:id/events`
- `POST /v1/stores/:project/reviews/:id/merge` (`{}` or `{ "base": "…" }`)
- `GET /v1/projects/:project/application-templates/:profile`
- `GET /v1/projects/:project/application-versions/:version`
- `GET/POST /v1/projects/:project/applications`
- `GET /v1/projects/:project/applications/:id`

Apply migration `0010_application_runs.sql` before deploying the Worker with
`APPLICATION_RUNS` bound to `ApplicationWorkflow` (`ace-applications`). Pin
`APPLICATION_IMAGE_HASH` to the actual evaluator image digest when configured;
null represents an unknown image identity, never the Rust verifier binary hash.
The evaluator image must contain Python, Node and the exact locked decimal.js bytes. Pin both the actual image digest and its compiled native-verifier binary hash after rebuilding; never substitute an image digest for a binary hash.

Worker-only bundle validation uses `wrangler deploy --dry-run --containers-rollout none --config <deployment-config>` with the already-published image in that config. A config referencing a Dockerfile can still build the evaluator during dry-run.
A full evaluator build needs `applications/` as well as `crates/`; managed cloud
builds must mount the proxy CA as the `proxy_ca` BuildKit secret with TLS verification
preserved. CI/release execution remains limited as described in
[local delivery](local-delivery-0.4.md); development does not consume Actions quota.

## Daily collaboration

The Tasks view retains assigned work, status, source-version links and revision-bound comments. Readers can inspect and mark their own notifications read; writers can change tasks. Every project notification is private to members and excludes the current contributor’s own actions. Read cursors never skip future events. Tasks with no source history are included in disaster recovery.

In Reviews, the author or owner can choose **Resolve branch conflicts**, inspect exact target/source bytes, keep either side, delete a file or edit UTF-8 text. Resolutions cover every conflicting file exactly once. Saving creates a native version with both parents, advances only the source branch, and invalidates prior approvals. An independent reviewer approves the new revision before the target can merge. Test the resulting application again. Branch and review changes reject a stale save; an interrupted request can reuse its UUID. Limits: 128 paths, 64 KiB per edited file, 512 KiB combined text; 64 tasks/project and 16 task events. No paid evaluator is required for collaboration.
