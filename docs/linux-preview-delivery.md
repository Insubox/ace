# Current Linux developer package

The static `x86_64-unknown-linux-musl` ACE 0.4.0 executable was rebuilt from
`468a3b10382ce0bc12d76b31a6ad51e3497af9e2` and packaged with the getting-started
guide and exact build metadata. Archive SHA-256:

`ea57e2ae2e54b71f9b6e677e1c00ffccdd2cabbb49377b15b7ebbb7a42dc7c4a`

Fresh extraction passed the 13-program demo, independent replay, three
generations, 30 MCP tools, unsigned Cell checks, agent proposals, native
memory/clone/checkout and local Git compatibility. Core checks ran without
provider credentials and with an empty external-tool PATH. Git compatibility
used the existing local Git executable separately, without provider credentials.
The executable is static; no installed Rust, Node, Docker or Cloudflare account
is needed for its local demo. This does not qualify arbitrary hosted applications.

The [GitHub release `ace-0.4.0-linux-preview-20261008`](https://github.com/Insubox/ace/releases/tag/ace-0.4.0-linux-preview-20261008)
is now a **published prerelease** with the archive and its matching checksum.
The archive is 4,059,062 bytes; the checksum file is 109 bytes. An authenticated
download of both assets from GitHub matched the archive hash above. The exact
downloaded archive passed `scripts/check-package.py`, including every first-use
check described above. These are operator-run checks of the distributed package,
not a hosted qualification receipt or a four-platform release.

The initial network denial and subsequent upload authentication failure were
resolved through the published environment configuration. The dedicated
`ACE_GITHUB_RELEASE_TOKEN` binding is scoped to `api.github.com` and
`uploads.github.com`; existing platform Git authentication is preserved.
The release targets the exact build commit and uses a tag outside the `v*`
workflow trigger. No GitHub Actions was launched.

The package includes the getting-started guide from its frozen build commit;
the current [guide](getting-started.md) records publication status. Windows
and macOS execution remain unverified. The repository is private, so downloads
also require existing GitHub repository access. A visibility change is separate
from installing or publishing this Linux preview.

Developers with repository access can already run the latest source using the
[getting-started instructions](getting-started.md#build-directly-from-github).
Linux users with repository access can download both assets, check the checksum,
extract the archive and run `./ace demo` without developer credentials. The
broader developer-delivery objective remains open until all intended platforms
and repository access for intended developers are verified.
