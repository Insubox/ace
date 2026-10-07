"""Bounded export of trusted native objects; never runs candidate source."""
import base64
import json
from pathlib import Path

root = Path('/workspace/native')
log = sorted((root / 'journal').glob('*.json'))
if len(log) != 1:
    raise ValueError('expected one trusted native snapshot')
entry = json.loads(log[0].read_text())
sealed = json.loads((root / 'versions' / (entry['version'] + '.json')).read_text())
objects = []
size = 0
for digest in sorted(set(sealed['version']['files'].values())):
    data = (root / 'objects' / digest).read_bytes()
    size += len(data)
    if len(data) > 8 * 1024 * 1024 or size > 16 * 1024 * 1024:
        raise ValueError('native export exceeds byte budget')
    objects.append({'hash': digest, 'base64': base64.b64encode(data).decode('ascii')})
if len(objects) > 128:
    raise ValueError('native export exceeds object budget')
Path('/workspace/native-bundle.json').write_text(json.dumps({'sealed': sealed, 'objects': objects}, separators=(',', ':')))
