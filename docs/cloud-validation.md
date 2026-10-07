# Live Cloudflare validation — 2026-10-06

The authorized ACE deployment uses the private API Worker
`ace-control-plane.nex-insure.workers.dev`, native Durable Object-managed
Containers, Workflow `ace-experiments`, D1 `ace-metadata`, R2 `ace-artifacts`, and
queues `ace-evaluations`, `ace-finalizations`, `ace-dead`. The remote D1 migration
was applied. The pre-existing `nex-email-ingress` Worker was preserved.

The deployed evaluator image manifest digest is
`sha256:4e413227d193b21e7b1b868bb5c25873f303f02f93edb6ae4270f31e77808ffa`.
Cloudflare confirmed image preparation, reconciled both Durable Object classes,
and deployed the Worker, Workflow and queue bindings. The Worker source did not
require changes to pass the live tests.

## Experiments

Each population uses the reviewed GCD modules, frozen by `ace cloud prepare`.
The larger populations repeat known implementations with distinct registered
candidate IDs. They exercise orchestration, not model-generated diversity.

| Candidates | Total evaluations, including baseline | Queue concurrency limit | Workflow wall time | Workflow result |
|---|---:|---:|---:|---|
| 5 | 6 | 2 | 49.069 s | Complete |
| 10 | 11 | 5 | 57.664 s | Complete |
| 100 | 101 | 100 | 302.876 s | Complete |

Times come from Cloudflare's Workflow start/end timestamps. They include dispatch,
container startup, evaluations and finalization; they exclude local downloads.
They are individual observations, not throughput guarantees or cost estimates.

Initial experiment:
`EXP-2b0201481010763b93717146e403360dc3d61d9da2d72d42b0d033c8f0b41b03`.
The baseline, Euclid and binary GCD qualified. The independent Oracle rejected
the incorrect implementation; the spinning and memory-growth modules failed
resource limits. `C-euclid` became the scoped Champion, with 240 checked calls,
mean fuel 24.25 versus baseline 2000.25. This result concerns the frozen harness
and Wasmi fuel objective, not production latency or CI cost savings.

Ten-candidate experiment:
`EXP-a1c6220d42e3ace441ea61d3d66fc72a80cf0300b9c72dcf533857561f5a4a85`.
All 11 evaluations completed; `C-known-001` became the scoped Champion.

Hundred-candidate experiment:
`EXP-732ea7766fc95762e5fe4d5c67fca1f11593df4b9e98950675d9114a4ee37020`.
All 101 evaluations completed: 41 qualified, 20 failed correctness, and 40 failed
resource limits. `C-known-001` became the scoped Champion. The 101 accepted sealed
observations were independently downloaded from R2; their full environment
fingerprints matched exactly. Aggregation also passed independently in the same
release evaluator image with networking disabled.

All three reports and their modules were downloaded through the
authenticated API and verified by `ace status`, including domain seals, artifact
hashes and reproduced Rust policy gates. Champion, knowledge, explain and evidence
requests returned 200; unauthenticated requests returned 401. MCP listed all four
read tools. The hundred-candidate download contained 411 JSON documents and
passed the same Rust validation. Submission through verified local download took
499.733 seconds for that run; its Workflow itself took 302.876 seconds.

## Concurrency limits

Setting the queue limit to 100 does not demonstrate 100 simultaneous Containers.
During the hundred-candidate run, 122 samples of the application's health endpoint
reported a peak of two active instances. Sampling and platform aggregation can
miss short-lived execution; these readings do not establish an exact execution
concurrency. Neither a completed 101-task population nor retained Durable Object
assignments establish simultaneous activity. The 100-parallel target still needs
an instrumented benchmark with container lifecycle intervals and clock uncertainty.

## Authentication and environment operation

Deployment authentication is `CLOUDFLARE_API_TOKEN`, restricted to
`api.cloudflare.com`. Keep `registry.cloudflare.com` network access enabled:
Wrangler obtains separate short-lived registry credentials through the API.
Injecting the deployment token at the registry caused the initial push failure;
removing that secret destination restored image publishing.

App authentication is a separate Worker secret, `API_TOKEN`, with at least 32
random characters. Validation generated app credentials in process memory and
configured them through the authorized API; values were not written to source,
logs or saved setup instructions. For persistent CLI/MCP access, configure the
same app credential in the Worker's `API_TOKEN` secret and the environment's
`ACE_API_TOKEN` secret, scoped only to the Worker hostname. Do not send it in chat.
`ACE_API_URL` is the non-secret Worker origin. The standard submit/download clients
then use the configured bearer credential through the supported proxy route.

The permanent app/environment binding was subsequently configured by the user.
An authenticated MCP ping and reads of both the initial and 101-observation
completed experiments returned 200 using `ACE_API_TOKEN`. Later deployments
preserve that credential; validation does not rotate it.

Node 24 clients in the managed environment need `NODE_USE_ENV_PROXY=1` to use the
inherited proxy; preserve the supplied CA trust and TLS verification. The Python
validation client uses an explicit ACE user agent: its default Python user agent
received Cloudflare error 1010, while ACE, curl and Node clients reached the Worker.
Allow time for a changed Worker app secret to propagate across requests.

The account-specific deployment file and helper records remain outside source or
in ignored directories under `/workspace/.ace-env/cloud-deployment` and
`cloud/.ace-build`. Docker login/push uses a private temporary configuration via
the supported `WRANGLER_DOCKER_BIN` hook; the platform's original configuration
and credentials are preserved, and temporary registry authentication is removed
after publishing. Setup activation does not provision or deploy automatically.

No implementation was pushed to GitHub by this validation. Saving environment
instructions is distinct from publishing a filesystem snapshot or validating a
new task's restoration.
