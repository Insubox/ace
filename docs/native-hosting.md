# Private ACE hosting and accounts

ACE hosts its native objects and versions in R2, with a serialized Durable Object
journal and a D1 index. Local and hosted versions retain the same ACE IDs; Git is
not the storage or synchronization engine. The browser displays source trees,
parents, messages, publication identity and hash-checked files. The main
[Observatory interface](observatory.md) adds Home, Trials and Learning views for
retained evaluation records, winner/failed source and scoped claims.

The deployed technical preview is [ACE](https://ace-control-plane.nex-insure.workers.dev/).
Its data is private; the public page contains only login. For your own deployment,
follow [the Cloudflare guide](phase2.md), including all migrations in
`cloud/migrations/`, the HTML Text rule and the authenticated bindings.

## First administrator

The deployment operator requests `POST /v1/auth/setup-ticket` with its configured
bearer token. The returned relative `/setup#setup=...` path creates a private link
for the intended owner. It expires after ten minutes, works once and creates only
the first administrator. A new ticket invalidates the previous one. The owner
does not need the operator token; keep that token in your secret manager.

Open the link, choose a username/password, repeat the password and press
**Create my account**. Then sign in below. The page clears the setup fragment from
the address bar before requests and keeps it only in memory. An expired or used
ticket is rejected. If no account was created, the operator can issue a fresh
ticket; once an account exists, use administrator login.

Usernames use 3–32 lowercase letters, digits, hyphens or underscores, starting
with a letter or digit. Passwords contain 12–256 UTF-8 bytes. Salted passwords
use PBKDF2-SHA256 with 100,000 iterations, supported by Workers Web Crypto.
Only password and session-token hashes enter D1. Sessions expire after twelve
hours; sign out revokes one. Login permits 20 attempts per ten minutes for each
username and source IP.

| Account role | Permission ceiling |
| --- | --- |
| Administrator | Manage accounts/recovery and act within explicit project membership |
| Writer | Create private projects; read/write projects where granted |
| Reader | Read projects where granted; no publishing, evaluation or membership changes |

Project roles are **owner**, **writer** and **reader**. Owners grant/revoke membership
through **project access** in the Observatory. A global administrator account does
not automatically read private projects. Administrators remain trusted credential
managers: password recovery can transfer control of the recovered account. The
infrastructure operator can access all projects and recover administrators.

On upgrade, existing accounts retain their earlier shared access to legacy projects
(admin becomes owner). Newly created accounts receive no project memberships.
First-administrator bootstrap takes ownership of pre-existing operator projects.
The last project owner cannot be removed or downgraded; concurrent changes and
revoked creators cannot bypass this restriction.

**Manage workspace accounts** creates accounts and private recovery links. A link
expires after ten minutes, works once and is invalidated by a replacement link.
The recovery page immediately removes the fragment from browser history; successful
recovery replaces the salted password hash and revokes all sessions atomically.
Share links privately with their intended account owners. No public signup, email
delivery, OAuth/MFA, account deletion or global role editing is implemented yet.

Project audit records membership, publications, evaluations, verification and model
requests. Account audit records creation and recovery. They exclude passwords,
tokens, private recovery codes and source payloads; views return the latest 100
records. Audit rows use infrastructure storage, not externally signed checkpoints.

Every alternate artifact, experiment, generator, judge and MCP read checks project
access. Upload exact artifacts before evaluation. Set `X-ACE-Project` on model and
artifact writes (`ACE_PROJECT` for Node operator clients). Identical model inputs
are locked to the first project; existing unassigned legacy model records remain
operator-only until the operator explicitly submits the same inputs in a project.

## Terminal login and native sync

Remote clients need Node 24 and a source checkout; local ACE runs by itself.
From the checkout in an interactive terminal:

```sh
node cloud/scripts/account-login.mjs --origin https://ace-control-plane.nex-insure.workers.dev --output /private/path/ace-session.json
```

Replace the output with a fresh file in your private user directory. Enter your
ACE username/password at the prompts. The password is hidden and never enters
arguments or output. The session file is created exclusively with Unix mode
`600`; secure its directory/ACL on Windows. Keep it outside your repository: it
contains a bearer session. Delete it after use and sign in again when expired.
Output contains only public account metadata.

With ACE 0.3.0 installed:

```sh
ace demo first
ace store save first/run --store my-history
node cloud/scripts/store-sync.mjs push my-history my-project --ace /absolute/path/to/ace --session /private/path/ace-session.json
node cloud/scripts/store-sync.mjs pull downloaded-history my-project --ace /absolute/path/to/ace --session /private/path/ace-session.json
ace store log downloaded-history
```

Replace executable/session paths with yours; use `ace.exe` on Windows. Remote
names use 1–64 letters/digits/hyphens/underscores, starting with a letter/digit.
Select the store in the browser to inspect source and learning. Existing operator
integrations may instead use securely configured `ACE_API_URL`/`ACE_API_TOKEN`.

Push invokes local Rust verification, checks object hashes and publishes the
journal after objects/versions. Identical retries cannot replace immutable entries.
Missing remote DAG nodes require `fetch` into the local store; source merges preserve
version identities while reconciling publication order. Branch updates use explicit
previous-head expectations. See the [native collaboration workflow](native-collaboration.md)
for verified diff, merge, conflict preservation and concurrent writers. Pull still
requires a fresh directory and verifies the complete native history, including refs.
Partial local pulls need inspection and a fresh destination.

Hosting preserves uploaded evaluation records as declared. The optional
[server verification workflow](server-verification.md) independently checks native
snapshots and retains a separate environment-scoped receipt and fresh run.
Assess original local evidence with `ace memory`, `ace status` and replay. The browser
displays source as inert text; previews show 8 KiB, downloads preserve exact bytes.
Publisher metadata identifies who first published an entry, not its author.

Native limits are 256 versions/store, 4,096 files/version, 8 MiB/file and
128 MiB/version. One pull also limits distinct objects to 512 MiB. Hashes detect
changes but are not signed checkpoints. Named branches and bounded native diffs/merges are implemented; review/issues,
composition/promotion, full hosted merge UI and production-scale hosting remain further work.

## Verification

`node scripts/check-store-sync.mjs target/debug/ace` uses actual Rust verification
with fixture transport and no credentials/network/paid calls. `npm test` exercises
account storage, setup expiry/reuse, role restrictions and immutable publication
in Workerd. `npm run test:clients` checks private session-file handling too.

The optional `scripts/check-dashboard-browser.mjs` reads deployed HTML/data through
a local read-only bridge, keeping real credentials in Node. Its account forms
use an isolated fixture and create no production accounts. See the
[delivery record](local-delivery-0.3.md) for live results and limits.
