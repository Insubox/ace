# Cloudflare Artifacts agent workspaces

Status as of 2026-10-09: implemented and tested locally. After the owner updated
the provider token's permissions, listing namespaces and reading `ace-agents`
returned HTTP 200. The namespace had no repositories at that observation.
A separate validation Worker, `ace-artifacts-stage-20261009`, was deployed with
its own D1 database, R2 bucket and Durable Object namespace. Its provider settings
confirm the real `SOURCE_WORKSPACES` Artifacts binding to `ace-agents` (HTTP 200).
The validation used a generated ephemeral application secret held in process
memory and configured through the provider secret API. That secret was removed
afterward, so authenticated routes now fail closed. The installation does not
run paid AI, containers, scheduled jobs or production workflows.

After the owner published the validation-host network configuration, hosted
provisioning succeeded: two distinct authenticated test writers created separate
real Artifacts repositories concurrently. One writer could not issue a credential
for the other's workspace (HTTP 403). Both initial provider tokens were revoked.
The real provider returned an HTTPS Git remote on the account-specific hostname
`ef57d8aaa157d5317b2b78c7b7676ca6.artifacts.cloudflare.net`; the managed egress proxy
denied its Git request (HTTP CONNECT 403). An additive network draft for that
exact hostname was saved. Git authentication, pushes and concurrent source
delivery remain unverified. The stable production Worker has not been promoted
to this code and does not yet have the Artifacts binding.

## Storage responsibilities

`Env.ARTIFACTS` is the existing **R2Bucket** binding. It remains the authoritative
store for ACE's SHA-256 content objects, native versions and retained evidence.
The separate optional `Env.SOURCE_WORKSPACES` binding has the official Workers
**Artifacts** interface. Artifacts stages each agent's Git-compatible repository;
it does not replace ACE's version identities, journals, review rules or learning.
D1 and, if added later, Analytics Engine serve analytics. Artifacts is not used
as a statistics database.

Each workspace pins a published native baseline, authenticated creator, declared
agent name and inert task/context text. Agent names identify callers, not proof of
an autonomous model invocation. Two agents use separate repositories and can work
and deliver proposals concurrently. Durable Object transactions serialize ACE
journal/branch publication and prevent workspace-ID reuse or changing a pinned
proposal. Journal/ref conflicts retry at most eight times with fresh state.

## Enabling the provider binding

Activate Artifacts in the account and obtain the actual namespace name. Grant
the deployment token the necessary Artifacts access in that account while
preserving existing Workers/R2/D1 permissions. Keep credentials in secure
environment settings; never put their values in source, chat or a config file.
The precise available permission names and account activation must be verified
in the provider UI; an active token alone does not establish Artifacts access.

Add the following to the **actual private deployment configuration**, replacing
the example namespace with the account's namespace:

```json
"artifacts": [{ "binding": "SOURCE_WORKSPACES", "namespace": "ace-agents" }]
```

The pinned Wrangler 4.147.0 schema supports this binding. A dry-run Worker bundle
with this declaration succeeded using the already verified evaluator image;
`ace-agents` was subsequently provided by the owner. The dry run validates the
binding declaration, not provider access or independent namespace discovery.
Do not deploy the checked-in D1 placeholder IDs. Preserve the deployed image,
resource bindings, secrets, spending enforcement and gated release procedure.
Adding Artifacts does not require rebuilding the unchanged Rust evaluator.

## API and browser workflow

Observatory has an **Agents** view. It shows whether the real binding is
configured, captures the agent's task and starting version, displays retained
proposals, and supports closing a workspace. Actions show progress; missing
provider configuration does not appear as a connected service. Configuration
presence is not a provider health check.

Authenticated routes are scoped to `/v1/projects/PROJECT/workspaces`:

| Method/path suffix | Behavior |
| --- | --- |
| GET collection | List project-private workspace context and truthful binding presence |
| POST collection | Create `{id, agent, base, context}` and an isolated provider repository |
| POST `ID/token` | Issue one repository-scoped write credential, maximum 15 minutes; empty body |
| POST `ID/seed` | Verify `{commit}` has exactly the baseline's native file bytes |
| POST `ID/proposal` | Import pinned `{commit}` as native source and a separate `agent-ID` branch |
| POST `ID/close` | Revoke active provider tokens and close the workspace; empty body |

Project membership is checked on every request. Only the creator or current
project owner can issue credentials, seed, submit or close that workspace.
Readers may see the project's workspace metadata but cannot write. The provider's
initial repository token is revoked, never persisted or returned. Issued tokens
are short-lived, returned with `Cache-Control: no-store`, never stored in ACE
metadata, and revoked after a successful proposal or explicit close. Revoking
ACE membership blocks further API access; a previously issued Git token can
remain valid for its remaining lifetime, up to 15 minutes.

