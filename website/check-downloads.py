#!/usr/bin/env python3
"""Refuse a static-site deployment with missing or changed public packages."""
import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parent / "public" / "downloads"
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
if not re.fullmatch(r"[a-f0-9]{40}", manifest.get("source_commit", "")):
    raise ValueError("invalid download source identity")
verified = 0
for platform in manifest["platforms"]:
    if platform["status"] != "verified":
        if "archive" in platform:
            raise ValueError("unverified platform advertises an archive")
        continue
    name = platform["archive"]
    if not re.fullmatch(r"ace-[a-zA-Z0-9_.-]+\.(?:tar\.gz|zip)", name):
        raise ValueError("unsafe download filename")
    archive = root / name
    checksum = root / (name + ".sha256")
    for path in (archive, checksum):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 25 * 1024 * 1024:
            raise ValueError("missing, linked or oversized static download")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != platform["sha256"] or checksum.read_text(encoding="utf-8").strip() != f"{digest}  {name}":
        raise ValueError("static download checksum differs")
    verified += 1
if not verified:
    raise ValueError("no verified download is available")
print(json.dumps({"verified_downloads": verified, "source_commit": manifest["source_commit"]}))
