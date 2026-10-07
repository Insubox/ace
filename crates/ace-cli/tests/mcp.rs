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
fn human_reports_are_verified_exported_and_preserved_inside_the_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc(
        temp.path(),
        &[
            call(1, "ace_generate", json!({"experiment":"first"})),
            call(2, "ace_run", json!({"experiment":"first","run":"first"})),
            call(3, "ace_inspect", json!({"run":"first","report":"first"})),
            call(4, "ace_inspect", json!({"run":"first","report":"first"})),
            call(
                5,
                "ace_inspect",
                json!({"run":"first","report":"../escape"}),
            ),
        ],
    );
    assert_eq!(value(&responses[2])["verified_at_export"], true);
    assert_eq!(responses[3]["result"]["isError"], true);
    assert_eq!(responses[4]["result"]["isError"], true);
    let html = fs::read_to_string(temp.path().join("reports/first/index.html")).unwrap();
    assert!(html.contains(value(&responses[2])["report_hash"].as_str().unwrap()));
    assert!(!html.contains("__ACE_DATA__"));
}

#[test]
fn agents_use_native_history_campaigns_and_clones_without_git_on_the_path() {
    let temp = tempfile::tempdir().unwrap();
    let responses = rpc(
        temp.path(),
        &[
            call(1, "ace_generate", json!({"experiment":"first"})),
            call(2, "ace_run", json!({"experiment":"first","run":"first"})),
            call(3, "ace_store_save", json!({"run":"first","store":"main"})),
            call(
                4,
                "ace_store_clone",
                json!({"store":"main","destination":"copy"}),
            ),
            call(
                5,
                "ace_memory",
                json!({"store":"copy","baseline_run":"first"}),
            ),
            call(
                6,
                "ace_agent_start",
                json!({"campaign":"agent","baseline_run":"first","store":"main","rounds":1}),
            ),
            call(7, "ace_agent_status", json!({"campaign":"agent"})),
            call(8, "ace_store_log", json!({"store":"main"})),
        ],
    );
    assert_eq!(value(&responses[2])["backend"], "ace-native-v1");
    assert_eq!(
        value(&responses[3])["versions"].as_array().unwrap().len(),
        1
    );
    assert_eq!(value(&responses[4])["compatible_runs"], 1);
    assert_eq!(value(&responses[5]), value(&responses[6]));
    assert_eq!(value(&responses[7])["verified"], true);
    assert!(!temp.path().join("stores/main/.git").exists());
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

#[test]
fn mcp_agents_receive_learning_submit_proposals_and_advance_a_bounded_campaign() {
    let temp = tempfile::tempdir().unwrap();
    let tool_path = std::env::var("PATH").unwrap();
    let initial = rpc_with_path(
        temp.path(),
        &[
            call(1, "ace_generate", json!({"experiment":"seed"})),
            call(2, "ace_run", json!({"experiment":"seed","run":"seed"})),
            call(
                3,
                "ace_agent_start",
                json!({"campaign":"agents","baseline_run":"seed","repository":"history","rounds":2}),
            ),
            call(
                4,
                "ace_memory",
                json!({"repository":"history","baseline_run":"seed"}),
            ),
            call(5, "ace_agent_next", json!({"campaign":"agents"})),
        ],
        &tool_path,
    );
    let start = value(&initial[2]);
    assert_eq!(value(&initial[4])["task"], start["task"]);
    assert!(
        value(&initial[3])["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["outcome"] == "failed_correctness")
    );
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../examples/agent-proposals/proposals.json"
    ))
    .unwrap();
    let batch = json!({"schema_version":1,"cell":"Gcd","candidates":fixture["candidates"].as_array().unwrap()[..2].to_vec()});
    let result = rpc_with_path(
        temp.path(),
        &[
            call(
                6,
                "ace_agent_submit",
                json!({"campaign":"agents","submission":{"context_hash":start["task"]["context_hash"],"proposals":batch,"provider_receipt":null}}),
            ),
            call(7, "ace_agent_next", json!({"campaign":"agents"})),
            call(8, "ace_agent_status", json!({"campaign":"agents"})),
        ],
        &tool_path,
    );
    assert_eq!(value(&result[0])["completed_rounds"], 1);
    let next = value(&result[1]);
    assert_eq!(next, value(&result[2]));
    assert_eq!(next["task"]["context"]["round"], 2);
    assert!(
        next["task"]["context"]["memory"]["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["candidate"] == "C-agent-add")
    );
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
        30
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

#[test]
fn agents_merge_native_branches_with_explicit_expectations_inside_the_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let source = root.join("sources/source");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("code.txt"), "one\ntwo\nthree\n").unwrap();
    let first = rpc(
        root,
        &[call(
            1,
            "ace_store_commit",
            json!({"store":"a","source":"source","files":["code.txt"],"message":"base"}),
        )],
    );
    let base = value(&first[0])["version"].as_str().unwrap().to_owned();
    rpc(
        root,
        &[
            call(
                2,
                "ace_store_branch",
                json!({"store":"a","name":"main","target":base}),
            ),
            call(3, "ace_store_clone", json!({"store":"a","destination":"b"})),
        ],
    );
    fs::write(source.join("code.txt"), "ONE\ntwo\nthree\n").unwrap();
    let ours=value(&rpc(root,&[call(4,"ace_store_commit",json!({"store":"a","source":"source","files":["code.txt"],"message":"first line","parents":[base]}))])[0])["version"].as_str().unwrap().to_owned();
    fs::write(source.join("code.txt"), "one\ntwo\nTHREE\n").unwrap();
    let theirs=value(&rpc(root,&[call(5,"ace_store_commit",json!({"store":"b","source":"source","files":["code.txt"],"message":"third line","parents":[base]}))])[0])["version"].as_str().unwrap().to_owned();
    let replies = rpc(
        root,
        &[
            call(
                6,
                "ace_store_branch",
                json!({"store":"a","name":"main","target":ours,"expected":base}),
            ),
            call(
                7,
                "ace_store_branch",
                json!({"store":"b","name":"main","target":theirs,"expected":base}),
            ),
            call(
                8,
                "ace_store_fetch",
                json!({"source":"a","destination":"b"}),
            ),
            call(
                9,
                "ace_store_diff",
                json!({"store":"b","left":ours,"right":theirs}),
            ),
            call(
                10,
                "ace_store_merge",
                json!({"store":"b","ours":theirs,"theirs":ours,"output":"merged","message":"combine"}),
            ),
        ],
    );
    assert_eq!(value(&replies[2])["imported"], 1);
    assert_eq!(value(&replies[3])["changes"][0]["path"], "code.txt");
    let merged = value(&replies[4]);
    assert_eq!(merged["status"], "merged");
    assert_eq!(merged["evaluation_required"], true);
    assert_eq!(
        fs::read(root.join("merges/merged/merged/code.txt")).unwrap(),
        b"ONE\ntwo\nTHREE\n"
    );
    let id = merged["version"].as_str().unwrap();
    let replies = rpc(
        root,
        &[
            call(
                11,
                "ace_store_branch",
                json!({"store":"b","name":"main","target":id,"expected":theirs}),
            ),
            call(
                12,
                "ace_store_branch",
                json!({"store":"b","name":"main","target":id,"expected":theirs}),
            ),
            call(13, "ace_store_refs", json!({"store":"b"})),
        ],
    );
    assert_eq!(replies[1]["result"]["isError"], true);
    assert_eq!(value(&replies[2])["heads"]["main"], id);
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        fs::rename(root.join("merges"), root.join("previous-merges")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("merges")).unwrap();
        let rejected = rpc(
            root,
            &[call(
                14,
                "ace_store_merge",
                json!({"store":"b","ours":theirs,"theirs":ours,"output":"escape","message":"rejected"}),
            )],
        );
        assert_eq!(rejected[0]["result"]["isError"], true);
        assert!(!outside.path().join("escape").exists());
    }
}
