#!/usr/bin/env python3
"""Package one already-tested native CLI; no network or credential access."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import tarfile
import tempfile
import zipfile


def validate_executable(binary, target):
    """Reject a mislabeled architecture before publishing any archive."""
    with binary.open("rb") as source:
        header = source.read(64)
        if target == "x86_64-unknown-linux-musl":
            if len(header) < 20 or header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != 62:
                raise ValueError("expected a Linux x86-64 ELF executable")
        elif target.endswith("apple-darwin"):
            cpu = 0x0100000C if target.startswith("aarch64") else 0x01000007
            if len(header) < 16 or header[:4] != b"\xcf\xfa\xed\xfe" or struct.unpack_from("<I", header, 4)[0] != cpu or struct.unpack_from("<I", header, 12)[0] != 2:
                raise ValueError("expected a macOS executable for the selected architecture")
        else:
            if len(header) < 64 or header[:2] != b"MZ":
                raise ValueError("expected a Windows x86-64 PE executable")
            offset = struct.unpack_from("<I", header, 60)[0]
            if not 64 <= offset <= 65536:
                raise ValueError("invalid PE header offset")
            source.seek(offset)
            pe = source.read(26)
            if len(pe) != 26 or pe[:4] != b"PE\0\0" or struct.unpack_from("<H", pe, 4)[0] != 0x8664 or struct.unpack_from("<H", pe, 24)[0] != 0x20B:
                raise ValueError("expected a Windows x86-64 PE32+ executable")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?", args.version):
        parser.error("version must be a semantic version")
    targets = {"x86_64-unknown-linux-musl", "aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"}
    if args.target not in targets or not re.fullmatch(r"[a-f0-9]{40}", args.commit):
        parser.error("unknown release target or invalid source commit")
    if not args.binary.is_file() or args.binary.stat().st_size == 0:
        parser.error("binary must be an existing, nonempty native executable")
    validate_executable(args.binary, args.target)
    root = Path(__file__).resolve().parent.parent
    name = f"ace-{args.version}-{args.target}"
    archive_name = name + (".zip" if "windows" in args.target else ".tar.gz")
    args.out.mkdir(parents=True, exist_ok=True)
    destination = args.out / archive_name
    if destination.exists() or (args.out / (archive_name + ".sha256")).exists():
        parser.error("release output already exists; use a fresh directory")
    with tempfile.TemporaryDirectory(prefix="ace-release-") as temporary:
        package = Path(temporary) / name
        package.mkdir()
        executable = package / ("ace.exe" if "windows" in args.target else "ace")
        shutil.copyfile(args.binary, executable)
        executable.chmod(0o755)
        shutil.copyfile(root / "docs/getting-started.md", package / "GETTING_STARTED.md")
        shutil.copyfile(root / "docs/third-party-notices.txt", package / "THIRD_PARTY_NOTICES.txt")
        metadata = {"schema_version": 1, "version": args.version, "source_commit": args.commit,
                    "target": args.target, "binary_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
                    "offline_demo": True, "candidate_generator": "gcd-grammar-v1",
                    "agent_wat_proposals": True, "local_git_history": True,
                    "bounded_agent_campaigns": True, "verified_memory": True, "native_version_engine": "ace-native-v1", "cells": ["Gcd", "MaxU32", "MinU32"],
                    "bounded_regular_file_inputs": True, "native_branch_merge": True,
                    "third_party_notices_sha256": hashlib.sha256((package / "THIRD_PARTY_NOTICES.txt").read_bytes()).hexdigest()}
        (package / "BUILD.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        # Build privately, then publish complete files without replacing an output.
        staged = Path(temporary) / archive_name
        if "windows" in args.target:
            with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(package.iterdir()):
                    archive.write(path, f"{name}/{path.name}")
        else:
            with tarfile.open(staged, "w:gz") as archive:
                archive.add(package, arcname=name)
        digest = hashlib.sha256(staged.read_bytes()).hexdigest()
        with destination.open("xb") as output, staged.open("rb") as source:
            shutil.copyfileobj(source, output)
        with (args.out / (archive_name + ".sha256")).open("x", encoding="utf-8") as output:
            output.write(f"{digest}  {archive_name}\n")
    print(json.dumps({"archive": str(destination), "sha256": digest, "target": args.target}))


if __name__ == "__main__":
    main()
