use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs,
    path::Path,
    process::{Command, Output},
};

fn ace(args: &[&str]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_ace"));
    command.args(args).env_clear().env("PATH", "");
    if let Some(root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", root);
    }
    command.output().unwrap()
}
fn success(args: &[&str]) -> Value {
    let output = ace(args);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
fn path(path: &Path) -> &str {
    path.to_str().unwrap()
}

#[test]
fn demo_runs_without_external_tools_rejects_controls_and_replays_champion() {
    let temp = tempfile::tempdir().unwrap();
    let demo = temp.path().join("demo");
    let summary = success(&["demo", path(&demo), "--json"]);
    assert_eq!(summary["status"], "completed");
    let results = summary["candidates"].as_array().unwrap();
    assert_eq!(results.len(), 13);
    for (id, outcome) in [
        ("C-control-add", "failed_correctness"),
        ("C-control-spin", "failed_resource_limit"),
        ("C-control-grow", "failed_resource_limit"),
    ] {
        assert_eq!(
            results.iter().find(|r| r["id"] == id).unwrap()["outcome"],
            outcome
        );
    }
    assert_eq!(
        results
            .iter()
            .filter(|r| r["outcome"] == "qualified")
            .count(),
        10
    );
    let run = demo.join("run");
    success(&["status", path(&run)]);
    assert_eq!(
        success(&["replay", path(&run), summary["champion"].as_str().unwrap()])["matched"],
        true
    );
    assert!(!ace(&["demo", path(&demo)]).status.success());
    let output = ace(&["demo", path(&temp.path().join("human"))]);
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("ACE demo completed")
    );
}

#[test]
fn generated_populations_are_reproducible_distinct_and_cover_the_full_grammar() {
    let temp = tempfile::tempdir().unwrap();
    for seed in ["42", "43"] {
        let input = temp.path().join(seed);
        let second = temp.path().join(format!("same-{seed}"));
        let a = success(&[
            "generate",
            path(&input),
            "--seed",
            seed,
            "--candidates",
            "100",
        ]);
        let b = success(&[
            "generate",
            path(&second),
            "--seed",
            seed,
            "--candidates",
            "100",
        ]);
        assert_eq!(a, b);
        let artifacts = a["artifacts"].as_array().unwrap();
        assert_eq!(artifacts.len(), 101);
        assert_eq!(
            artifacts
                .iter()
                .map(|a| a["artifact_hash"].as_str().unwrap())
                .collect::<BTreeSet<_>>()
                .len(),
            101
        );
        let run = temp.path().join(format!("run-{seed}"));
        let summary = success(&["run", path(&input), "--output", path(&run), "--jobs", "4"]);
        assert_eq!(
            summary["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["outcome"] == "qualified")
                .count(),
            98
        );
    }
    for invalid in ["0", "3", "101"] {
        assert!(
            !ace(&[
                "generate",
                path(&temp.path().join("invalid")),
                "--candidates",
                invalid
            ])
            .status
            .success()
        );
    }
    assert!(!temp.path().join("invalid").exists());
}

#[test]
fn evolution_verifies_lineage_stops_on_stagnation_and_rejects_corruption() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("campaign");
    let campaign = success(&[
        "evolve",
        path(&root),
        "--generations",
        "8",
        "--patience",
        "2",
        "--json",
    ]);
    assert_eq!(campaign["stop_reason"], "no_improvement");
    assert!(campaign["steps"].as_array().unwrap().len() < 8);
    assert_eq!(success(&["history", path(&root)]), campaign);
    let steps = campaign["steps"].as_array().unwrap();
    for pair in steps.windows(2) {
        assert_eq!(
            pair[0]["champion_artifact_hash"],
            pair[1]["baseline_artifact_hash"]
        );
        assert!(pair[1]["mean_fuel"].as_f64().unwrap() <= pair[0]["mean_fuel"].as_f64().unwrap());
        let linked: Value = serde_json::from_slice(
            &fs::read(root.join(format!(
                "generation-{:03}/knowledge-linked.json",
                pair[1]["generation"].as_u64().unwrap()
            )))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            linked["payload"]["data"]["parents"][0],
            pair[0]["knowledge"]
        );
    }
    let receipt = root.join("generation-002/receipt.json");
    let saved = fs::read(&receipt).unwrap();
    fs::write(&receipt, b"{}").unwrap();
    assert!(!ace(&["history", path(&root)]).status.success());
    fs::write(receipt, saved).unwrap();
    let source = root.join("generation-001/sources/C-control-add.wat");
    let saved = fs::read(&source).unwrap();
    fs::write(&source, b"(module)").unwrap();
    assert!(!ace(&["history", path(&root)]).status.success());
    fs::write(source, saved).unwrap();
    let artifact = root.join("champion.wasm");
    let saved = fs::read(&artifact).unwrap();
    fs::remove_file(&artifact).unwrap();
    assert!(!ace(&["history", path(&root)]).status.success());
    fs::write(artifact, saved).unwrap();
    let file = root.join("evolution.json");
    let mut changed = campaign;
    changed["steps"][1]["baseline_artifact_hash"] =
        changed["steps"][0]["baseline_artifact_hash"].clone();
    fs::write(file, serde_json::to_vec(&changed).unwrap()).unwrap();
    assert!(!ace(&["history", path(&root)]).status.success());
}
