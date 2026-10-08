# Run your first ACE experiment

ACE evaluates the pure unsigned functions Gcd, MaxU32 and MinU32.
The built-in offline demo generates Gcd proposals; manual WAT and agent
proposals can also use `max_u32` and `min_u32`.
It generates bounded WASM variants, executes them with resource limits,
checks their answers with an independent Oracle, saves immutable evidence,
and chooses a qualified Champion. Multiple generations can reuse the previous
Champion and preserve linked Knowledge.

The local experience requires no account, API key, Cloudflare service, Docker,
Node or candidate compiler. A downloaded native executable runs by itself.
The built-in generator is a deterministic local grammar. Coding agents can also
submit their own WAT through `ace_propose`. Bounded agent campaigns can also use the optional Workers AI bridge. Arbitrary
application Cells remain future work. Native ACE history does not require Git;
Git is needed only for the optional compatibility archive/export commands.

## Download an executable

1. Open the [public getting-started page](https://ace.org.ai/getting-started.html)
   for the Linux standalone download. No GitHub account is required for that
   download. The alternative [GitHub releases](https://github.com/Insubox/ace/releases)
   require access while the source repository remains private.
2. For Linux, Intel/AMD 64-bit, open the
   [verified 0.4.0 candidate](https://github.com/Insubox/ace/releases/tag/ace-0.4.0-linux-candidate-20261008)
   and expand **Assets**. This preview contains only the Linux package, built
   from commit `0b913fb`. Private repositories require repository access.
   For current macOS/Windows source, use the source instructions below.
3. Download the package for your computer and its matching `.sha256` file:

| Computer | Package suffix |
| --- | --- |
| Linux, Intel/AMD 64-bit | `x86_64-unknown-linux-musl.tar.gz` |
| Mac, Apple silicon | `aarch64-apple-darwin.tar.gz` |
| Mac, Intel | `x86_64-apple-darwin.tar.gz` |
| Windows, Intel/AMD 64-bit | `x86_64-pc-windows-msvc.zip` |

4. Check the package checksum before extracting it:

```sh
# Linux
sha256sum -c ace-0.4.0-x86_64-unknown-linux-musl.tar.gz.sha256
# macOS (use your downloaded filename)
shasum -a 256 -c ace-0.4.0-aarch64-apple-darwin.tar.gz.sha256
```

On Windows, run `Get-FileHash .\ace-0.4.0-x86_64-pc-windows-msvc.zip -Algorithm SHA256`
in PowerShell and compare it with the text in the downloaded `.sha256` file.
These hashes detect changed downloads; they are not a code-signing certificate.

5. Extract the package and open a terminal inside its extracted folder.
6. Run these commands on Linux or macOS:

```sh
./ace --version
./ace demo
./ace status ace-demo/run
./ace knowledge ace-demo/run
./ace inspect ace-demo/run --output ace-report.html
```

On Windows use PowerShell:

```powershell
.\ace.exe --version
.\ace.exe demo
.\ace.exe status ace-demo/run
.\ace.exe knowledge ace-demo/run
.\ace.exe inspect ace-demo/run --output ace-report.html
```

The demo evaluates 12 candidates and a baseline. Nine generated candidates and
the baseline should qualify. Three explicitly marked diagnostic controls test
incorrect addition, fuel exhaustion and excessive memory growth. The terminal
prints the Champion, measured fuel and the command to replay it. Evidence,
input sources and compiled WASM stay in the new `ace-demo` folder.
Improvements refer to Wasmi fuel on this workload, rather than production CPU
speed or savings caused by AI filtering. Oracle success checks the configured
cases; it is not a proof for every possible input.

The package workflow runs on version tags or explicit manual dispatch. GitHub
Actions is currently account-limited, so ordinary development performs local
checks and does not launch Actions. Windows/macOS execution for the current
source remains unverified. The published Linux preview passed checksum and
first-use checks after downloading it from GitHub; this does not establish a
completed four-platform release. The [native distribution guide](native-distribution.md)
provides local build and verification commands without Actions. Use the source instructions below
when a suitable published asset is unavailable.

## Run successive generations

```sh
./ace evolve ace-evolution --generations 4 --candidates 24 --seed 42
./ace history ace-evolution
```

Use `.\ace.exe` on Windows. Each generation re-evaluates the previous qualified
Champion as its baseline. Failed candidates never replace it. Two consecutive
generations without a qualified improvement stop the default search; reaching
the generation budget also stops it. `--patience` changes the first limit.
Every generation stores its own run and a Knowledge node whose parent is the
previous generation's node. `history` verifies all sealed runs, rebuilds the
seeded populations, checks source/WASM hashes, and verifies Champion and Knowledge
lineage. The campaign's final artifact is `ace-evolution/champion.wasm`.
This is local experimentation; it does not deploy an application.

Choose a fresh directory when repeating a command:

```sh
./ace demo ace-demo-2 --seed 123
./ace evolve ace-evolution-2 --generations 8 --patience 3
```

Existing destinations are rejected. After an interrupted campaign, individual
completed generation runs remain inspectable with `status`; automatic resume is
not implemented yet. `history` requires a complete campaign.

## Build directly from GitHub

Install [Rust with rustup](https://rustup.rs/) and Git. Windows source builds also
require the MSVC build tools described by the Rust installer. Then:

```sh
git clone https://github.com/Insubox/ace.git
cd ace
cargo run --locked -p ace-cli -- demo
cargo run --locked -p ace-cli -- evolve ace-evolution
cargo test --workspace --locked
```

The repository selects Rust 1.99.0 automatically through `rust-toolchain.toml`.
No `wasm32` target is needed for the built-in generator or demo. The first source
build needs Internet access to install the toolchain and locked dependencies;
subsequent local experiments run offline. For a permanent local CLI:

```sh
cargo install --locked --path crates/ace-cli
ace demo ace-installed-demo
```

## Separate generation from evaluation

```sh
./ace generate my-population --seed 42 --candidates 100
./ace run my-population --output my-run --jobs 4
./ace status my-run
```

Populations support 4–100 candidates, including three diagnostic controls, plus
one baseline. `generation.json` records the generator, seed, provenance and hashes.
All parameters affect actual program execution; duplicate WASM hashes
are rejected. Identical seeds and settings reproduce the input population.
Run IDs, timestamps and native timings vary. Evaluation supports 1–8 local jobs.
Seeds in saved JSON and MCP arguments use decimal strings, preserving all
64 bits in JavaScript and other clients. CLI `--seed` accepts ordinary digits.
The current grammar explores remainder unrolling, equality checks, subtraction
tails, symmetric remainder and binary shifts. It is bounded to these algorithms.

To use the optional distributed control plane or paid judge, follow the
repository's [Cloudflare guide](https://github.com/Insubox/ace/blob/main/docs/phase2.md)
and [judge guide](https://github.com/Insubox/ace/blob/main/docs/phase3.md).
Those services use your own infrastructure and credentials.

## Connect a development agent through MCP

The same executable provides a local MCP stdio server. In an MCP client that
uses JSON server configuration:

```json
{
  "mcpServers": {
    "ace": {
      "command": "/absolute/path/to/ace",
      "args": ["mcp", "--workspace", "/absolute/path/to/ace-workspace"]
    }
  }
}
```

For Codex, use its TOML MCP configuration:

```toml
[mcp_servers.ace]
command = "/absolute/path/to/ace"
args = ["mcp", "--workspace", "/absolute/path/to/ace-workspace"]
```

On Windows use the absolute path to `ace.exe` and escape backslashes in JSON.
The client starts ACE, performs the MCP handshake and discovers thirty tools:

| Tool | Purpose |
| --- | --- |
| `ace_store_refs` | Verify native branch heads and reference history |
| `ace_store_branch` | Create/advance a branch with an explicit expectation |
| `ace_store_diff` | Compare version files and bounded text edits |
| `ace_store_merge` | Merge ancestry and preserve unresolved conflicts |
| `ace_store_fetch` | Import verified native DAG nodes between local stores |
| `ace_store_save` | Retain winner source, evidence and all learning in native ACE versions |
| `ace_store_log` | Verify native objects, version ancestry and ordered history |
| `ace_store_checkout` | Restore exact files from a version into a fresh folder |
| `ace_store_clone` | Copy native history without Git or network access |
| `ace_store_commit` | Version explicitly listed source files |
| `ace_store_export_git` | Optionally export evaluated history to Git |
| `ace_inspect` | Export an interactive offline HTML view of a verified run |
| `ace_memory` | Retrieve compatible verified winning source and learning from ACE history |
| `ace_agent_start` | Start a bounded agent campaign with a verified baseline |
| `ace_agent_next` | Freeze the next public task and learning context |
| `ace_agent_submit` | Independently evaluate agent proposals and save all outcomes |
| `ace_agent_fault` | Retain a generator fault without inventing candidate outcomes |
| `ace_agent_status` | Verify campaign receipts, budgets and archived runs |
| `ace_propose` | Assemble and register agent-authored WAT; still requires evaluation |
| `ace_proposal_status` | Verify the proposal batch and source-to-WASM hashes |
| `ace_archive` | Commit winner source and all learning under `archives/<name>` |
| `ace_archive_status` | Verify saved Git snapshots |
| `ace_generate` | Create a fresh local population under `experiments/<name>` |
| `ace_run` | Evaluate a registered population and save evidence under `runs/<name>` |
| `ace_status` | Verify and summarize a run |
| `ace_champion` | Retrieve its qualified Champion |
| `ace_knowledge` | Retrieve structured, evidence-backed Knowledge |
| `ace_explain` | Explain one candidate's evaluation and deterministic decision |
| `ace_evolve` | Run bounded generations under `campaigns/<name>` |
| `ace_history` | Verify the complete campaign lineage |

A first agent sequence is `ace_generate` with `{"experiment":"first"}`, then
`ace_run` with `{"experiment":"first","run":"first"}`, then `ace_knowledge`
with `{"run":"first"}`. The tool schema describes optional parameters; seed
values use strings such as `"42"`. All local names use letters, digits, hyphens
and underscores. Existing outputs are preserved and tool paths are checked
against the selected workspace, including existing symlinks.

Agents can prepare other import-free GCD WASM populations in that workspace
using the `experiment.json` runner contract and then call `ace_run`. Every
candidate must pass the independent Oracle and resource gates. MCP does not
expose a shell or a native compiler, and it does not deploy the Champion.
The archive tools invoke installed Git with fixed arguments to save local history.
The server is a local process controlled by your MCP client, not an HTTP service.
Your chosen agent may have its own account requirements; ACE's local tools have
none. Additional vendor adapters and an IDE extension remain unfinished.

## Keep winner code and all learning in native ACE

```sh
./ace store save ace-demo/run --store ace-history
./ace store log ace-history
./ace memory ace-history --baseline-run ace-demo/run
./ace store clone ace-history copied-history
```

These commands retain source, every evaluated result and learning without Git.
Use `./ace evolve my-native-search --generations 4 --store my-native-history` to
save every generation automatically. Read [native versions](https://github.com/Insubox/ace/blob/main/docs/native-versions.md)
for arbitrary source files and restoration. The optional [native hosting guide](https://github.com/Insubox/ace/blob/main/docs/native-hosting.md)
explains ACE account login, remote push/pull and the private browser workspace.

## Optional Git compatibility history

1. Install Git if `git --version` does not work.
2. Choose fresh folder names, then run:

```sh
./ace evolve my-search --generations 4 --git-repository my-history
./ace archive-status my-history
git -C my-history log --oneline
```

Use `.\ace.exe` in PowerShell. ACE creates a separate Git repository on the
`ace-history` branch, with one commit for each completed generation. Every
snapshot under `my-history/runs/<report-hash>/` contains `winner.wat`,
`winner.wasm`, `learning.json`, frozen source, and a complete verifiable run.
Learning includes correct alternatives, incorrect candidates and resource failures.
The current implementation retains available losing source as well.

For a single completed demo or agent run:

```sh
./ace archive ace-demo/run --repository my-demo-history
./ace archive-status my-demo-history
```

The repository path must be fresh on first use. Later saves reuse only a clean
ACE archive repository. Repeating the same save returns its existing commit.
ACE preserves application repositories and pending changes. These commands save
locally; to publish the history, configure a remote and use ordinary Git commands.
See [agent proposals and Git history](https://github.com/Insubox/ace/blob/main/docs/agents-and-git.md)
for the proposal contract and the complete snapshot format.

## Let agents reuse what ACE learned

Follow [agent campaigns](https://github.com/Insubox/ace/blob/main/docs/agent-campaigns.md)
to feed a verified winner and positive/negative learning back into your coding agent.
The campaign commands work with the downloaded executable without Git.
The optional Qwen/Llama bridge also needs Node 24 and your configured Cloudflare
Worker; it performs paid inference under separate bounded budgets.

## Inspect a run in your browser

`ace inspect <run-folder> --output ace-report.html` verifies the saved run and
available frozen sources, then writes a fresh self-contained HTML file. Open that
file in a browser to filter the leaderboard and inspect each candidate's source,
evaluation, evidence, policy and retained Knowledge. The view makes no network
requests and never executes the candidate source. It is a snapshot verified at
export; re-run ACE to verify the original evidence later. Existing outputs are
preserved. Some managed browsers block local files; use your normal browser or a
local static file server according to your organization's browser policy.

Read [native versions](https://github.com/Insubox/ace/blob/main/docs/native-versions.md)
to save arbitrary source files, restore versions and copy ACE history without Git.

### Application projects on main

Create and test Hello World, TicTacToe or Calculator with `ace app init` and
`ace app test`. These fixed Python profiles record compilation, public test
results and both passing/failing source in native ACE history. Testing requires
Docker and a prepared local Python image. See [applications and browser reviews](collaboration-and-applications.md)
for complete commands, dependency limits and hosted collaboration.
