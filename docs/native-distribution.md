# Native developer distribution without GitHub Actions

The currently verified executable source is
`0b913fbaf8c41c26aa7465bd80525f18b1142528` (ACE 0.4.0).
The [Linux candidate](https://github.com/Insubox/ace/releases/tag/ace-0.4.0-linux-candidate-20261008)
has been downloaded and exercised independently. [Mac Intel](mac-intel-delivery.md)
passed native execution on the owner's Mac, with uploaded logs and package hashes
reviewed before publication. Windows and macOS Apple silicon pass Rust type
checking on Linux, but native execution and packages are still pending.
Do not publish a platform as verified before its native run.

## Run the native release check

Use a machine matching the desired OS and CPU. This script does not spend
GitHub Actions minutes or call model providers. It exports a frozen Git commit
into a temporary source directory, runs the workspace tests, builds the release,
checks the executable architecture, packages it and runs the extracted-package
first-use check. User edits and ignored files do not enter the frozen source.

Requirements: Python 3.11 or later, Git, Rust 1.99.0, the platform linker, and
repository access. Python is needed by the verifier; users of a finished native
package do not need Python or Rust. Runtime core checks use an empty PATH and
no provider credentials. Optional Git compatibility checks use the installed
Git separately.

Prepare the machine:

| Platform | Required linker |
| --- | --- |
| Linux x86-64 | `musl-tools` (Debian/Ubuntu: `sudo apt-get install musl-tools`) |
| macOS Apple silicon | Xcode Command Line Tools: `xcode-select --install` |
| macOS Intel | Xcode Command Line Tools: `xcode-select --install` |
| Windows x86-64 | Visual Studio Build Tools, **Desktop development with C++**, including MSVC and Windows SDK |

Download Rust from [rustup.rs](https://rustup.rs/), Python from
[python.org](https://www.python.org/downloads/) and Git from
[git-scm.com](https://git-scm.com/downloads). Windows users should reopen their
terminal after installation; use **Developer PowerShell for VS** if the linker
is unavailable. Keep TLS and installer verification enabled.

In a clone of `Insubox/ace`, obtain the latest delivery helpers:

```sh
git fetch origin main
git switch --detach origin/main
```

Use a clean disposable clone for this step if you already have uncommitted
work. The source commit below pins the executable independently of the helper
version. Install the frozen toolchain first:

```sh
rustup toolchain install 1.99.0 --profile minimal
```

Then install the matching native target and execute the check. The verifier uses
two Cargo jobs by default; `--jobs 1` reduces CPU and memory usage.
`--build-cache /path/to/existing/cargo-target` reuses build outputs while Cargo
still checks the frozen source and lock; choose a fresh report output directory.

Linux:

```sh
rustup target add x86_64-unknown-linux-musl --toolchain 1.99.0
python3 scripts/native-release.py --source-commit 0b913fbaf8c41c26aa7465bd80525f18b1142528 --out dist/linux-verification
```

Mac Apple silicon:

```sh
rustup target add aarch64-apple-darwin --toolchain 1.99.0
python3 scripts/native-release.py --source-commit 0b913fbaf8c41c26aa7465bd80525f18b1142528 --out dist/mac-arm-verification
```

Mac Intel:

```sh
rustup target add x86_64-apple-darwin --toolchain 1.99.0
python3 scripts/native-release.py --source-commit 0b913fbaf8c41c26aa7465bd80525f18b1142528 --out dist/mac-intel-verification
```

Windows PowerShell:

```powershell
rustup target add x86_64-pc-windows-msvc --toolchain 1.99.0
py -3 scripts/native-release.py --source-commit 0b913fbaf8c41c26aa7465bd80525f18b1142528 --out dist/windows-verification
```

The output directory must be new. Successful results contain:

- `verification.json` with `status: "passed"`, exact source and helper hashes,
  host OS/CPU, actual Rust test count and first-use results.
- `packages/` containing the archive and matching SHA-256 file.
- Separate build, test and package logs. A failed check records `status: "failed"`.

Core first-use checks execute the offline demo, independent replay, three
generations, 30 MCP tools, unsigned Cells, agent fault handling, native winner
and loser learning, clone and checkout. Git compatibility is checked separately.
No platform is considered verified based on cross compilation, a zero-test
result or an archive checksum alone. These unsigned archives are not notarized
or Authenticode-signed; do not disable OS protections to run them.

New archives also contain `THIRD_PARTY_NOTICES.txt`, hash-linked from build
metadata. The dependency notices cover the current locked CLI graph across
supported targets. If the frozen source dependency lock differs, regenerate
the notices before packaging. Historical three-file previews remain readable
by the verifier; their absence of notices is recorded separately.

## Distribution and access

Keep archives and logs outside the tracked repository. Before publication,
download each uploaded archive and checksum again and repeat its first-use
check on the corresponding platform. Match the package source commit across
all four targets. Publishing a new package does not promote a new backend.

The GitHub repository currently remains private. Its assets require repository
access. Public binary downloads on `ace.org.ai` make the offline Linux CLI usable
without exposing the source repository. Public source access is a separate
owner decision. Do not claim public GitHub access until visibility or intended
developer invitations have been confirmed.

Website archives are generated artifacts excluded from Git. Restore them from
the verified package output before publishing the static site. Deployment must
include the exact archive and checksum recorded in `downloads/manifest.json`;
never deploy a page pointing to missing or unverified files.
