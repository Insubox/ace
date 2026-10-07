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

| Role | Permission |
| --- | --- |
| Administrator | Read/publish versions, generate/evaluate, create accounts |
| Writer | Read/publish versions and generate/evaluate |
| Reader | Read history, source/results and read-only remote MCP |

Administrators expand **Manage workspace accounts** to create another account.
Everyone shares this one private workspace. Per-repository permissions, independent
tenants, password recovery, user removal, role editing and public signup/OAuth
remain unfinished. The operator retains administrator infrastructure access.

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
Newer/divergent remote histories are rejected: pull into a fresh folder or choose
a new remote name. Pull requires a fresh directory, checks every object hash and
invokes ACE verification on the complete history. There is no force push or
automatic history merge. Publication retries repair interrupted remote indexing;
partial local pulls need inspection and a fresh destination.

Hosting preserves uploaded evaluation records but does not independently qualify
them. Assess evidence with `ace memory`, `ace status` and replay. The browser
displays source as inert text; previews show 8 KiB, downloads preserve exact bytes.
Publisher metadata identifies who first published an entry, not its author.

Native limits are 256 versions/store, 4,096 files/version, 8 MiB/file and
128 MiB/version. One pull also limits distinct objects to 512 MiB. Hashes detect
changes but are not signed checkpoints. Named branches, automatic merges,
review/issues, composition/promotion and production-scale hosting remain future work.

## Verification

`node scripts/check-store-sync.mjs target/debug/ace` uses actual Rust verification
with fixture transport and no credentials/network/paid calls. `npm test` exercises
account storage, setup expiry/reuse, role restrictions and immutable publication
in Workerd. `npm run test:clients` checks private session-file handling too.

The optional `scripts/check-dashboard-browser.mjs` reads deployed HTML/data through
a local read-only bridge, keeping real credentials in Node. Its account forms
use an isolated fixture and create no production accounts. See the
[delivery record](local-delivery-0.3.md) for live results and limits.
