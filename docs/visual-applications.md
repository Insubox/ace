# Visual application projects

The three application profiles now also support `nodejs-decimal-v1`: a JavaScript
core shared by a Node command and a browser UI, a nested source tree, syntax
compilation, and a third-party dependency. The Python console profiles remain
available. Each runtime is tested against the same independent public contracts
(Hello World 11 cases, TicTacToe 20, Calculator 29).

Build the CLI from the GitHub checkout, prepare the offline evaluator, then create
one project:

```sh
cargo build --locked -p ace-cli
docker build -f applications/Dockerfile -t ace-applications:local .
./target/debug/ace app init calculator ./my-calculator --runtime nodejs-decimal-v1
./target/debug/ace app test ./my-calculator --image ace-applications:local \
  --output ./calculator-result --store ./ace-history
cd my-calculator
npm ci --ignore-scripts --no-audit
printf '%s\n' '{"op":"add","a":0.1,"b":0.2}' | npm start --silent
cd ..
node applications/serve.mjs ./my-calculator
```

Open the printed loopback URL. Replace `calculator` with `hello-world` or
`tictactoe` to create the other examples. The local server reads only known example
assets and starts no cloud work. `npm ci` installs decimal.js **10.6.0** with npm's
SHA-512 integrity from `package-lock.json`. Calculator uses it for decimal
arithmetic. ACE additionally fixes the library source SHA-256 to
`6e99821f8204c5f611b56077e3fce056a1562d22bc341a1f4af01afe7e527d83`.
The evaluator contains those checked-in MIT-licensed bytes; candidate runs download
nothing. Modified manifests, dependency/package locks, unknown source paths and
symlinked source are rejected. New dependency versions require a reviewed runtime
profile update and fresh evidence.

Projects contain `src/main.cjs`, `src/core.js`, `web/index.html`, `web/app.js`,
`web/style.css`, the manifest, dependency lock, npm manifest/lock and README.
Each editable file is at most 32 KiB and the combined project at most 128 KiB.
Compilation checks the CLI, shared core and UI script without executing candidates.
The cloud broker receives one batch of public inputs and starts a fresh child for
each case. Expected values stay in the Worker, which compares outputs after each
child exits. This avoids a separate container RPC for every case. Each child has
a 2-second CPU and 6-second Node wall deadline (Python retains 3 seconds), bounded output and
48 MiB Node heap, one V8 background worker and one libuv pool worker. Node needs a larger virtual address reservation than Python;
the local container's real memory stays capped at 256 MiB with 16 PIDs. Local staging keeps source files private to the developer UID (1000 in the
container); the UID process ceiling allows existing developer processes on the
host, while the container strictly caps all PIDs at 16. The cloud child uses a
64-process ceiling. Source and
root filesystem mounts are read-only. The trusted broker is outside the candidate
process; expected outputs and credentials are never supplied to it.

In Observatory, choose **JavaScript · visual app**, load an example and inspect
all files. **Preview visual application** executes the proposed browser code only
when clicked. Its frame has an opaque origin: no `allow-same-origin`, top navigation
or popups. Scripts and form handlers run, while CSP blocks network connections,
form destinations and external resources. Closing the preview, changing projects
or signing out destroys it. Candidate code never executes in the Observatory
page. The browser uses the exact hash-checked library and shared core. Preview
behavior is separate from the server's compiled/tested evidence; tests do not yet
qualify arbitrary UI edits.

Every backend attempt keeps original source and pass/fail learning in native ACE
versions. Retained projects can be checked out, tested again and edited as a new
proposal. Agent campaigns also select the JavaScript source files automatically;
locked dependencies and UI files cannot be rewritten by the model. Applications
remain three public, bounded profiles; arbitrary npm install scripts, networked
servers and general native builds are outside this runtime.

When an evaluator image changes, `POST /v1/projects/:project/applications/:run/replay`
retests that server run’s exact retained source, with the previous result as its
parent. No edited files are accepted, no branch is moved and old learning stays
immutable. Two replay admissions per UTC day share the existing 16-container
ceiling; the eight-new-proposal limit is unchanged. Repeating a request uses the
same replay identity. This is an explicit operator/developer action, not an
automatic paid retry. Existing evidence from a different image cannot start a new
agent campaign until retested.

On 2026-10-08 all 60 public cases passed locally for each runtime. Real Chromium
checked Hello World's inert text, TicTacToe win/draw/reset and Calculator decimal
arithmetic, as well as the preview's parent-access and network restrictions.
The hosted JavaScript calculator passed 29/29 on the final evaluator, and its
native result was downloaded and reproduced in a fresh offline local container.
Earlier cloud attempts timed out late in the suite; their failure reports remain
retained. The `--runs app-<id>` option of `scripts/check-hosted-applications.mjs`
selects a retained run for reproduction without spending a new cloud container.
Hosted Hello World/TicTacToe JavaScript execution was not additionally requested
after exhausting the day's proposal/replay admissions.
