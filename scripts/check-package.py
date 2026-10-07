#!/usr/bin/env python3
"""Check a native ACE package and run its first-use flow without tool credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    digest = hashlib.sha256(args.archive.read_bytes()).hexdigest()
    checksum = Path(str(args.archive) + ".sha256").read_text(encoding="utf-8").strip()
    if checksum != f"{digest}  {args.archive.name}":
        raise ValueError("package checksum does not match")
    windows = args.archive.name.endswith(".zip")
    prefix = args.archive.name.removesuffix(".zip") if windows else args.archive.name.removesuffix(".tar.gz")
    executable_name = "ace.exe" if windows else "ace"
    expected = {f"{prefix}/{name}" for name in [executable_name, "GETTING_STARTED.md", "BUILD.json"]}
    # Read only exact named regular files; never extract an arbitrary archive tree.
    if windows:
        with zipfile.ZipFile(args.archive) as archive:
            names = archive.namelist()
            if len(names) != 3 or set(names) != expected:
                raise ValueError("unexpected release package contents")
            documents = {Path(name).name: archive.read(name) for name in names}
    else:
        with tarfile.open(args.archive, "r:gz") as archive:
            files = [member for member in archive.getmembers() if not member.isdir()]
            if len(files) != 3 or {member.name for member in files} != expected or any(not m.isfile() for m in files):
                raise ValueError("unexpected release package contents")
            documents = {Path(member.name).name: archive.extractfile(member).read() for member in files}
    metadata = json.loads(documents["BUILD.json"])
    if hashlib.sha256(documents[executable_name]).hexdigest() != metadata["binary_sha256"]:
        raise ValueError("executable checksum does not match build metadata")
    with tempfile.TemporaryDirectory(prefix="ace-downloaded-") as directory:
        root = Path(directory)
        executable = root / executable_name
        executable.write_bytes(documents[executable_name])
        executable.chmod(0o755)
        environment = {"PATH": ""}
        if "SystemRoot" in os.environ:
            environment["SystemRoot"] = os.environ["SystemRoot"]

        git_environment = dict(environment, PATH=os.environ.get("PATH", ""))

        def run(*arguments, with_git=False):
            output = subprocess.run([str(executable), *arguments], cwd=root,
                                    env=git_environment if with_git else environment,
                                    text=True, capture_output=True, check=True, timeout=120)
            return output.stdout

        if run("--version").strip() != f"ace {metadata['version']}":
            raise ValueError("executable version does not match build metadata")
        demo = json.loads(run("demo", "demo", "--json"))
        if len(demo["candidates"]) != 13 or sum(c["outcome"] == "qualified" for c in demo["candidates"]) != 10:
            raise ValueError("offline demo did not evaluate the expected complete workload")
        json.loads(run("status", "demo/run"))
        replay = json.loads(run("replay", "demo/run", demo["champion"]))
        if not replay["matched"]:
            raise ValueError("packaged Champion replay changed its observations")
        evolution = json.loads(run("evolve", "evolution", "--generations", "3", "--json"))
        if json.loads(run("history", "evolution")) != evolution:
            raise ValueError("packaged evolution history did not verify")
        for step in evolution["steps"]:
            run("archive", f"evolution/generation-{step['generation']:03}/run",
                "--repository", "git-history", with_git=True)
        git_history = json.loads(run("archive-status", "git-history", with_git=True))
        if not git_history["verified"] or len(git_history["snapshots"]) != len(evolution["steps"]):
            raise ValueError("packaged Git archive did not preserve every generation")
        subprocess.run(["git", "clone", str(root / "git-history"), str(root / "git-clone")],
                       cwd=root, env=git_environment, text=True, capture_output=True, check=True, timeout=120)
        if json.loads(run("archive-status", "git-clone", with_git=True))["snapshots"] != git_history["snapshots"]:
            raise ValueError("Git clone changed archived winner sources or learning")
        proposals = {"schema_version": 1, "cell": "Gcd", "candidates": [
            {"id": "C-agent-recursive", "wat": '(module (func $g (export "gcd") (param $a i32) (param $b i32) (result i32) local.get $b i32.eqz (if (result i32) (then local.get $a) (else local.get $b local.get $a local.get $b i32.rem_u call $g))))',
             "strategy": "recursive-euclid", "generator": {"provider": "manual-fixture-a", "model": "package-test"}},
            {"id": "C-agent-add", "wat": '(module (func (export "gcd") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))',
             "strategy": "incorrect-addition", "generator": {"provider": "manual-fixture-b", "model": "package-test"}},
        ]}
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "ace_generate", "arguments": {"experiment": "first"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "ace_run", "arguments": {"experiment": "first", "run": "first"}}},
            {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "ace_knowledge", "arguments": {"run": "first"}}},
            {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "ace_propose", "arguments": {"experiment": "agents", "proposals": proposals}}},
            {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "ace_proposal_status", "arguments": {"experiment": "agents"}}},
            {"jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": {"name": "ace_run", "arguments": {"experiment": "agents", "run": "agents"}}},
        ]
        stream = "".join(json.dumps(request) + "\n" for request in requests)
        output = subprocess.run([str(executable), "mcp", "--workspace", str(root / "mcp-workspace")],
                                cwd=root, env=environment, input=stream, text=True,
                                capture_output=True, check=True, timeout=120)
        responses = [json.loads(line) for line in output.stdout.splitlines()]
        if len(responses) != 8 or len(responses[1]["result"]["tools"]) != 12 or any(response["result"]["isError"] for response in responses[2:]):
            raise ValueError("packaged local MCP agent experience did not verify")
        agent_run = responses[7]["result"]["structuredContent"]
        if agent_run["champion"] != "C-agent-recursive" or not any(c["id"] == "C-agent-add" and c["outcome"] == "failed_correctness" for c in agent_run["candidates"]):
            raise ValueError("packaged agent proposals did not receive real correctness evaluation")
        archive_call = {"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {"name": "ace_archive", "arguments": {"run": "agents", "repository": "agents"}}}
        output = subprocess.run([str(executable), "mcp", "--workspace", str(root / "mcp-workspace")],
                                cwd=root, env=git_environment, input=json.dumps(archive_call) + "\n",
                                text=True, capture_output=True, check=True, timeout=120)
        if json.loads(output.stdout)["result"]["isError"]:
            raise ValueError("packaged MCP Git archive failed")
    print(json.dumps({"archive": str(args.archive), "sha256": digest,
                      "source_commit": metadata["source_commit"], "target": metadata["target"],
                      "demo_programs": 13, "qualified": 10, "diagnostic_failures": 3,
                      "generations": len(evolution["steps"]), "history_verified": True,
                      "mcp_tools": 12, "mcp_experiment_verified": True,
                      "agent_proposals_verified": True, "git_snapshots": len(git_history["snapshots"]),
                      "git_clone_verified": True, "git_provider_credentials": "absent",
                      "external_tool_path": "empty", "provider_credentials": "absent"}))


if __name__ == "__main__":
    main()
