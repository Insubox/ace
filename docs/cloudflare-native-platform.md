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
private. No judge invitation, submission, source visibility change or eligibility
claim has been made.

## Competition-specific acceptance

The official competition page is pending review: the managed environment's proxy
blocked `www.cloudflare.com`. A saved network draft adds that exact host and
preserves the other configured custom domains; the owner must save/publish the
environment change before the page can be retrieved.

Until the official rules are readable, deadline, eligibility, licensing,
mandatory Git protocol behavior, deliverable format and demonstration/access
requirements are **unverified**. The existing hosted architecture establishes
Cloudflare-native implementation, not automatic competition compliance. Once
the rules are available, map each requirement to actual evidence and complete
any missing functionality within the owner's scope and spending controls.

Native macOS executable testing still needs a macOS machine. Cloudflare's Linux
evaluation containers cannot establish native macOS runtime verification. This
does not prevent the browser platform from running on Cloudflare.
