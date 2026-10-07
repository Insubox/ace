use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
fn ace(args: &[&str], git: bool) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_ace"));
    command.args(args);
    if !git {
        command.env_clear().env("PATH", "");
        if let Some(p) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", p);
        }
    }
    command.output().unwrap()
}
fn ok(args: &[&str]) -> Value {
    let output = ace(args, false);
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
    fs::write(path, serde_json::to_vec(value).unwrap()).unwrap()
}

#[test]
fn native_source_versions_share_objects_branch_restore_and_clone_without_git() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("code.txt"), b"first\r\n").unwrap();
    fs::write(source.join("same.bin"), [0, 255, 1]).unwrap();
    let files = r.join("files.json");
    write(&files, &json!(["code.txt", "same.bin"]));
    let store = r.join("history");
    let first = ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "first",
    ]);
    fs::write(source.join("code.txt"), b"second\n").unwrap();
    let second = ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "second",
    ]);
    fs::write(source.join("code.txt"), b"branch\n").unwrap();
    let branch = ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "branch",
        "--parent",
        first["version"].as_str().unwrap(),
    ]);
    let log = ok(&["store", "log", p(&store)]);
    assert_eq!(log["backend"], "ace-native-v1");
    assert_eq!(log["objects"], 4);
    assert_eq!(log["versions"][1]["parents"], json!([first["version"]]));
    assert_eq!(log["versions"][2]["parents"], json!([first["version"]]));
    assert_ne!(branch["version"], second["version"]);
    assert!(!store.join(".git").exists());
    let output = r.join("checkout");
    ok(&[
        "store",
        "checkout",
        first["version"].as_str().unwrap(),
        "--store",
        p(&store),
        "--output",
        p(&output),
    ]);
    assert_eq!(fs::read(output.join("code.txt")).unwrap(), b"first\r\n");
    assert_eq!(fs::read(output.join("same.bin")).unwrap(), [0, 255, 1]);
    assert!(
        !ace(
            &[
                "store",
                "checkout",
                branch["version"].as_str().unwrap(),
                "--store",
                p(&store),
                "--output",
                p(&output)
            ],
            false
        )
        .status
        .success()
    );
    let cloned = r.join("copy");
    let copied = ok(&["store", "clone", p(&store), p(&cloned)]);
    assert_eq!(copied["versions"], log["versions"]);
    assert_eq!(copied["tip"], log["tip"]);
}

