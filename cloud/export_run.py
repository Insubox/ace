"""Export trusted Rust-generated JSON only. Modules already live in R2."""
import json
from pathlib import Path

root = Path('/workspace/run')
files = [{'path': str(p.relative_to(root)), 'content': p.read_text()}
         for p in sorted(root.rglob('*.json'))]
encoded = json.dumps(files, separators=(',', ':')).encode()
if len(encoded) > 8 * 1024 * 1024:
    raise ValueError('run metadata exceeds export budget')
Path('/workspace/bundle.json').write_bytes(encoded)
