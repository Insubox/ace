#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .ace-build
# Build only these reviewed example sources. The experiment runner consumes
# compiled WASM and never compiles or starts arbitrary candidate source.
for name in baseline euclid binary incorrect spinning memory_hog; do
  rustc "src/$name.rs" --edition 2024 --target wasm32-unknown-unknown \
    --crate-type cdylib -C opt-level=3 -C panic=abort -o ".ace-build/$name.wasm"
done
