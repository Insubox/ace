# Two coding agents and verified delivery

On October 12, 2026, two actual Codex coding agents worked concurrently on ACE's
client delivery components in separate Cloudflare Artifacts repositories. These
were model-authored changes, rather than the fixed edits of the earlier transport
acceptance test. API credentials and publication remained with the trusted
operator; agents received no provider credential files. Declared agent provenance
is not a provider-signed receipt or independent human approval.

The full native ACE source contains a file exceeding the Artifacts workspace's
1 MiB per-file limit. The demonstration therefore used a frozen 89-file,
478,964-byte component snapshot, parented to the full native source
`94f1ec47142f99a026846e985f6c64471a64d129c63d755c03f03cc8eb9638f5`.
Its native baseline is
`5bedc261fdb3325f342360e8589d44dec419a7354937ff8e2c1d66fb1c392eae`.
This demonstrates real work on ACE's clients, not a hosted full-repository build.

| Agent task | Artifacts Git commit | Retained native proposal |
| --- | --- | --- |
| `/root/native_sync_agent` | `e4e08517f4bfa22f2fedd2b588ab90bb4ce5c411` | `2820a68bb5c0d18a28dcf5638cb73f56ef12f669731bcfec689d21df31a6dbd5` |
| `/root/package_delivery_agent` | `41f908a05378e5acaeb7319c7e32fd727be9b656` | `47d4f11bf2882fde597e4536e44174c0099bac8fedda41cf03a5a2b6d0451339` |

Both native proposals and their exact source remain in `ace-self-development`,
on branches `agent-fe30d0b0-0568-4172-bf20-f29059b9cf9b` and
`agent-5bed0c88-163e-4517-a4dd-95dd3dc64444`. Artifacts is the agent workspace;
ACE's own native versions, journal and refs retain the proposals. The operator
reviewed the disjoint changes and ran validation on their composition. The
production native `main` was not advanced: a component snapshot must never replace
its complete repository tree. Deployment of the control plane was unnecessary.

## Verified behavior and retained learning

- The original pull stopped on a controlled 401 but a second attempt failed with
  `EEXIST`, leaving no recovery path. The new explicit `pull --resume` recovered
  the same real two-object, 1,399,823-byte hosted snapshot, reused its already
  verified large object and passed the Rust native-store verifier. Authorization
  failures are not retried. The controlled failure is a regression test, not an
  observed production authentication outage.
- Five independent 1,399,765-byte reads with the environment operator credential
  returned HTTP 200 and matching SHA-256. The older credential/proxy 401 was not
  reproduced; its underlying cause remains unconfirmed.
- Resume pins origin, project, journal and references. Changed snapshots, cache
  tampering, foreign files and symlinks are rejected. Concurrent local writers
  are unsupported; corrupt or torn files require a fresh destination.
- The installer checks public manifest/archive/checksum/build identities before
  writing executable files. Review exposed a decompression-budget gap for tar
  metadata; it was corrected before the final agent commit. Total gzip expansion
  is now bounded before parsing tar headers. Traversal, special files, duplicate
  members, changed checksums, unsupported platforms and existing destinations
  are rejected. Interrupted installs are cleaned up; abrupt process termination
  may leave a directory requiring manual removal.

A fresh read-only container with no network or credentials passed all **58 client
checks**, **15 Python checks**, and the existing real-native store-sync integration.
The 12 new resume checks included a real Rust verification; the 11 new installer
checks covered malicious archives, bounded decompression and failure cleanup.
The operator controlled the container and existing checks independently of the
coding workspaces. These are local acceptance results, not a hosted evaluation
receipt or competitive winner selection. Complementary passing proposals and
negative regression/review findings are retained; no losing agent is invented.

Public Linux and Mac Intel archives matched their published hashes. Final fresh
installations verified both platforms' build metadata. The Linux package passed
the full extracted first-use check: 13 demo programs, 10 qualified results, three
expected diagnostic failures, three generations, replay, native history/clone,
agent proposals/learning, Git compatibility and 30 MCP tools. Core execution used
an empty PATH with provider credentials absent. Mac execution was not repeated on
Linux; the owner's earlier native Mac report remains its execution evidence.
Windows and Apple silicon still have no verified native package and remain beta.

The new helper is public at [ace.org.ai/downloads/install.py](https://ace.org.ai/downloads/install.py),
with instructions in the [getting-started guide](https://ace.org.ai/getting-started.html).
It installs the existing exact tested 0.4.0 binaries from source commit
`0b913fbaf8c41c26aa7465bd80525f18b1142528`; the helper changes do not rebuild or
relabel those binaries. No GitHub Actions runs were used. The competition video
and submission were reported complete by the owner; this work does not resubmit.
