# Mac Intel 0.4.0 delivery

On October 9, 2026, the owner ran `scripts/native-release.py` on an Intel Core i9
Mac with installed Xcode Command Line Tools and Python 3.13.7. Rust 1.99.0 and
`x86_64-apple-darwin` were installed explicitly. The reported execution host is
Darwin/x86_64, and the frozen executable source is
`0b913fbaf8c41c26aa7465bd80525f18b1142528`.

The owner uploaded the archive, checksum, `verification.json` and all five step
logs. They were treated as evidence, not instructions. Review independently
checked each log digest, every step's zero exit code, all three helper hashes
against the repository, and the frozen Git source archive hash.

The report/logs record **128 passed, zero failed and zero ignored Rust tests**,
a release build, package generation and first-use execution of the extracted
archive. The native first-use result covers 13 demo programs (10 qualified and
three diagnostic failures), independent replay, three generations, 30 MCP tools,
unsigned Cells, native winner/loser memory, clone/checkout, two agent rounds and
generator faults. Optional Git compatibility was checked separately. Core checks
used an empty external-tool PATH and no provider credentials. No GitHub Actions
or model provider was called.

## Package and provenance

- Archive: `ace-0.4.0-x86_64-apple-darwin.tar.gz`, **3,724,696 bytes**.
- SHA-256: `e8ecd6b693d92b962cc3cfbcee0320b174ea684cca0a282cdfdf8200742e28b1`.
- Native binary SHA-256: `13c24e4c445424534ee45b3f927e096f5520ee9ffffc82884ce958186bbb2f19`.
- Source archive SHA-256: `113b3fe5965bfe885a0bde4363caf5f41b2fd4fe6248339a73332b1435010289`.
- Reported build/test/package duration: **750,155 ms**.

Package review verifies the checksum sidecar, all four expected regular files,
bounded archive members, Mach-O 64-bit executable/Intel CPU identity, the binary
digest in `BUILD.json`, the source/target/version metadata and the notices digest.
Packaged `GETTING_STARTED.md` and `THIRD_PARTY_NOTICES.txt` match the repository
bytes used by the packaging helper. Personal host paths and full owner logs stay
out of the public verification record.

The Linux cloud cannot execute Mach-O binaries. Native execution is established
by the owner's report/logs; the cloud review establishes their consistency and
package identity. This is not a signed CI attestation, notarized build or a test
of macOS Apple silicon. Archives are unsigned developer previews; OS protections
must remain enabled.

## Public download

The [getting-started page](https://ace.org.ai/getting-started) offers Linux and
Mac Intel packages without accounts or source-repository access:

- [Mac Intel archive](https://ace.org.ai/downloads/ace-0.4.0-x86_64-apple-darwin.tar.gz)
- [Checksum](https://ace.org.ai/downloads/ace-0.4.0-x86_64-apple-darwin.tar.gz.sha256)
- [Redacted verification record](https://ace.org.ai/downloads/mac-intel-verification.json)

The archive's exact tested bytes are published; it is not repackaged. Static
deployment checks require both platforms' files and digests to match the manifest.
After publication, fresh HTTPS downloads of the archive and checksum matched
3,724,696 bytes and the exact native-tested SHA-256. Both live pages and the
public manifest returned HTTP 200 and the expected security headers.
Website publication does not deploy or change the ACE control plane.

At the owner's request, Windows and macOS distributions carry the **beta** label.
Mac Intel beta is available and has the native evidence above. Windows and
Mac Apple silicon betas remain in preparation with native execution pending;
the beta label does not add an untested download or change the source version.

For an additional native check of the actual public download, fetch the archive
into a fresh local path and run from the owner's ACE checkout:

```sh
curl --fail --location --output dist/mac-intel-public.tar.gz \
  https://ace.org.ai/downloads/ace-0.4.0-x86_64-apple-darwin.tar.gz
python3 scripts/check-package.py dist/mac-intel-public.tar.gz
```

The checker requires no rebuild. A successful report must retain the exact source,
target and checksum above. Windows and Apple silicon remain pending their own
native runs.