#[test]
fn native_campaigns_keep_winner_loser_and_parser_feedback_then_export_optionally() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let base = r.join("baseline");
    let store = r.join("history");
    let campaign = r.join("campaign");
    ok(&["demo", p(&base), "--json"]);
    let mut state = ok(&[
        "agent-start",
        p(&campaign),
        "--campaign",
        "native",
        "--baseline-run",
        p(&base.join("run")),
        "--store",
        p(&store),
        "--rounds",
        "1",
        "--attempts",
        "2",
    ]);
    let fault = r.join("fault.json");
    write(
        &fault,
        &json!({"context_hash":state["task"]["context_hash"],"fault":"invalid_proposal","provider_receipt":null,"compiler_diagnostic":"expected closing parenthesis in generated module"}),
    );
    ok(&["agent-fault", p(&campaign), p(&fault)]);
    state = ok(&["agent-next", p(&campaign)]);
    assert_eq!(
        state["task"]["context"]["previous_generator_diagnostic"],
        "expected closing parenthesis in generated module"
    );
    let batch: Value = serde_json::from_str(include_str!(
        "../../../examples/agent-proposals/proposals.json"
    ))
    .unwrap();
    let submission = r.join("submission.json");
    write(
        &submission,
        &json!({"context_hash":state["task"]["context_hash"],"provider_receipt":null,"proposals":{"schema_version":1,"cell":"Gcd","candidates":[batch["candidates"][0],batch["candidates"][1]]}}),
    );
    let completed = ok(&["agent-submit", p(&campaign), p(&submission)]);
    assert_eq!(completed["stop_reason"], "round_budget");
    assert_eq!(completed["winner"]["mean_fuel"], "23.5");
    let memory = ok(&["memory", p(&store), "--baseline-run", p(&base.join("run"))]);
    assert_eq!(memory["compatible_runs"], 2);
    assert!(
        memory["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["candidate"] == "C-agent-add" && o["outcome"] == "failed_correctness")
    );
    let saved = ok(&["store", "log", p(&store)]);
    assert_eq!(saved["snapshots"].as_array().unwrap().len(), 2);
    assert_eq!(saved["generator_faults"].as_array().unwrap().len(), 1);
    assert!(
        saved["versions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["version"].as_str().unwrap().len() == 64)
    );
    let clone = r.join("cloned");
    ok(&["store", "clone", p(&store), p(&clone)]);
    let learned = ok(&["memory", p(&clone), "--baseline-run", p(&base.join("run"))]);
    assert_eq!(learned, memory);
    let git = r.join("compatibility-export");
    let exported = ace(
        &["store", "export-git", p(&store), "--repository", p(&git)],
        true,
    );
    assert!(
        exported.status.success(),
        "{}",
        String::from_utf8_lossy(&exported.stderr)
    );
    let exported: Value = serde_json::from_slice(&exported.stdout).unwrap();
    assert_eq!(exported["snapshots"].as_array().unwrap().len(), 2);
    assert_eq!(exported["generator_faults"].as_array().unwrap().len(), 1);
    assert_eq!(
        ok(&["store", "log", p(&store)])["versions"],
        saved["versions"]
    );
}

#[test]
fn object_and_journal_corruption_is_rejected_without_changing_existing_versions() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("code.txt"), "code").unwrap();
    let files = r.join("files.json");
    write(&files, &json!(["code.txt"]));
    let store = r.join("history");
    ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "first",
    ]);
    let object = fs::read_dir(store.join("objects"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(&object, "changed").unwrap();
    assert!(!ace(&["store", "log", p(&store)], false).status.success());
    let output = r.join("checkout");
    let hash = ok_from_version_file(&store);
    assert!(
        !ace(
            &[
                "store",
                "checkout",
                &hash,
                "--store",
                p(&store),
                "--output",
                p(&output)
            ],
            false
        )
        .status
        .success()
    );
    assert!(!output.exists());
    fs::write(object, "code").unwrap();
    let journal = store.join("journal/00000001.json");
    let old = fs::read(&journal).unwrap();
    let mut changed: Value = serde_json::from_slice(&old).unwrap();
    changed["previous"] = json!("0".repeat(64));
    write(&journal, &changed);
    assert!(!ace(&["store", "log", p(&store)], false).status.success());
    fs::write(journal, old).unwrap();
    assert_eq!(
        ok(&["store", "log", p(&store)])["versions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
fn ok_from_version_file(store: &Path) -> String {
    fs::read_dir(store.join("versions"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
        .file_stem()
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned()
}

#[test]
fn path_escape_duplicate_file_and_file_directory_conflicts_create_no_store() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("code.txt"), "code").unwrap();
    let files = r.join("files.json");
    for (i, names) in [
        json!(["../outside"]),
        json!(["/absolute"]),
        json!(["code.txt", "code.txt"]),
        json!(["CON.txt"]),
        json!(["a\\b"]),
        json!(["code.txt/subfile"]),
    ]
    .iter()
    .enumerate()
    {
        write(&files, names);
        let store = r.join(format!("store-{i}"));
        assert!(
            !ace(
                &[
                    "store",
                    "commit",
                    p(&source),
                    "--store",
                    p(&store),
                    "--files",
                    p(&files),
                    "--message",
                    "invalid"
                ],
                false
            )
            .status
            .success()
        );
        assert!(!store.exists());
    }
}

#[cfg(unix)]
#[test]
fn native_store_and_source_symlinks_cannot_escape_the_selected_root() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    fs::write(r.join("outside"), "outside").unwrap();
    symlink(r.join("outside"), source.join("code.txt")).unwrap();
    let files = r.join("files.json");
    write(&files, &json!(["code.txt"]));
    let store = r.join("history");
    assert!(
        !ace(
            &[
                "store",
                "commit",
                p(&source),
                "--store",
                p(&store),
                "--files",
                p(&files),
                "--message",
                "invalid"
            ],
            false
        )
        .status
        .success()
    );
    assert!(!store.exists());
    fs::remove_file(source.join("code.txt")).unwrap();
    fs::write(source.join("code.txt"), "code").unwrap();
    ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "first",
    ]);
    let outside = r.join("outside-objects");
    fs::rename(store.join("objects"), &outside).unwrap();
    symlink(&outside, store.join("objects")).unwrap();
    assert!(!ace(&["store", "log", p(&store)], false).status.success());
}
