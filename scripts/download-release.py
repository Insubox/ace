#!/usr/bin/env python3
"""Install a verified public ACE preview into a new directory (Python stdlib)."""
import argparse
import hashlib
import gzip
import io
import json
from pathlib import Path
import platform
import re
import shutil
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

MANIFEST_URL = 'https://ace.org.ai/downloads/manifest.json'
TARGETS = {'x86_64-unknown-linux-musl', 'x86_64-apple-darwin'}
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def public_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in {'ace.org.ai', 'www.ace.org.ai'}
            or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443) or parsed.fragment or parsed.query
            or not parsed.path.startswith('/downloads/')):
        raise ValueError('only credentialless public ACE download HTTPS URLs are allowed')
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download(url, limit, timeout=30):
    """Fresh header-only requests for every redirect; retain platform proxy/TLS trust."""
    opener = urllib.request.build_opener(NoRedirect())
    deadline = time.monotonic() + timeout
    for _ in range(6):
        public_url(url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('download time budget exceeded')
        request = urllib.request.Request(url, headers={'User-Agent': 'ace-public-installer/1',
                                                     'Accept-Encoding': 'identity'})
        try:
            response = opener.open(request, timeout=min(10, remaining))
        except urllib.error.HTTPError as error:
            with error:
                if error.code not in (301, 302, 303, 307, 308):
                    raise
                location = error.headers.get('Location')
                if not location:
                    raise ValueError('redirect lacks Location')
                url = public_url(urllib.parse.urljoin(url, location))
            continue
        with response:
            if response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                raise ValueError('unexpected download response')
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdigit() or int(length) > limit):
                raise ValueError('download exceeds size limit')
            chunks, size = [], 0
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError('download time budget exceeded')
                chunk = response.read1(min(65536, limit + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > limit:
                    raise ValueError('download exceeds size limit')
            if length is not None and size != int(length):
                raise ValueError('incomplete download')
            return b''.join(chunks)
    raise ValueError('too many redirects')


def strict_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def select(manifest, target):
    if not isinstance(manifest, dict) or type(manifest.get('schema_version')) is not int or manifest['schema_version'] != 1:
        raise ValueError('unsupported manifest schema')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', str(manifest.get('version', ''))):
        raise ValueError('invalid release version')
    if not re.fullmatch(r'[0-9a-f]{40}', str(manifest.get('source_commit', ''))):
        raise ValueError('invalid source commit')
    platforms = manifest.get('platforms')
    if not isinstance(platforms, list) or any(not isinstance(p, dict) or not isinstance(p.get('target'), str) for p in platforms):
        raise ValueError('invalid platform list')
    if len({p['target'] for p in platforms}) != len(platforms):
        raise ValueError('duplicate platform target')
    matches = [p for p in platforms if p['target'] == target]
    if target not in TARGETS or len(matches) != 1 or matches[0].get('status') != 'verified':
        raise ValueError('platform has no verified native package (pending beta is unavailable)')
    entry = matches[0]
    if entry.get('archive') != f"ace-{manifest['version']}-{target}.tar.gz":
        raise ValueError('archive name does not match version and target')
    if not re.fullmatch(r'[0-9a-f]{64}', str(entry.get('sha256', ''))):
        raise ValueError('invalid archive checksum')
    return entry


def documents(data, manifest, entry):
    if digest(data) != entry['sha256']:
        raise ValueError('archive checksum mismatch')
    prefix = entry['archive'].removesuffix('.tar.gz')
    expected = {f'{prefix}/{name}' for name in ('ace', 'BUILD.json', 'GETTING_STARTED.md', 'THIRD_PARTY_NOTICES.txt')}
    result, seen, total = {}, set(), 0
    # Bound all decompression before tar parsing, including PAX/longname headers
    # and padding that do not appear as ordinary file members.
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
        expanded = compressed.read(MAX_EXPANDED + 1)
    if len(expanded) > MAX_EXPANDED:
        raise ValueError('expanded archive exceeds size limit')
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r|') as archive:
        for member in archive:
            if member.name in seen:
                raise ValueError('duplicate archive member')
            seen.add(member.name)
            if member.isdir() and member.name == prefix:
                continue
            if member.name not in expected or not member.isfile() or member.linkname:
                raise ValueError('unexpected or nonregular archive member')
            total += member.size
            if member.size < 0 or total > MAX_EXPANDED:
                raise ValueError('expanded archive exceeds size limit')
            with archive.extractfile(member) as stream:
                contents = stream.read(member.size + 1)
            if len(contents) != member.size:
                raise ValueError('truncated archive member')
            result[member.name.rsplit('/', 1)[1]] = contents
    if set(result) != {name.rsplit('/', 1)[1] for name in expected}:
        raise ValueError('missing archive member')
    metadata = strict_json(result['BUILD.json'])
    if not isinstance(metadata, dict) or type(metadata.get('schema_version')) is not int or metadata['schema_version'] != 1:
        raise ValueError('unsupported build metadata')
    for key, expected_value in [('version', manifest['version']), ('source_commit', manifest['source_commit']),
                                ('target', entry['target']), ('binary_sha256', digest(result['ace'])),
                                ('third_party_notices_sha256', digest(result['THIRD_PARTY_NOTICES.txt']))]:
        if metadata.get(key) != expected_value:
            raise ValueError(f'build metadata {key} mismatch')
    return result


def host_target():
    return {('Linux', 'x86_64'): 'x86_64-unknown-linux-musl',
            ('Darwin', 'x86_64'): 'x86_64-apple-darwin'}.get((platform.system(), platform.machine()), 'unsupported')


def install(destination, target=None, fetch=download):
    destination = Path(destination).absolute()
    # mkdir is exclusive, including empty directories and dangling symlinks.
    destination.mkdir(mode=0o700)
    try:
        raw_manifest = fetch(MANIFEST_URL, 256 * 1024)
        manifest = strict_json(raw_manifest)
        entry = select(manifest, target or host_target())
        url = urllib.parse.urljoin(MANIFEST_URL, entry['archive'])
        archive = fetch(url, MAX_ARCHIVE)
        checksum = fetch(url + '.sha256', 1024)
        if checksum.decode('ascii').strip() != f"{entry['sha256']}  {entry['archive']}":
            raise ValueError('published checksum disagrees with manifest')
        files = documents(archive, manifest, entry)
        files.update({entry['archive']: archive, entry['archive'] + '.sha256': checksum, 'manifest.json': raw_manifest})
        for name, content in files.items():
            with (destination / name).open('xb') as output:
                output.write(content)
        (destination / 'ace').chmod(0o755)
        return {'destination': str(destination), 'version': manifest['version'], 'source_commit': manifest['source_commit'],
                'target': entry['target'], 'sha256': entry['sha256']}
    except BaseException:
        shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, type=Path, help='new installation directory; must not exist')
    parser.add_argument('--target', help='download verified Linux or Mac Intel target; defaults to native host')
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.dest, args.target), sort_keys=True))
    except (ValueError, OSError, tarfile.TarError, urllib.error.URLError) as error:
        print(f'ACE installation failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
