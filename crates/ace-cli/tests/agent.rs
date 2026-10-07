use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
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
fn batch(indices: &[usize]) -> Value {
    let example: Value = serde_json::from_str(include_str!(
        "../../../examples/agent-proposals/proposals.json"
    ))
    .unwrap();
    json!({"schema_version":1,"cell":"Gcd","candidates":indices.iter().map(|i| example["candidates"][i].clone()).collect::<Vec<_>>()})
}
fn setup(root: &Path, attempts: &str, patience: &str) -> Value {
    ok(&["demo", p(&root.join("baseline")), "--json"]);
    ok(&[
        "agent-start",
        p(&root.join("campaign")),
        "--campaign",
        "test",
        "--baseline-run",
        p(&root.join("baseline/run")),
        "--repository",
        p(&root.join("history")),
        "--rounds",
        "4",
        "--attempts",
        attempts,
        "--patience",
        patience,
    ])
}

#[test]
fn agent_rounds_use_verified_learning_retest_winners_and_stop_without_losing_code() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let started = setup(root, "3", "1");
    let task = &started["task"];
    assert!(
        task["context"]["memory"]["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["outcome"] == "failed_correctness")
    );
    let encoded = serde_json::to_string(task).unwrap();
    assert!(!encoded.contains("oracle_seed"));
    assert!(!encoded.contains("hidden_cases"));
    assert!(!encoded.contains("reason\":\"GCD"));
    let file = root.join("submission.json");
    let submission = json!({"context_hash":task["context_hash"],"proposals":batch(&[0,1]),"provider_receipt":null});
    write(&file, &submission);
    let first = ok(&["agent-submit", p(&root.join("campaign")), p(&file)]);
    assert_eq!(first["completed_rounds"], 1);
    assert!(
        first["winner"]["mean_fuel"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap()
            < started["winner"]["mean_fuel"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap()
    );
    assert_eq!(
        ok(&["agent-submit", p(&root.join("campaign")), p(&file)]),
        first
    );
    let next = ok(&["agent-next", p(&root.join("campaign"))]);
    assert_eq!(next["task"]["context"]["round"], 2);
    assert_eq!(
        next["task"]["context"]["memory"]["winner"]["artifact_hash"],
        first["winner"]["artifact_hash"]
    );
    assert!(
        next["task"]["context"]["memory"]["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["candidate"] == "C-agent-add")
    );
    write(
        &file,
        &json!({"context_hash":next["task"]["context_hash"],"proposals":batch(&[2,3]),"provider_receipt":null}),
    );
    let finished = ok(&["agent-submit", p(&root.join("campaign")), p(&file)]);
    assert_eq!(finished["stop_reason"], "no_improvement");
    assert_eq!(finished["completed_rounds"], 2);
    assert_eq!(
        finished["winner"]["artifact_hash"],
        first["winner"]["artifact_hash"]
    );
    assert_eq!(ok(&["agent-next", p(&root.join("campaign"))]), finished);
    let history = ok(&["archive-status", p(&root.join("history"))]);
    assert_eq!(history["snapshots"].as_array().unwrap().len(), 3);
    let memory = ok(&[
        "memory",
        p(&root.join("history")),
        "--baseline-run",
        p(&root.join("baseline/run")),
        "--limit",
        "64",
    ]);
    assert_eq!(memory["compatible_runs"], 3);
    assert!(
        memory["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["candidate"] == "C-agent-spin" && o["outcome"] == "failed_resource_limit")
    );
    let last: Value = serde_json::from_slice(
        &fs::read(root.join("campaign/round-002/attempt-001/run/run.json")).unwrap(),
    )
    .unwrap();
    assert!(
        last["report"]["results"][0]["evaluation"]["checked_calls"]
            .as_u64()
            .unwrap()
            > 100
    );
}

#[test]
fn generator_faults_have_separate_budgets_git_records_and_no_candidate_labels() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let mut state = setup(root, "2", "2");
    let file = root.join("fault.json");
    for kind in ["unavailable", "invalid_response"] {
        write(
            &file,
            &json!({"context_hash":state["task"]["context_hash"],"fault":kind,"provider_receipt":null}),
        );
        ok(&["agent-fault", p(&root.join("campaign")), p(&file)]);
        state = ok(&["agent-next", p(&root.join("campaign"))]);
    }
    assert_eq!(state["stop_reason"], "provider_attempts");
    assert_eq!(state["completed_rounds"], 0);
    assert_eq!(state["generation_attempts"], 2);
    let saved = ok(&["archive-status", p(&root.join("history"))]);
    assert_eq!(saved["snapshots"].as_array().unwrap().len(), 1);
    assert_eq!(saved["generator_faults"].as_array().unwrap().len(), 2);
    assert!(
        saved["generator_faults"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["candidate_evaluation_performed"] == false)
    );
    assert!(!root.join("campaign/round-001/attempt-001/run").exists());
}

#[test]
fn stale_context_oversized_proposal_counts_and_changed_tasks_are_rejected_before_execution() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let state = setup(root, "2", "2");
    let file = root.join("submission.json");
    for submission in [
        json!({"context_hash":"0".repeat(64),"proposals":batch(&[0]),"provider_receipt":null}),
        json!({"context_hash":state["task"]["context_hash"],"proposals":batch(&[0,1,2]),"provider_receipt":null}),
    ] {
        write(&file, &submission);
        assert!(
            !ace(&["agent-submit", p(&root.join("campaign")), p(&file)])
                .status
                .success()
        );
    }
    assert!(!root.join("campaign/round-001/attempt-001/input").exists());
    let path = root.join("campaign/round-001/attempt-001/task.json");
    let mut changed = state["task"].clone();
    changed["context"]["memory"]["winner"]["wat"] = json!("(module)");
    write(&path, &changed);
    assert!(
        !ace(&["agent-status", p(&root.join("campaign"))])
            .status
            .success()
    );
}

#[test]
fn completed_evidence_repairs_an_interrupted_step_without_evaluating_again() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let state = setup(root, "2", "2");
    let file = root.join("submission.json");
    write(
        &file,
        &json!({"context_hash":state["task"]["context_hash"],"proposals":batch(&[0,1]),"provider_receipt":null}),
    );
    let expected = ok(&["agent-submit", p(&root.join("campaign")), p(&file)]);
    let run = root.join("campaign/round-001/attempt-001/run/run.json");
    let saved = fs::read(&run).unwrap();
    fs::remove_file(root.join("campaign/round-001/step.json")).unwrap();
    assert_eq!(
        ok(&["agent-submit", p(&root.join("campaign")), p(&file)]),
        expected
    );
    assert_eq!(fs::read(run).unwrap(), saved);
    let receipt = root.join("campaign/round-001/step.json");
    let mut tampered: Value = serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    tampered["archive_commit"] = json!("0".repeat(40));
    write(&receipt, &tampered);
    assert!(
        !ace(&["agent-status", p(&root.join("campaign"))])
            .status
            .success()
    );
}

#[test]
fn knowledge_retrieval_excludes_other_projects_and_evaluation_profiles() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    setup(root, "2", "2");
    let input = root.join("other");
    ok(&["generate", p(&input)]);
    let cfg = input.join("experiment.json");
    let mut config: Value = serde_json::from_slice(&fs::read(&cfg).unwrap()).unwrap();
    config["project"] = json!("PRJ-other");
    write(&cfg, &config);
    fs::remove_file(input.join("generation.json")).unwrap();
    let run = root.join("other-run");
    ok(&["run", p(&input), "--output", p(&run), "--jobs", "2"]);
    ok(&["archive", p(&run), "--repository", p(&root.join("history"))]);
    let memory = ok(&[
        "memory",
        p(&root.join("history")),
        "--baseline-run",
        p(&root.join("baseline/run")),
    ]);
    assert_eq!(memory["compatible_runs"], 1);
    assert_eq!(memory["excluded_runs"], 1);
    assert!(
        memory["observations"]
            .as_array()
            .unwrap()
            .iter()
            .all(|o| o["experiment"] != "EXP-other")
    );
}

#[cfg(unix)]
#[test]
fn campaign_symlinks_cannot_write_or_read_outside_the_campaign() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    setup(root, "2", "2");
    let outside = root.join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, root.join("campaign/round-002")).unwrap();
    let output = ace(&["agent-next", p(&root.join("campaign"))]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("escapes its campaign"));
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[test]
fn a_dedicated_git_archive_can_live_inside_a_fresh_campaign() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    ok(&["demo", p(&root.join("baseline")), "--json"]);
    let state = ok(&[
        "agent-start",
        p(&root.join("campaign")),
        "--campaign",
        "nested",
        "--baseline-run",
        p(&root.join("baseline/run")),
        "--repository",
        p(&root.join("campaign/history")),
    ]);
    assert_eq!(state["task"]["context"]["round"], 1);
    assert!(
        ok(&["archive-status", p(&root.join("campaign/history"))])["verified"]
            .as_bool()
            .unwrap()
    );
}
