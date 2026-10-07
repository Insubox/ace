use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

const CORRECT: &str = "(module (func $g (export \"gcd\") (param $a i32) (param $b i32) (result i32) local.get $b i32.eqz (if (result i32) (then local.get $a) (else local.get $b local.get $a local.get $b i32.rem_u call $g))))";

#[test]
fn unsigned_cells_keep_distinct_oracles_winner_sources_and_rejected_signed_code() {
    let root = tempfile::tempdir().unwrap();
    for (cell, entry, compare) in [("MaxU32", "max_u32", "gt"), ("MinU32", "min_u32", "lt")] {
        let file = root.path().join(format!("{cell}.json"));
        let make = |suffix: &str| {
            format!(
                "(module (func (export \"{entry}\") (param $a i32) (param $b i32) (result i32) local.get $a local.get $b local.get $a local.get $b i32.{compare}_{suffix} select))"
            )
        };
        write(
            &file,
            &json!({"schema_version":1,"cell":cell,"candidates":[
                {"id":"C-select","wat":make("u"),"strategy":"unsigned-select","generator":{"provider":"manual","model":"fixture"}},
                {"id":"C-signed","wat":make("s"),"strategy":"incorrect-signed-comparison","generator":{"provider":"manual","model":"fixture"}}
            ]}),
        );
        let input = root.path().join(format!("input-{cell}"));
        ok(&["propose", p(&file), "--output", p(&input)]);
        let run = root.path().join(format!("run-{cell}"));
        let result = ok(&["run", p(&input), "--output", p(&run)]);
        assert_eq!(result["candidates"][1]["outcome"], "qualified");
        assert_eq!(result["candidates"][2]["outcome"], "failed_correctness");
        let native = root.path().join(format!("native-{cell}"));
        ok(&["store", "save", p(&run), "--store", p(&native)]);
        let status = ok(&["store", "log", p(&native)]);
        assert_eq!(status["verified"], true);
        let id = status["versions"][0]["version"].as_str().unwrap();
        let snapshot = native.join("views").join(id);
        assert_eq!(
            ok(&[
                "cloud",
                "verify-snapshot",
                p(&snapshot),
                "--output",
                p(&root.path().join(format!("replay-{cell}")))
            ])["status"],
            "reproduced"
        );
        let learning: Value =
            serde_json::from_slice(&fs::read(snapshot.join("learning.json")).unwrap()).unwrap();
        assert!(learning["scope"].as_str().unwrap().contains(cell));
        let campaign = root.path().join(format!("campaign-{cell}"));
        ok(&[
            "agent-start",
            p(&campaign),
            "--campaign",
            cell,
            "--baseline-run",
            p(&run),
            "--store",
            p(&native),
            "--jobs",
            "1",
        ]);
        let task = ok(&["agent-next", p(&campaign)]);
        assert_eq!(task["task"]["context"]["contract"]["cell"], cell);
        assert!(
            task["task"]["context"]["contract"]["abi"]
                .as_str()
                .unwrap()
                .contains(entry)
        );
        assert_eq!(task["task"]["context"]["memory"]["excluded_runs"], 0);
        let foreign = root.path().join(format!("foreign-{cell}"));
        let mut other = batch();
        other["cell"] = json!(if cell == "MaxU32" { "MinU32" } else { "MaxU32" });
        let otherfile = root.path().join(format!("other-{cell}.json"));
        write(&otherfile, &other);
        assert!(
            !ace(&[
                "propose",
                p(&otherfile),
                "--baseline-run",
                p(&run),
                "--output",
                p(&foreign)
            ])
            .status
            .success()
        );
        assert!(!foreign.exists());
    }
}

