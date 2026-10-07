#!/usr/bin/env python3
"""Package one already-tested native CLI; no network or credential access."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import zipfile


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
        metadata = {"schema_version": 1, "version": args.version, "source_commit": args.commit,
                    "target": args.target, "binary_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
                    "offline_demo": True, "candidate_generator": "gcd-grammar-v1",
                    "agent_wat_proposals": True, "local_git_history": True}
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