## Local coding-agent client

Requirements: the source checkout, Node 22+, Git, and an ACE account session with
project write access. Create a session using the existing account-login client.
Create a workspace in Observatory's Agents view and copy its ID. Then:

```sh
node cloud/scripts/artifact-workspace.mjs prepare \
  --project PROJECT --workspace UUID --directory NEW_FOLDER --session ace-session.json
```

The client verifies the ACE baseline manifest and every SHA-256 source object,
then creates a fresh directory, Git repository and baseline commit. It pushes
that baseline to Artifacts and asks ACE to verify it. The task/context is retained
in `.git/ace-workspace.json`, outside the tracked source. For a network failure
after local preparation, repeat the command with `--resume`; this requires the
unchanged, clean baseline. Existing directories are otherwise never overwritten.

Let the agent edit its assigned files and commit its changes. From the ACE source
checkout, submit with:

```sh
node cloud/scripts/artifact-workspace.mjs propose --directory NEW_FOLDER --session ace-session.json
```

The client requires a clean committed working tree, pushes an exact commit,
then asks ACE to retain it. Its Artifacts authorization header is scoped to the
HTTPS remote in process memory, with redirects and prompts disabled; tokens do
not enter command arguments, remote URLs, Git config, reports or console output.
The current client uses bearer authentication. That provider-specific Git
authentication and the real push/seed/proposal path still need live verification.
Local-client tests perform actual Git init/add/commit while substituting the
unavailable provider network operations; they are not hosted Artifacts evidence.

## Source verification, limits and costs

The Worker reads the exact Git commit, checks ancestry against the verified seed,
validates its whole tree and checks Git blob SHA-1 bytes before deriving native
SHA-256 objects. It rejects unsafe paths, Git/ACE metadata directories, symbolic
links, submodules, reserved platform filenames, corrupt blobs and oversized
content. Import limits are 512 files, 1,024 tree entries, depth 16, 1 MiB per file,
8 MiB total and 64 traversed ancestry commits. ACE's native file model preserves
file bytes and paths, not Git executable modes or empty directories.

There are at most 32 retained workspace records per project, eight credentials
per workspace, a 48-hour workspace lifetime and 15-minute credentials. Closed
records and provider repositories are retained; closing revokes access but does
not delete provider storage. New repository attempts reserve USD 1 in ACE's
account ledger as a **conservative planning allowance, not a provider price**;
creation and credential issuance fail closed when the spending snapshot is stale
or the operator has paused starts. These controls do not impose a Cloudflare
invoice cap or measure Git transport/storage charges. Direct Git pushes use the
provider's limits; the 8 MiB limit applies to import into ACE, not every upload
through an issued Git credential.

The receipt labels the result `source_only_requires_independent_review_and_evaluation`.
It never promotes `main` or labels a proposal a winner. Use existing ACE comparison,
review, conflict resolution, independent approval, merge and evaluation flows.
Positive/negative learning comes from recorded evaluations, not Git import.

Workspace identities, task context, seed and proposal mappings are included in
native backup/isolated restore. Accepted source remains in ACE's R2 objects.
This backup does not copy the external Artifacts repository, unused Git objects,
or access tokens; recreating unfinished provider workspaces after a disaster
requires separate provider reconciliation. Restored metadata does not grant
credentials through ACE's read-only recovery routes.

## Validation before hosted activation

The cloud suite passed 153 tests in 21 files, and the client suite passed 46 tests.
After further size/retry changes, the focused workspace suite passed 12 tests
and the focused agent-client suite passed five tests.
The workspace cases exercise real local Durable Object/D1/R2 publication, concurrent
agent proposals, unchanged main, retries, creator/membership checks, token limits,
initial-token revocation, hostile source, corrupt/large blobs, detached ancestry,
spending reservations and restoration of task context. Provider RPC is simulated.
The client cases also check real local Git preparation, resume, exact-byte hashes,
in-memory credentials, no overwrite and refusal of linked Git directories.

Hosted provisioning acceptance on 2026-10-09 also read back the private native
baseline and branch references, unchanged `main`, retained task context after
closure, both USD 1 planning reservations and revoked provider credentials.
Both test workspaces were closed and the ephemeral application secret removed.
The empty external repositories remain retained, consistent with the close API.
These were validator-controlled accounts, not autonomous agents or independent
human reviewers; the checks do not establish hosted proposal import or approval.

Remaining hosted acceptance: activate the provider Git-host network access;
prepare and push two real workspaces concurrently; retain
both exact proposals and task context; exercise a source conflict and independent
review; confirm main and learning behave as recorded; close/revoke credentials;
read back the real Artifacts binding. Only that establishes hosted integration.
Production activation must then follow the existing native review/release gate.
