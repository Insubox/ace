# ACE as a Cloudflare-native platform

The owner is entering [Cloudflare's Git competition](https://www.cloudflare.com/git-competition/?cf_page=next-git-platform-on-cloudflare%2F).
ACE's submission target is its hosted browser platform and native version engine.
The downloadable Linux/Mac CLI is an additional local client, not a requirement
to use the browser platform.

## Existing hosted implementation

| Platform responsibility | Cloudflare service | Implemented behavior |
| --- | --- | --- |
| Public site | Workers Static Assets | `ace.org.ai`, guide, public archive/checksum downloads |
| Browser and API | Workers | Observatory, account sessions, private project membership, source browsing, reviews and issues |
| Source and retained evidence | R2 | Immutable content-addressed files, version manifests, evaluator evidence and backups |
| Native version coordination | SQLite Durable Objects | Hash-linked journals, branch compare-and-swap, review revision/approval checks and atomic merge coordination |
| Metadata and account state | D1 | Accounts, memberships, project indexes, audit records and workflow status |
| Long-running work | Workflows | Experiments, trials, application evaluation/campaigns, native verification and isolated backup/restore |
| Evaluation scheduling | Queues | Bounded evaluation/finalization queues and dead-letter handling |
| Supported untrusted execution | Cloudflare Sandbox/Containers | Independent WASM and supported application evaluations |
| Optional coding/judge models | Workers AI | Bounded Qwen/Llama generation and judge adapters, guarded by spending controls |

Hosted storage uses ACE's own version/object/journal identities. GitHub hosts the
source distribution; it is not the database or version-storage dependency of the
deployed platform. Git compatibility is optional. A native snapshot, source
comparison, review and merge can be used through Observatory without installing
Git, Rust or the local CLI on the visitor's machine.

Provider settings were read back from the actual deployed Worker: AI, six
Workflow bindings, three Durable Object namespaces, D1, R2 and both queues are
registered. The live operations endpoint returned HTTP 200 with spending
control enforced and zero current alerts. This does not substitute for the
competition rules or independently exercise every service in that read.

## Demonstration using the existing deployment

The private deployment is
`https://ace-control-plane.nex-insure.workers.dev/`. A demo participant needs an
ACE account with explicit project access. The project owner can use:

1. **Versions:** inspect exact retained source and native parents.
2. **Reviews:** compare branch heads, comment, obtain independent approval and merge.
3. **Applications:** compile/test Hello World, TicTacToe and Calculator with the
   hosted evaluator, retaining passing/failing source and evidence.
4. **Learning:** inspect compatible supported evaluation records and links to source.

The external Click pilot is present in the private `click-pilot` project with
seven versions, 166 objects, a verified hosted download and a pending independent
review. Its full wheel build/tests ran in the local Linux profile; the hosted
three-template Applications evaluator does not yet execute an arbitrary Click
checkout. These distinct capabilities must remain clear in a competition demo.

Source repository access, public registration and access for competition judges
are separate from hosted platform functionality. The repository currently remains
private. No judge invitation, submission or source visibility change has been made.

## Competition-specific acceptance

The owner supplied the official `build-next-gen-git-platform-competition-terms.pdf`.
Its SHA-256 is `a87556a400bddca338dfc1612692b303908134594a27cb2d65ebe44707ed57dd`.
The requirements below come from that document, rather than assumptions from the
product name or the previously blocked marketing page.

| Official requirement | Current evidence / remaining work |
| --- | --- |
| Workers **and Cloudflare Artifacts** (section 4) | Workers is deployed. The existing `ARTIFACTS` binding is an R2 bucket and does not satisfy the Artifacts product requirement. The [workspace adapter](artifact-workspaces.md) is implemented/tested locally; real service access and hosted acceptance are pending. |
| Multiple agents working on changes concurrently (section 4) | Local workspace tests retain simultaneous proposals in separate native branches with task context. A real hosted Artifacts demonstration of agent changes, coordination, review and conflicts is still required. |
| MIT, Apache 2.0 or BSD 2/3-Clause source license and root LICENSE (section 4) | Owner's licensing decision and root LICENSE are pending. No license grant or repository visibility change has been made. |
| Complete source and execution instructions (sections 4 and 9) | Private source repository and local/cloud instructions exist. Judges' source/platform access must be arranged; the rules do not explicitly mandate a public repository. |
| 5–10 minute demonstration video and completed application (section 4) | Recording and manual submission are pending. Automated entry is expressly prohibited. |
| Deadline (section 2) | October 14, 2026, 11:59 PM PDT; October 15, 2026, 12:59 AM in Mexico City. |
| Legal US/Canada residence and age 18+ at contest start (section 3) | Owner confirmed both in this conversation. This is a declaration, not independent eligibility verification. |

The scoring weights are 50% originality/quality for agent-oriented software
collaboration, 25% concurrent agents, coordination, context preservation, review
and conflict handling, and 25% usability/UX (section 6). Finalists give a 10-minute
live presentation on October 21, 2026 at Cloudflare Connect, Moscone West,
San Francisco; a potential winner must be physically present (sections 6–7).

The rules do not explicitly require a Git HTTP/SSH server, arbitrary Click builds
in the hosted evaluator, or native binaries for every desktop platform. Do not
present those as mandatory contest acceptance. Conversely, merely naming an R2
bucket ARTIFACTS is not use of the required product. ACE is not yet claimed to
meet all submission requirements.

Mac Intel execution was completed on the owner's Mac and the resulting package
is publicly available as a beta; Windows/Mac Apple silicon native packages remain
pending. Cloudflare's Linux containers cannot establish native macOS execution.
