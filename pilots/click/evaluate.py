"""Trusted offline evaluator; only explicitly captured Click source is mounted."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile


def unpack(wheel, destination):
    with zipfile.ZipFile(wheel) as archive:
        for entry in archive.infolist():
            parts = Path(entry.filename).parts
            if (entry.filename.startswith("/") or ".." in parts
                    or "\\" in entry.filename or (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("Unsafe wheel member")
        archive.extractall(destination)


def run(args):
    result = subprocess.run(args, cwd="/source", env=os.environ.copy(),
                            capture_output=True, text=True, timeout=180)
    print(result.stdout, end="")
    print(result.stderr, end="", file=sys.stderr)
    return result.returncode


def main():
    output = Path("/results")
    for wheel in Path("/wheels").glob("*.whl"):
        unpack(wheel, "/work/deps")
    os.environ["PYTHONPATH"] = "/work/deps"
    build = run([sys.executable, "-m", "flit_core.wheel", "--outdir", "/work/dist"])
    if build:
        (output / "report.json").write_text(json.dumps({"build_exit": build, "cases": []}))
        return 0
    wheels = list(Path("/work/dist").glob("click-*.whl"))
    if len(wheels) != 1:
        raise ValueError("Expected exactly one built Click wheel")
    unpack(wheels[0], "/work/installed")
    os.environ["PYTHONPATH"] = "/work/installed:/work/deps"
    # Exercise the built package, not the source checkout or another installed Click.
    probe = run([sys.executable, "-c",
                 "import click; assert click.__file__.startswith('/work/installed/click/')"])
    if probe:
        raise ValueError("Built package identity differs")
    # Bytecode compilation writes only to disposable work space.
    compile_exit = run([sys.executable, "-m", "compileall", "-q", "/work/installed/click"])
    test_exit = run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                     "--basetemp", "/work/pytest", "--junitxml", str(output / "tests.xml"),
                     "/source/tests", "/harness/test_completion.py"])
    cases = []
    for case in ET.parse(output / "tests.xml").iter("testcase"):
        skipped = case.find("skipped")
        state = "failed" if case.find("failure") is not None else "error" if case.find("error") is not None else "expected_failure" if skipped is not None and skipped.attrib.get("type") == "pytest.xfail" else "skipped" if skipped is not None else "passed"
        cases.append({"id": case.attrib.get("classname", "") + "::" + case.attrib["name"], "status": state})
    if not cases or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Missing or ambiguous executed cases")
    report = {"build_exit": build, "compile_exit": compile_exit, "test_exit": test_exit,
              "python_version": sys.version.split()[0], "cases": cases,
              "wheel_sha256": hashlib.sha256(wheels[0].read_bytes()).hexdigest()}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return 0 if test_exit in (0, 1, 2) else 1


if __name__ == "__main__":
    sys.exit(main())
