"""Public installer security and repeatability checks; no network required."""
import importlib.util
import io
import gzip
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('download_release', Path(__file__).parents[1] / 'download-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
TARGET = 'x86_64-unknown-linux-musl'
NAME = f'ace-0.4.0-{TARGET}.tar.gz'
PREFIX = NAME.removesuffix('.tar.gz')


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dest = Path(self.temp.name) / 'installed'
        self.manifest = {'schema_version': 1, 'version': '0.4.0', 'source_commit': 'a' * 40,
                         'platforms': [{'target': TARGET, 'status': 'verified', 'archive': NAME}]}
        self.files = {'ace': b'binary', 'GETTING_STARTED.md': b'help', 'THIRD_PARTY_NOTICES.txt': b'notices'}
        self.metadata = {'schema_version': 1, 'version': '0.4.0', 'source_commit': 'a' * 40, 'target': TARGET,
                         'binary_sha256': release.digest(b'binary'), 'third_party_notices_sha256': release.digest(b'notices')}

    def fixture(self, extra=None):
        files = dict(self.files, **{'BUILD.json': json.dumps(self.metadata).encode()})
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
            for name, content in files.items():
                member = tarfile.TarInfo(f'{PREFIX}/{name}')
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            if extra is not None:
                archive.addfile(extra, io.BytesIO(b'x' * extra.size) if extra.isfile() else None)
        data = buffer.getvalue()
        self.manifest['platforms'][0]['sha256'] = release.digest(data)
        self.payloads = {'manifest.json': json.dumps(self.manifest).encode(), NAME: data,
                         NAME + '.sha256': f'{release.digest(data)}  {NAME}\n'.encode()}
        return self.fetch

    def fetch(self, url, limit):
        data = self.payloads[url.rsplit('/', 1)[1]]
        assert len(data) <= limit
        return data

    def rejected(self, fetch=None):
        with self.assertRaises(ValueError):
            release.install(self.dest, TARGET, fetch or self.fetch)
        self.assertFalse(self.dest.exists())

    def test_success_and_second_install_refused(self):
        result = release.install(self.dest, TARGET, self.fixture())
        self.assertEqual(result['target'], TARGET)
        self.assertEqual((self.dest / 'ace').read_bytes(), b'binary')
        with self.assertRaises(FileExistsError):
            release.install(self.dest, TARGET, self.fetch)
        self.assertEqual((self.dest / 'ace').read_bytes(), b'binary')

    def test_existing_empty_directory_and_symlink_refused(self):
        self.dest.mkdir()
        with self.assertRaises(FileExistsError):
            release.install(self.dest, TARGET, self.fixture())
        self.dest.rmdir()
        self.dest.symlink_to(Path(self.temp.name) / 'missing')
        with self.assertRaises(FileExistsError):
            release.install(self.dest, TARGET, self.fetch)
        self.assertTrue(self.dest.is_symlink())

    def test_corrupt_archive_and_checksum(self):
        self.fixture()
        self.payloads[NAME] += b'corruption'
        self.rejected()
        self.fixture()
        self.payloads[NAME + '.sha256'] = b'bad'
        self.rejected()

    def test_metadata_hash_and_identity_ties(self):
        for key in ('binary_sha256', 'third_party_notices_sha256', 'source_commit', 'target', 'version', 'schema_version'):
            with self.subTest(key=key):
                old = self.metadata[key]
                self.metadata[key] = 'wrong'
                self.fixture()
                self.rejected()
                self.metadata[key] = old

    def test_malicious_archive_members(self):
        for name, kind in [(f'{PREFIX}/ace', tarfile.REGTYPE), ('../escape', tarfile.REGTYPE),
                           ('/escape', tarfile.REGTYPE), (f'{PREFIX}/link', tarfile.SYMTYPE),
                           (f'{PREFIX}/ace', tarfile.LNKTYPE), (f'{PREFIX}/ace', tarfile.CHRTYPE),
                           ('../directory', tarfile.DIRTYPE)]:
            with self.subTest(name=name, kind=kind):
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/escape' if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ''
                self.fixture(member)
                self.rejected()
        self.assertFalse((Path(self.temp.name) / 'escape').exists())

    def test_total_decompressed_bytes_bounded_before_tar_parser(self):
        self.fixture()
        # A small compressed archive expands into oversized padding/metadata.
        data = gzip.compress(b'\0' * 20000)
        self.payloads[NAME] = data
        self.manifest['platforms'][0]['sha256'] = release.digest(data)
        self.payloads['manifest.json'] = json.dumps(self.manifest).encode()
        self.payloads[NAME + '.sha256'] = f'{release.digest(data)}  {NAME}\n'.encode()
        with patch.object(release, 'MAX_EXPANDED', 10000), patch.object(release.tarfile, 'open') as parser:
            self.rejected()
            parser.assert_not_called()

    def test_interrupted_download_and_write_cleanup(self):
        self.fixture()
        for interruption in (OSError('connection interrupted'), KeyboardInterrupt()):
            def interrupted(url, limit):
                if url.endswith('.tar.gz'):
                    raise interruption
                return self.fetch(url, limit)
            with self.assertRaises(type(interruption)):
                release.install(self.dest, TARGET, interrupted)
            self.assertFalse(self.dest.exists())
        original = Path.open
        def write_failure(path, *args, **kwargs):
            if path.name == 'GETTING_STARTED.md':
                raise OSError('disk full')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'open', write_failure), self.assertRaises(OSError):
            release.install(self.dest, TARGET, self.fetch)
        self.assertFalse(self.dest.exists())

    def test_unsupported_and_pending_platforms(self):
        self.fixture()
        for target in ('aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'unknown'):
            with self.assertRaises(ValueError):
                release.install(self.dest, target, self.fetch)
            self.assertFalse(self.dest.exists())
        self.manifest['platforms'][0]['status'] = 'native_execution_pending'
        self.payloads['manifest.json'] = json.dumps(self.manifest).encode()
        self.rejected()

    def test_strict_manifest(self):
        self.fixture()
        for change in ({'schema_version': True}, {'version': '../bad'}, {'source_commit': 'bad'},
                       {'platforms': self.manifest['platforms'] * 2}):
            manifest = dict(self.manifest, **change)
            self.payloads['manifest.json'] = json.dumps(manifest).encode()
            self.rejected()
        with self.assertRaises(ValueError):
            release.strict_json(b'{"version":1,"version":2}')

    def test_https_credential_and_external_redirect_refusal(self):
        for url in ('http://ace.org.ai/downloads/a', 'https://user:secret@ace.org.ai/downloads/a',
                    'https://elsewhere.test/downloads/a', 'https://ace.org.ai/private',
                    'https://ace.org.ai/downloads/a?token=x'):
            with self.assertRaises(ValueError):
                release.public_url(url)

    def test_redirect_fresh_request_and_response_bounds(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length': '2'}
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    raise urllib.error.HTTPError(request.full_url, 302, 'redirect',
                                                 {'Location': 'https://www.ace.org.ai/downloads/file'}, io.BytesIO())
                return Response(b'ok')
        with patch.object(release.urllib.request, 'build_opener', return_value=Opener()):
            self.assertEqual(release.download(release.MANIFEST_URL, 10), b'ok')
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[1].headers, requests[0].headers)
        self.assertNotIn('Authorization', requests[1].headers)
        class TooLarge:
            def open(self, request, timeout):
                return Response(b'ok')
        with patch.object(release.urllib.request, 'build_opener', return_value=TooLarge()), self.assertRaises(ValueError):
            release.download(release.MANIFEST_URL, 1)


if __name__ == '__main__':
    unittest.main()
