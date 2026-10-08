#!/usr/bin/env python3
"""Build and exercise a frozen ACE source on the selected operating system."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {"Linux": {"x86_64": "x86_64-unknown-linux-musl"},
           "Darwin": {"arm64": "aarch64-apple-darwin", "x86_64": "x86_64-apple-darwin"},
           "Windows": {"amd64": "x86_64-pc-windows-msvc"}}


def native_target(system=None, machine=None):
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    try:
        return TARGETS[system][machine]
    except KeyError:
        raise ValueError(f"unsupported native platform: {system} {machine}") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", required=True, help="exact 40-character source commit")
    parser.add_argument("--out", type=Path, required=True, help="fresh output directory")
    parser.add_argument("--offline", action="store_true", help="use previously fetched Rust dependencies")
    parser.add_argument("--jobs", type=int, default=2, help="bounded Cargo build parallelism (1-8)")
    parser.add_argument("--build-cache", type=Path, help="reuse a local Cargo build directory")
    parser.add_argument("--target", choices=[t for hosts in TARGETS.values() for t in hosts.values()])
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        parser.error("use a full, lowercase source commit")
    if not 1 <= args.jobs <= 8:
        parser.error("jobs must be between 1 and 8")
    target = native_target()
    if args.target and args.target != target:
        parser.error("native verification must run on the requested OS and architecture")
    for tool in ("git", "cargo", "rustc"):
        if not shutil.which(tool):
            parser.error(f"install {tool} first; see docs/native-distribution.md")
    out = args.out.resolve()
    if out.exists():
        parser.error("output already exists; choose a fresh directory")
    out.mkdir(parents=True)
    start = time.monotonic()
    evidence = {"schema_version": 1, "status": "running", "source_commit": args.source_commit,
                "target": target, "host_system": platform.system(), "host_machine": platform.machine(),
                "github_actions": False, "steps": []}

    def record():
        (out / "verification.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")

    def step(name, command, cwd=ROOT, env=None, timeout=3600):
        print(name, flush=True)
        log = out / (name + ".log")
        with log.open("w", encoding="utf-8") as stream:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=stream,
                                    stderr=subprocess.STDOUT, timeout=timeout)
        evidence["steps"].append({"name": name, "exit_code": result.returncode,
                                  "log_sha256": hashlib.sha256(log.read_bytes()).hexdigest()})
        record()
        if result.returncode:
            raise RuntimeError(f"{name} failed; read {log}")
        return log.read_text(encoding="utf-8", errors="replace")

    record()
    try:
        resolved = subprocess.check_output(["git", "rev-parse", args.source_commit + "^{commit}"], cwd=ROOT, text=True).strip()
        if resolved != args.source_commit:
            raise ValueError("source commit did not resolve exactly")
        # Archive only tracked bytes of the frozen commit; user edits, credentials
        # and build outputs never enter the snapshot. Reject source links.
        with tempfile.TemporaryDirectory(prefix="ace-native-source-") as temporary:
            source = Path(temporary) / "source"
            source.mkdir()
            archive = Path(temporary) / "source.tar"
            with archive.open("wb") as stream:
                subprocess.run(["git", "archive", "--format=tar", args.source_commit], cwd=ROOT, stdout=stream, check=True)
            evidence["source_archive_sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
            with tarfile.open(archive) as tree:
                for member in tree.getmembers():
                    parts = member.name.split("/")
                    if member.name.startswith("/") or any(p in ("..", ".") or "\\" in p or ":" in p for p in parts) or not (member.isdir() or member.isfile()):
                        raise ValueError("source archive contains an unsafe path or link")
                    path = source.joinpath(*parts)
                    if member.isdir():
                        path.mkdir(parents=True, exist_ok=True)
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        with path.open("xb") as dest, tree.extractfile(member) as data:
                            shutil.copyfileobj(data, dest)
                        path.chmod(member.mode & 0o777)
            toolchain = tomllib.loads((source / "rust-toolchain.toml").read_text())["toolchain"]["channel"]
            version = tomllib.loads((source / "Cargo.toml").read_text())["workspace"]["package"]["version"]
            if (source / "Cargo.lock").read_bytes() != (ROOT / "Cargo.lock").read_bytes():
                raise ValueError("frozen dependency lock differs; update the third-party notices before packaging")
            tool = step("rust-version", ["rustc", "--version"], cwd=source).strip()
            if not tool.startswith("rustc " + toolchain + " "):
                raise ValueError("Rust version differs from the frozen source toolchain")
            evidence.update(rust_version=tool, version=version)
            build_cache = args.build_cache.resolve() if args.build_cache else out / "build"
            build_env = dict(os.environ, CARGO_TARGET_DIR=str(build_cache), CARGO_BUILD_JOBS=str(args.jobs))
            flags = ["--locked", "--target", target] + (["--offline"] if args.offline else [])
            tested = step("rust-tests", ["cargo", "test", "--workspace", *flags], cwd=source, env=build_env)
            counts = re.findall(r"test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored", tested)
            if not counts or sum(int(c[0]) for c in counts) == 0 or any(int(c[1]) for c in counts):
                raise ValueError("workspace tests did not run successfully")
            evidence["rust_tests"] = {"passed": sum(int(c[0]) for c in counts), "ignored": sum(int(c[2]) for c in counts)}
            step("release-build", ["cargo", "build", "--release", "-p", "ace-cli", *flags], cwd=source, env=build_env)
            binary = build_cache / target / "release" / ("ace.exe" if platform.system() == "Windows" else "ace")
            packaged = step("package", [sys.executable, str(ROOT / "scripts/package-release.py"),
                                      "--binary", str(binary), "--target", target, "--version", version,
                                      "--commit", args.source_commit, "--out", str(out / "packages")])
            package = json.loads(packaged)
            checked = step("first-use", [sys.executable, str(ROOT / "scripts/check-package.py"), package["archive"]], timeout=1800)
            check = json.loads(checked)
            if check["source_commit"] != args.source_commit or check["target"] != target or check["sha256"] != package["sha256"]:
                raise ValueError("verified package identity differs from the build")
            evidence.update(status="passed", package_check=check,
                            helper_sha256={name: hashlib.sha256((ROOT / "scripts" / name).read_bytes()).hexdigest()
                                           for name in ("native-release.py", "package-release.py", "check-package.py")})
    except Exception as error:
        evidence.update(status="failed", error=str(error))
        raise
    finally:
        evidence["duration_ms"] = round((time.monotonic() - start) * 1000)
        record()
    print(json.dumps({"status": evidence["status"], "target": target, "report": str(out / "verification.json")}), flush=True)


if __name__ == "__main__":
    main()
