# Application and collaboration validation — 2026-10-08

This records completed checks and their scope. It does not assert general build
support, production performance, a public binary release or external SAST closure.
The work used local checks and explicit bounded cloud runs, without GitHub Actions.

| Area | Observed result |
| --- | --- |
| Rust workspace | 127 tests passed; formatting and Clippy passed. |
| Worker | TypeScript check and 112 tests in 17 files passed. |
| Client scripts | 23 tests passed, including monitor delivery/deduplication fixtures. |
| Native histories | 1,024th version accepted, next rejected; paged UTF-8 state and legacy migration checked. Twenty concurrent publishers had one winner; forty campaign admissions stayed within the limit of 32. |
| Hosted collaboration | Actual account cookies, task/comment/update, notification read, conflict resolution, obsolete approval rejection, fresh independent approval and native merge identity checked. Temporary test accounts and sessions removed. |
| Browser | Chromium checked seven deployed views and mobile layout, persistent reload/new-tab sessions, cross-tab logout, reader permissions and private-data clearing. Source remained inert; corrupted objects were refused. |
| Agent evolution | Real Qwen repaired Python Calculator from 0/29 to 28/29. Tied proposals were retained and rejected as improvements; the branch did not move because one case still failed. |
| Application examples | Hello World 11/11, TicTacToe 20/20 and Calculator 29/29 passed in fresh offline local containers for both Python and JavaScript. Nested files, immutable dependency locks and symlink rejection checked. |
| Visual examples | Chromium checked Hello World text escaping, TicTacToe win/draw/reset and Calculator decimal arithmetic/division-by-zero. Opaque preview blocked access to Observatory and network requests. |
| Hosted JavaScript | Calculator 29/29 on the final broker; downloaded native source/result reproduced 29/29 in a fresh offline local container. A campaign from that passing baseline stopped with no model or candidate execution. |
| Recovery | Sealed backup and isolated restore verified 1,821 objects and 17 metadata tables. Native application history recovered 19 versions. Sessions were not restored and production writes were zero. |
| Operations | Live monitor observed no active alerts. No external receiver was configured and no external messages were sent. |

The hosted JavaScript result is
`b57955d977a318ea5ac535838ca2a9a0c778467e7611450ac2376ea04a99916e`.
Its evaluator image digest is
`sha256:950bd3645386638b9b71492d7a621c06b3ccc0cd626366069fd2f2ba07840aef`.
Earlier JavaScript runs timed out late in the suite. Their source and failure
learning remain immutable. The final cloud broker submits inputs in one batch,
starts a separate bounded child for every case, and leaves expected values in
the Worker. Hosted JavaScript Hello World/TicTacToe were not separately executed
after the day's admission limits were reached; their local and browser checks passed.

The recovery snapshot predates the later JavaScript project and final hosted
collaboration smoke test. It proves restoration of retained Python applications,
agent generations and learning. Task restoration, including a project containing
only tasks, also has regression coverage. This drill does not switch production
traffic or establish a failover SLA.

The external scanner that reported the filesystem findings still needs a fresh
scan. GitHub code scanning returned HTTP 403 because it is not enabled for this
repository. The alert monitor supports an explicitly configured HTTPS receiver;
operating an independent monitor and receiver remains an operator responsibility.

For developers, [visual-applications.md](visual-applications.md) gives the source
build, offline test and browser example commands; [application-evolution.md](application-evolution.md)
explains retained winners and losers, and [operations.md](operations.md) covers monitoring
and recovery limits.