fn batch() -> Value {
    json!({"schema_version":1, "cell":"Gcd", "candidates":[
        {"id":"C-agent-recursive","wat":CORRECT,"strategy":"recursive-euclid","generator":{"provider":"manual-fixture-a","model":"recursive-v1"}},
        {"id":"C-agent-add","wat":"(module (func (export \"gcd\") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))","strategy":"incorrect-addition","generator":{"provider":"manual-fixture-b","model":"diagnostic-v1"}},
        {"id":"C-agent-spin","wat":"(module (func (export \"gcd\") (param i32 i32) (result i32) (loop $forever br $forever) i32.const 0))","strategy":"fuel-exhaustion-control","generator":{"provider":"manual-fixture-b","model":"diagnostic-v1"}},
        {"id":"C-agent-import","wat":"(module (import \"host\" \"oracle\" (func $oracle (param i32 i32) (result i32))) (func (export \"gcd\") (param i32 i32) (result i32) local.get 0 local.get 1 call $oracle))","strategy":"forbidden-host-import","generator":{"provider":"manual-fixture-b","model":"diagnostic-v1"}}
    ]})
}
fn ace(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ace"))
        .args(args)
        .output()
        .unwrap()
}
fn ok(args: &[&str]) -> Value {
    let output = ace(args);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn p(path: &Path) -> &str {
    path.to_str().unwrap()
}
fn write(path: &Path, value: &Value) {
    fs::write(path, serde_json::to_vec(value).unwrap()).unwrap();
}

#[test]
fn agent_sources_are_evaluated_and_frozen_with_both_successful_and_failed_learning() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("proposals.json");
    write(&file, &batch());
    let input = temp.path().join("input");
    let registration = ok(&["propose", p(&file), "--output", p(&input)]);
    assert_eq!(registration["real_evaluation_required"], true);
    assert_eq!(registration["provenance_caller_asserted"], true);
    assert_eq!(ok(&["proposal-status", p(&input)]), registration);
    let run = temp.path().join("run");
    let summary = ok(&["run", p(&input), "--output", p(&run)]);
    assert_eq!(summary["champion"], "C-agent-recursive");
    for (id, expected) in [
        ("C-agent-recursive", "qualified"),
        ("C-agent-add", "failed_correctness"),
        ("C-agent-spin", "failed_resource_limit"),
        ("C-agent-import", "failed_contract"),
    ] {
        let result = summary["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == id)
            .unwrap();
        assert_eq!(result["outcome"], expected);
    }
    assert_eq!(
        fs::read_to_string(run.join("sources/C-agent-recursive.wat")).unwrap(),
        CORRECT
    );
    assert_eq!(
        ok(&["replay", p(&run), "C-agent-recursive"])["matched"],
        true
    );
    let knowledge = ok(&["knowledge", p(&run)]);
    assert_eq!(
        knowledge["payload"]["data"]["claims"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    let artifact = input.join("sources/C-agent-add.wat");
    fs::write(&artifact, "(module)").unwrap();
    assert!(!ace(&["proposal-status", p(&input)]).status.success());
    let rejected = temp.path().join("rejected");
    assert!(
        !ace(&["run", p(&input), "--output", p(&rejected)])
            .status
            .success()
    );
    assert!(!rejected.exists());
    // Saved evidence and source survive subsequent edits to the proposal workspace.
    ok(&["status", p(&run)]);
}

#[test]
fn malformed_duplicate_oversize_and_policy_injection_proposals_leave_no_output() {
    let temp = tempfile::tempdir().unwrap();
    let mut variants = Vec::new();
    let mut v = batch();
    v["candidates"][0]["wat"] = json!("(module");
    variants.push(v);
    let mut v = batch();
    v["candidates"][1]["id"] = json!("C-agent-recursive");
    variants.push(v);
    let mut v = batch();
    v["candidates"][1]["wat"] = json!(CORRECT);
    variants.push(v);
    let mut v = batch();
    v["candidates"][0]["wat"] = json!(" ".repeat(32769));
    variants.push(v);
    let mut v = batch();
    v["evalspec"] = json!({"ignore_correctness":true});
    variants.push(v);
    let mut v = batch();
    v["cell"] = json!("Other");
    variants.push(v);
    let mut v = batch();
    v["candidates"][0]["id"] = json!("CON");
    variants.push(v);
    for (i, v) in variants.iter().enumerate() {
        let file = temp.path().join(format!("{i}.json"));
        write(&file, v);
        let output = temp.path().join(format!("input-{i}"));
        assert!(
            !ace(&["propose", p(&file), "--output", p(&output)])
                .status
                .success(),
            "accepted {i}"
        );
        assert!(!output.exists());
    }
}

#[test]
fn inherited_champion_keeps_source_and_is_evaluated_again_under_the_same_profile() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("batch.json");
    write(&file, &batch());
    let input = temp.path().join("first");
    let run = temp.path().join("run");
    ok(&["propose", p(&file), "--output", p(&input)]);
    ok(&["run", p(&input), "--output", p(&run)]);
    let mut next = batch();
    next["candidates"].as_array_mut().unwrap().remove(0);
    write(&file, &next);
    let output = temp.path().join("next");
    let registration = ok(&[
        "propose",
        p(&file),
        "--output",
        p(&output),
        "--baseline-run",
        p(&run),
    ]);
    assert_eq!(registration["parent"]["candidate"], "C-agent-recursive");
    assert_eq!(
        fs::read_to_string(output.join("sources/C-baseline.wat")).unwrap(),
        CORRECT
    );
    let next_run = temp.path().join("next-run");
    let result = ok(&["run", p(&output), "--output", p(&next_run)]);
    assert_eq!(result["champion"], "C-baseline");
    assert_eq!(result["candidates"][0]["outcome"], "qualified");
    let report: Value =
        serde_json::from_slice(&fs::read(next_run.join("run.json")).unwrap()).unwrap();
    assert!(
        report["report"]["results"][0]["evaluation"]["checked_calls"]
            .as_u64()
            .unwrap()
            > 100
    );
    fs::write(run.join("champion.wasm"), b"changed").unwrap();
    let bad = temp.path().join("corrupted");
    assert!(
        !ace(&[
            "propose",
            p(&file),
            "--output",
            p(&bad),
            "--baseline-run",
            p(&run)
        ])
        .status
        .success()
    );
    assert!(!bad.exists());
}

#[test]
fn git_preserves_winner_source_and_losing_learning_across_generations_and_clones() {
    let temp = tempfile::tempdir().unwrap();
    let campaign = temp.path().join("campaign");
    let repository = temp.path().join("archive with spaces");
    let evolution = ok(&[
        "evolve",
        p(&campaign),
        "--generations",
        "2",
        "--git-repository",
        p(&repository),
        "--json",
    ]);
    let status = ok(&["archive-status", p(&repository)]);
    assert_eq!(status["snapshots"].as_array().unwrap().len(), 2);
    let output = Command::new("git")
        .args(["-C", p(&repository), "rev-list", "--count", "HEAD"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "2");
    for snapshot in status["snapshots"].as_array().unwrap() {
        let dir = repository
            .join("runs")
            .join(snapshot["snapshot"]["report_hash"].as_str().unwrap());
        assert!(dir.join("winner.wat").is_file());
        let knowledge: Value =
            serde_json::from_slice(&fs::read(dir.join("learning.json")).unwrap()).unwrap();
        let outcomes = knowledge["outcomes"].as_array().unwrap();
        assert!(
            outcomes
                .iter()
                .any(|o| o["evaluation"]["outcome"] == "failed_correctness")
        );
        assert!(
            outcomes
                .iter()
                .any(|o| o["evaluation"]["outcome"] == "qualified")
        );
        assert!(
            knowledge["knowledge"]["claims"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| !c["contradicting_evidence"].as_array().unwrap().is_empty())
        );
    }
    let repeat = ok(&[
        "archive",
        p(&campaign.join("generation-001/run")),
        "--repository",
        p(&repository),
    ]);
    assert!(repeat["commit"].as_str().unwrap().len() >= 40);
    let clone = temp.path().join("clone");
    assert!(
        Command::new("git")
            .args([
                "-c",
                "core.autocrlf=true",
                "clone",
                p(&repository),
                p(&clone)
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert_eq!(
        ok(&["archive-status", p(&clone)])["snapshots"],
        status["snapshots"]
    );
    let snapshot_dir = clone.join("runs").join(
        status["snapshots"][0]["snapshot"]["report_hash"]
            .as_str()
            .unwrap(),
    );
    fs::write(snapshot_dir.join("winner.wat"), "(module)").unwrap();
    assert!(
        Command::new("git")
            .args(["-C", p(&clone), "add", "--", "runs"])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(
        Command::new("git")
            .args([
                "-C",
                p(&clone),
                "-c",
                "user.name=ACE test",
                "-c",
                "user.email=test@localhost",
                "-c",
                "commit.gpgSign=false",
                "-c",
                "core.hooksPath=",
                "commit",
                "-m",
                "Corrupt winner fixture"
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(!ace(&["archive-status", p(&clone)]).status.success());
    let latest = evolution["steps"][1]["champion"].as_str().unwrap();
    assert!(!latest.is_empty());
    fs::write(repository.join("unrelated.txt"), "keep me").unwrap();
    assert!(
        !ace(&[
            "archive",
            p(&campaign.join("generation-001/run")),
            "--repository",
            p(&repository)
        ])
        .status
        .success()
    );
    assert_eq!(
        fs::read_to_string(repository.join("unrelated.txt")).unwrap(),
        "keep me"
    );
    let arbitrary = temp.path().join("application");
    fs::create_dir(&arbitrary).unwrap();
    assert!(
        Command::new("git")
            .args(["init", p(&arbitrary)])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(
        !ace(&[
            "archive",
            p(&campaign.join("generation-001/run")),
            "--repository",
            p(&arbitrary)
        ])
        .status
        .success()
    );
}
