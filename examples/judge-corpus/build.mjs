import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const entries = [manifest.reference, ...manifest.candidates];
const names = ['reference', ...Array.from({ length: 24 }, (_, i) => `v${String(i + 1).padStart(2, '0')}`)];
if (entries.length !== names.length || entries.some((e, i) => e.source !== `src/${names[i]}.rs` || e.id !== `C-${names[i]}`))
  throw new Error('Only the reviewed fixed corpus may be compiled');
await mkdir(resolve(root, '.ace-build'), { recursive: true });
const flags = ['--edition', '2024', '--target', 'wasm32-unknown-unknown', '--crate-type', 'cdylib', '-C', 'opt-level=3', '-C', 'panic=abort', '-A', 'unused-mut'];
const artifacts = [];
for (const [i, entry] of entries.entries()) {
  const module = `.ace-build/${names[i]}.wasm`;
  execFileSync('rustc', [entry.source, ...flags, '-o', module], { cwd: root, stdio: 'inherit' });
  artifacts.push({ ...entry, module, source_hash: hash(await readFile(resolve(root, entry.source))), artifact_hash: hash(await readFile(resolve(root, module))) });
}
if (new Set(artifacts.map(a => a.artifact_hash)).size !== entries.length)
  throw new Error('Optimized modules must all be distinct; revise sources before freezing the corpus');
const record = { schema_version: 1, manifest_hash: hash(manifestBytes), compiler: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(), flags, artifacts };
await writeFile(resolve(root, '.ace-build/build-manifest.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ distinct_artifacts: artifacts.length, manifest_hash: record.manifest_hash }));
