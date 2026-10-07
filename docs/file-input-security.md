# File input security

ACE treats experiment directories, retained runs and proposal manifests as
untrusted data. A matching SHA-256 does not authorize a filesystem path: a link
to an outside file can have the correct bytes, and a FIFO can block before a
streaming size limit takes effect.

The CLI and runner share `ace_runner::files`. Reads open relative to held
directory handles using `cap-std` and `cap-fs-ext`. Every child directory and the
final file are opened without following symbolic links. Absolute paths and
parent traversal are rejected. The opened file must be regular; its metadata
and the actual stream must both fit the byte budget. Unix opens use nonblocking
mode so a FIFO without a writer cannot stall before that check. The repository
continues to forbid unsafe Rust in application code.

Explicit CLI file arguments authorize their parent directory. They can select
files outside the current working directory, but the final file cannot be a
symbolic link or special file. Experiment and run manifests cannot grant that
authority: their referenced children must stay beneath the selected root.
Copy linked inputs into regular files before running ACE.

| Input | Maximum bytes |
| --- | ---: |
| Experiment configuration | 1,048,576 |
| WASM module | 1,048,576 |
| Registered WAT source | 32,768 |
| Grammar generated WAT source | 8,192 |
| Proposal registration | 131,072 |
| Proposal batch and cloud document | 3,145,728 |
| Evolution campaign document | 1,048,576 |
| Run document, protocol envelope and judge document | 8,388,608 |

The regression suites include external links with identical valid source,
module and sealed document bytes; links in ancestor directories; root directory
replacement; oversized configuration; devices; and FIFOs without writers.
CLI subprocess deadlines detect regressions that would otherwise hang tests.
Normal proposal evaluation, replay, evolution and native retention must still
succeed after the rejected inputs are restored.

This addresses the reported reads in `main.rs`, `proposal.rs`, `storage.rs`,
`evolve.rs`, `generate.rs`, `source.rs` and `config.rs`, along with related cloud,
policy and protocol input reads. It does not suppress scanner findings. The
source SAST service must run again on the resulting commit to confirm its own
finding status; a local test pass is not a scanner result.

The selected root is caller-authorized when opened. Hard links, mounted
filesystems, a hostile account that can replace the selected root before it is
opened, and blocking regular files on a remote filesystem are outside this file
reader's isolation guarantee. Wasm execution remains independently restricted
by the evaluator sandbox. Linux regression results do not establish a completed
Windows or macOS CI run.
