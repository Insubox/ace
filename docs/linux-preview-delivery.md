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

The GitHub release `ace-0.4.0-linux-preview-20261008` remains a **draft without
assets**. Uploading the archive failed because the managed network excludes
`uploads.github.com`. The configuration draft adds that exact host while
preserving the four existing custom domains and the package-manager preset.
The user must review, save and publish that environment change before the asset
upload can be retried. No GitHub download validation is claimed: no asset was
available to download. GitHub Actions was not launched.

The checked package remains in the private development workspace under
`.ace-env/releases/ace-learning-linux-20261008`, outside the source checkout.
The draft's notes specify Linux-only coverage and its source/checksum. Windows
and macOS execution remain unverified. The repository is private, so downloads
also require existing GitHub repository access. A visibility change is separate
from installing or publishing this Linux preview.

Developers with repository access can already run the latest source using the
[getting-started instructions](getting-started.md#build-directly-from-github).
After publication, validate the exact downloaded archive and its checksum again
before describing GitHub delivery as complete.
