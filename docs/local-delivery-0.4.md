# ACE 0.4.0 technical preview

ACE includes its own native source/version engine, named branch heads with
compare-and-swap updates, bounded diff and three-way source merge, divergent DAG
synchronization, retained winning/losing source and learning, private projects,
account recovery, audit, private backups and isolated restoration drills.
The Observatory is the main interface and can run one manual WAT proposal
against a trusted reference for Gcd, MaxU32 or MinU32.

The source changes address the reported unsafe file-read patterns through
bounded regular-file reads, rejection of symlinks and special files, and held
directory handles. Eight filesystem/CLI regression tests exercise the reported
boundaries. The separate fix commit is `3a24094`; no SAST findings are suppressed.
See [file input security](file-input-security.md) for the exact boundary and
remaining filesystem limitations. A new source SAST result is still required to
confirm the external scanner's finding status.

Local validation passed 122 Rust tests, 74 Worker tests and 21 Node client tests,
Clippy, formatting, all 45 generated schemas and portable library WASM builds. Release
jobs run the full Rust workspace on Linux, both macOS architectures and Windows,
then check each extracted executable with no provider credentials. Package
checks include all 30 local MCP tools and real positive/negative unsigned Cell
evaluation and replay. A matching version tag publishes only after all four
platform jobs succeed; an existing preview tag is never replaced.

Actual cloud validation includes Gcd winning and losing proposals, a qualified
MaxU32 proposal tied with its reference, and a rejected signed MinU32 proposal.
All four retain their exact sources and independently reproduce after download.
Browser verification covers the three-Cell selector and examples, private
projects, reader restrictions, source hash checks, inert previews, native
branches, interrupted HTTP retry, mobile layout and logout clearing private
data. Account mutation checks use an isolated fixture.

The offline [learning comparison](learning-comparison.md) re-evaluates equal
proposal budgets from the same fixed pool. Retained memory avoided an exact
known failure and selected the known qualified source, improving observed best
fuel from 37.75 to 23.5. This does not measure novel LLM program quality or
generalization. Live provider experiments have not established an AI-generated
qualified improvement or production filtering savings.

Authenticated infrastructure [operational observations](operations.md) expose
retained status counts, completion duration including repairs, actual daily
trial/container budgets and backup freshness. They contain no invented dollar
cost or live queue/concurrency claim. Infrastructure authority remains separate
from project/account permissions.

Local Linux package verification and remote release job outcomes are distinct.
This environment cannot presently read GitHub Actions results: the request to
`api.github.com` is blocked by the current network policy. The domain addition
is saved in the environment draft and requires publication before a new access
check. macOS/Windows execution and downloadable release assets remain unverified
until their remote jobs can be inspected.

The static Linux package built from `ea27ac0730f471ac21e3dc437857b62e5e01e96e`
has archive SHA-256
`43e80bfdd5bbdb5a9844918f5cc3ac60ab8b6141ca2074ff5c9748a549fa35e0`.
Its extracted executable passed the 13-program demo, three generations,
positive/negative unsigned Cells, 30-tool MCP, agent campaigns, native
memory/clone/checkout and independent Cell replay with credentials absent and
an empty external-tool PATH. Git compatibility was checked separately. A fresh
HTTPS clone of GitHub main built and ran the complete demo. Cross-target
`cargo check --workspace --all-targets` passed for Windows MSVC, Mac Apple silicon
and Mac Intel; this verifies compilation, not execution on those operating systems.

ACE remains a bounded technical preview. Hosted review/issues, arbitrary native
application builds, IDE integrations, canonical Composition/promotion, measured
100-container concurrency, external monitoring and a production failover are
unfinished. These capabilities are required before calling ACE a complete
replacement for GitHub.
