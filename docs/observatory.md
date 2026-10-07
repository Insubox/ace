# ACE Observatory

The Observatory is ACE's main hosted interface at `/`; `/setup` uses the same
interface for first-account creation. It adopts the supplied Observatory v2
visual proposal: cream paper, Newsreader headings, Geist Mono labels, thin rules,
orange accents and a three-column experiment view. The implementation connects
to ACE's authenticated native hosting API. It has no external font, script or
analytics requests.

Select a native project history in the header. The four views show:

| View | Retained data |
| --- | --- |
| Home | Native publication activity, history counts, scoped claims, Cells and the latest recorded local Champion |
| Trials | Completed evaluation records, Knowledge records and declared parents, objectives, candidate outcomes, exact WAT source, evidence and policy decisions |
| Learning | Positive, rejected and unresolved claims, kept separate by project, Cell, Intent, environment and EvalSpec |
| Versions | Source/evaluation/generator-fault versions, ancestry, publisher, original files and exact downloads |

Trials filters distinguish qualified results, failed checks and unresolved
outcomes. Missing fuel is displayed as unavailable, never as zero. Generator
faults count separately and do not imply an evaluated candidate failed.
Administrator account creation remains available through **accounts** in the
header. Reader accounts cannot administer users. All accounts share one private
workspace; see [native hosting](native-hosting.md) for authentication and limits.

## Data and integrity boundaries

The interface loads the newest twenty versions of the selected native history.
The native version count covers the complete journal; observation, claim and
fault counts cover loaded records only. Evaluations and evidence observations
are deduplicated by their recorded identities. Claims are deduplicated within
their recorded evaluation context. Knowledge records display declared parents;
the layout does not invent a lineage between unrelated records.

Downloaded file bytes are SHA-256 checked against native manifest references
before display or download. Evaluation metadata must identify the report stored
in its version; duplicate candidate IDs and inconsistent reported Champions are
rejected. Invalid or missing reports are marked unavailable while original
version files remain accessible. These checks do not independently qualify
uploaded outcomes or establish signed provenance. Run native ACE verification
and replay to assess the recorded evidence. The optional
[server verification](server-verification.md) control in Trials requests an
independent evaluation and displays its separate receipt.

Source is inert text. Previews show up to 8 KiB and downloads preserve complete
bytes. Requests have timeouts and streamed size limits; file previews allow
8 MiB, evaluation documents 2 MiB, and the private byte cache 32 MiB. Signing out
aborts pending loads and clears credentials, cached bytes and private views.
The interface uses in-memory sessions and a restrictive Content Security Policy.

The prototype's simulated production rollouts, canaries, costs, budget controls
and promotion actions are not implemented backend operations. The main
interface displays completed retained experiments; generation and evaluation
remain available through ACE's existing CLI/API/MCP workflows. Production
promotion remains unfinished.

## Fonts and verification

Embedded font files come from the supplied visual proposal. Their upstream
SIL Open Font License notices are included in
[`cloud/fonts/geist-mono-OFL.txt`](../cloud/fonts/geist-mono-OFL.txt) and
[`cloud/fonts/newsreader-OFL.txt`](../cloud/fonts/newsreader-OFL.txt).

`npm run test:clients` exercises report consistency, context separation and
observation accounting. `npm test` verifies account roles and hosted storage.
The optional `scripts/check-dashboard-browser.mjs` uses Chromium CDP on port
9222, reads hosted native data through an isolated local bridge, and tests only
fixture account mutations. It checks all four views, mobile layout, winner and
failed source, inert markup, hash failures, logout and CSP violations.

For a local HTML candidate, set `ACE_DASHBOARD_HTML=cloud/src/dashboard.html`.
Without this variable the script checks the deployed HTML and CSP. Network
credentials stay in the bridge's Node process; production accounts are never
created by this check.

The 2026-10-07 deployment passed TypeScript checks, 36 Workerd tests and 19
Node client/model tests. Chromium checked the deployed main UI with six real
hosted native versions, three evaluation reports, eighteen retained observations
and one generator fault. Account creation/sign-in used isolated fixture transport;
there were no production account mutations. All four mobile views fit a 390 px
viewport, inert source stayed inert, corrupted file downloads were refused, and
no runtime exceptions or CSP violations were recorded. The deployed root/setup
returned 200 and unauthenticated native history returned 401.
