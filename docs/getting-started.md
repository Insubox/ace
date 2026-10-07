# Run your first ACE experiment

ACE currently experiments with the pure function `gcd(u32, u32) -> u32`.
It generates bounded WASM variants, executes them with resource limits,
checks their answers with an independent Oracle, saves immutable evidence,
and chooses a qualified Champion. Multiple generations can reuse the previous
Champion and preserve linked Knowledge.

The local experience requires no account, API key, Cloudflare service, Docker,
Node or candidate compiler. A downloaded native executable runs by itself.
The generator is a deterministic local grammar; external coding-agent providers
and arbitrary application Cells remain future work.

## Download an executable

1. Open [GitHub releases](https://github.com/Insubox/ace/releases).
2. Choose the latest technical preview and expand **Assets**.
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
sha256sum -c ace-0.1.0-x86_64-unknown-linux-musl.tar.gz.sha256
# macOS (use your downloaded filename)
shasum -a 256 -c ace-0.1.0-aarch64-apple-darwin.tar.gz.sha256
```

On Windows, run `Get-FileHash .\ace-0.1.0-x86_64-pc-windows-msvc.zip -Algorithm SHA256`
in PowerShell and compare it with the text in the downloaded `.sha256` file.
These hashes detect changed downloads; they are not a code-signing certificate.

5. Extract the package and open a terminal inside its extracted folder.
6. Run these commands on Linux or macOS:

```sh
./ace --version
./ace demo
./ace status ace-demo/run
./ace knowledge ace-demo/run
```

On Windows use PowerShell:

```powershell
.\ace.exe --version
.\ace.exe demo
.\ace.exe status ace-demo/run
.\ace.exe knowledge ace-demo/run
```

The demo evaluates 12 candidates and a baseline. Nine generated candidates and
the baseline should qualify. Three explicitly marked diagnostic controls test
incorrect addition, fuel exhaustion and excessive memory growth. The terminal
prints the Champion, measured fuel and the command to replay it. Evidence,
input sources and compiled WASM stay in the new `ace-demo` folder.
Improvements refer to Wasmi fuel on this workload, rather than production CPU
speed or savings caused by AI filtering. Oracle success checks the configured
cases; it is not a proof for every possible input.

The release workflow also builds downloadable artifacts on each `main` update.
If a release has not yet appeared, open **Actions → Downloadable CLI**, choose
a successful run, and download the artifact named for your computer. Extract
the Actions ZIP and then the native archive inside it. GitHub requires sign-in
for Actions artifacts; private repositories also require repository access.
Release publication depends on all platform jobs passing. Packages are native
to the indicated platform; use the source build below for other architectures.

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
The current grammar explores remainder unrolling, equality checks, subtraction
tails, symmetric remainder and binary shifts. It is bounded to these algorithms.

To use the optional distributed control plane or paid judge, follow the
repository's [Cloudflare guide](https://github.com/Insubox/ace/blob/main/docs/phase2.md)
and [judge guide](https://github.com/Insubox/ace/blob/main/docs/phase3.md).
Those services use your own infrastructure and credentials.
