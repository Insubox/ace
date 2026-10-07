use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

fn rpc(root: &Path, requests: &[Value]) -> Vec<Value> {
    rpc_with_path(root, requests, "")
}
fn rpc_with_path(root: &Path, requests: &[Value], tool_path: &str) -> Vec<Value> {
    let mut command = Command::new(env!("CARGO_BIN_EXE_ace"));
    command
        .args(["mcp", "--workspace", root.to_str().unwrap()])
        .env_clear()
        .env("PATH", tool_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", system_root);
    }
    let mut child = command.spawn().unwrap();
    let mut input = child.stdin.take().unwrap();
    for request in requests {
        writeln!(input, "{request}").unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn agents_submit_their_own_sources_and_inspect_real_outcomes() {
    let temp = tempfile::tempdir().unwrap();
    let proposals: Value = serde_json::from_str(include_str!(
        "../../../examples/agent-proposals/proposals.json"
    ))
    .unwrap();
    let responses = rpc(
        temp.path(),
        &[
            call(
                1,
                "ace_propose",
                json!({"experiment":"agents","proposals":proposals}),
            ),
            call(2, "ace_proposal_status", json!({"experiment":"agents"})),
            call(3, "ace_run", json!({"experiment":"agents","run":"agents"})),
            call(4, "ace_knowledge", json!({"run":"agents"})),
            call(
                5,
                "ace_explain",
                json!({"run":"agents","candidate":"C-agent-add"}),
            ),
        ],
    );
    assert_eq!(value(&responses[0]), value(&responses[1]));
    assert_eq!(value(&responses[2])["champion"], "C-agent-recursive");
    assert_eq!(value(&responses[3])["claims"].as_array().unwrap().len(), 5);
    assert_eq!(
        value(&responses[4])["evaluation"]["outcome"],
        "failed_correctness"
    );
}

#[test]
fn git_tools_commit_learning_and_winner_sources_inside_the_selected_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc_with_path(
        temp.path(),
        &[
            call(1, "ace_generate", json!({"experiment":"first"})),
            call(2, "ace_run", json!({"experiment":"first","run":"first"})),
            call(
                3,
                "ace_archive",
                json!({"run":"first","repository":"history"}),
            ),
            call(4, "ace_archive_status", json!({"repository":"history"})),
            call(
                5,
                "ace_archive",
                json!({"run":"first","repository":"../outside"}),
            ),
        ],
        &std::env::var("PATH").unwrap(),
    );
    value(&responses[0]);
    value(&responses[1]);
    let saved = value(&responses[2]);
    assert!(!saved["commit"].as_str().unwrap().is_empty());
    let status = value(&responses[3]);
    assert_eq!(status["verified"], true);
    assert_eq!(status["snapshots"][0]["commit"], saved["commit"]);
    assert_eq!(responses[4]["result"]["isError"], true);
}
fn call(id: u32, name: &str, arguments: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}})
}
fn value(response: &Value) -> Value {
    assert_eq!(response["result"]["isError"], false, "{response}");
    let value: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(value, response["result"]["structuredContent"]);
    value
}

#[test]
fn local_agents_generate_evaluate_and_inspect_real_evidence_over_stdio() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc(
        temp.path(),
        &[
            json!({"jsonrpc":"2.0","id":"hello","method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
            call(2, "ace_generate", json!({"experiment":"first"})),
            call(3, "ace_run", json!({"experiment":"first","run":"first"})),
            call(4, "ace_status", json!({"run":"first"})),
            call(5, "ace_champion", json!({"run":"first"})),
            call(6, "ace_knowledge", json!({"run":"first"})),
            call(
                7,
                "ace_explain",
                json!({"run":"first","candidate":"C-control-add"}),
            ),
        ],
    );
    assert_eq!(responses.len(), 8);
    assert_eq!(responses[0]["id"], "hello");
    assert_eq!(
        responses[1]["result"]["tools"].as_array().unwrap().len(),
        12
    );
    value(&responses[2]);
    let report = value(&responses[3]);
    assert_eq!(report["candidates"].as_array().unwrap().len(), 13);
    assert_eq!(value(&responses[4]), report);
    assert_eq!(value(&responses[5])["candidate"], report["champion"]);
    assert!(
        !value(&responses[6])["claims"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        value(&responses[7])["evaluation"]["outcome"],
        "failed_correctness"
    );
    assert!(temp.path().join("runs/first/champion.wasm").is_file());
}

#[test]
fn tool_errors_do_not_overwrite_outputs_or_expose_paths_outside_the_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc(
        temp.path(),
        &[
            call(1, "ace_generate", json!({"experiment":"kept"})),
            call(2, "ace_generate", json!({"experiment":"kept"})),
            call(3, "ace_generate", json!({"experiment":"../outside"})),
            call(4, "ace_generate", json!({"experiment":"CON"})),
            call(
                5,
                "ace_generate",
                json!({"experiment":"bad","candidates":101}),
            ),
            call(
                6,
                "ace_run",
                json!({"experiment":"kept","run":"run","shell":"ignored?"}),
            ),
        ],
    );
    let original = value(&responses[0]);
    for response in &responses[1..] {
        assert_eq!(response["result"]["isError"], true);
    }
    let saved: Value = serde_json::from_slice(
        &fs::read(temp.path().join("experiments/kept/generation.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(saved, original);
    assert!(!temp.path().join("experiments/bad").exists());
    assert!(!temp.path().join("runs/run").exists());
}

#[test]
fn campaigns_and_linked_knowledge_remain_verifiable_through_agent_tools() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc(
        temp.path(),
        &[
            call(
                1,
                "ace_evolve",
                json!({"campaign":"search","generations":3,"candidates":8}),
            ),
            call(2, "ace_history", json!({"campaign":"search"})),
        ],
    );
    assert_eq!(value(&responses[0]), value(&responses[1]));
}

#[test]
fn seed_precision_survives_machine_clients_and_untyped_json_requests_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc(
        temp.path(),
        &[
            call(
                1,
                "ace_generate",
                json!({"experiment":"wide","seed":u64::MAX.to_string()}),
            ),
            call(2, "ace_generate", json!({"experiment":"rounded","seed":42})),
            json!(["invalid request"]),
        ],
    );
    assert_eq!(value(&responses[0])["seed"], u64::MAX.to_string());
    assert_eq!(responses[1]["result"]["isError"], true);
    assert_eq!(responses[2]["error"]["code"], -32600);
}

#[cfg(unix)]
#[test]
fn symlinked_categories_and_runs_cannot_escape_the_operator_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join("experiments")).unwrap();
    let responses = rpc(
        temp.path(),
        &[call(1, "ace_generate", json!({"experiment":"escape"}))],
    );
    assert_eq!(responses[0]["result"]["isError"], true);
    assert!(!outside.path().join("escape").exists());
    fs::remove_file(temp.path().join("experiments")).unwrap();
    fs::create_dir(temp.path().join("runs")).unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join("runs/outside")).unwrap();
    let responses = rpc(
        temp.path(),
        &[call(1, "ace_status", json!({"run":"outside"}))],
    );
    assert_eq!(responses[0]["result"]["isError"], true);
}
