# Product scope clarification — 2026-10-07

The user clarified that ACE should become both the primary software evolution
platform and a version engine of its own. References to “saving in Git” describe
version/history methodology; they do not require Git as ACE's storage engine.

This instruction supersedes the original architecture document's statement that
Git remains the storage layer. The attached specification remains useful for
Cell, Intent, evidence, evaluation, policy, learning and agent workflows; its
Git-storage non-goal is no longer the active product requirement. The original
document is preserved as an architectural record.

ACE should own source versions, winner and loser history, retained learning,
branch/ancestry semantics and the eventual developer collaboration interface.
Git remains an optional interoperability/export format. GitHub can still host
ACE's own source and downloads while ACE is built; that distribution channel
does not define ACE's product storage model.

The current implementation delivers a bounded native object store, source file
trees, version parents, hash journal, exact restoration, clone and evaluated
history. Campaigns and memory can run without Git. Replacing a hosted platform
now includes a private browser workspace, native push/pull and ACE accounts
with administrator, writer and reader roles. Per-repository permissions,
collaboration/review, named branch heads, automatic merging and other developer
workflows remain unfinished. ACE is a working native technical preview; these
remaining capabilities must be implemented and verified before describing it as
a complete GitHub replacement.
