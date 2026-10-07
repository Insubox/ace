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

#[test]
fn native_branches_merge_and_fetch_preserve_dag_source_and_compare_and_swap() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    let files = r.join("files.json");
    write(&files, &json!(["code.txt"]));
    let store = r.join("history");
    let commit = |store: &Path, text: &[u8], message: &str, parent: Option<&str>| {
        fs::write(source.join("code.txt"), text).unwrap();
        let mut args = vec![
            "store",
            "commit",
            p(&source),
            "--store",
            p(store),
            "--files",
            p(&files),
            "--message",
            message,
        ];
        if let Some(parent) = parent {
            args.extend(["--parent", parent]);
        }
        ok(&args)["version"].as_str().unwrap().to_owned()
    };
    let base = commit(&store, b"one\r\ntwo\r\nthree\r\n", "base", None);
    ok(&["store", "branch", p(&store), "main", &base]);
    let theirs_store = r.join("other");
    ok(&["store", "clone", p(&store), p(&theirs_store)]);
    let ours = commit(&store, b"ONE\r\ntwo\r\nthree\r\n", "ours", Some(&base));
    let theirs = commit(
        &theirs_store,
        b"one\r\ntwo\r\nTHREE\r\n",
        "theirs",
        Some(&base),
    );
    ok(&[
        "store",
        "branch",
        p(&store),
        "main",
        &ours,
        "--expect",
        &base,
    ]);
    assert!(
        !ace(
            &[
                "store",
                "branch",
                p(&store),
                "main",
                &base,
                "--expect",
                &ours
            ],
            false
        )
        .status
        .success()
    );
    let imported = ok(&["store", "fetch", p(&theirs_store), p(&store)]);
    assert_eq!(imported["imported"], 1);
    assert_eq!(imported["incoming_refs"]["main"], base);
    assert_eq!(
        ok(&["store", "fetch", p(&theirs_store), p(&store)])["imported"],
        0
    );
    let difference = ok(&["store", "diff", &ours, &theirs, "--store", p(&store)]);
    assert_eq!(difference["changes"][0]["path"], "code.txt");
    assert_eq!(
        difference["changes"][0]["text_edits"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let output = r.join("merged");
    let merged = ok(&[
        "store",
        "merge",
        &ours,
        &theirs,
        "--store",
        p(&store),
        "--output",
        p(&output),
        "--message",
        "merge both",
    ]);
    assert_eq!(merged["status"], "merged");
    assert_eq!(
        fs::read(output.join("merged/code.txt")).unwrap(),
        b"ONE\r\ntwo\r\nTHREE\r\n"
    );
    let id = merged["version"].as_str().unwrap();
    let version: Value =
        serde_json::from_slice(&fs::read(store.join(format!("versions/{id}.json"))).unwrap())
            .unwrap();
    assert_eq!(version["version"]["parents"].as_array().unwrap().len(), 2);
    assert_eq!(version["version"]["kind"]["kind"], "source");
    ok(&["store", "branch", p(&store), "main", id, "--expect", &ours]);
    assert!(
        !ace(
            &["store", "branch", p(&store), "main", id, "--expect", &ours],
            false
        )
        .status
        .success()
    );
    let cloned = r.join("cloned");
    ok(&["store", "clone", p(&store), p(&cloned)]);
    assert_eq!(ok(&["store", "refs", p(&cloned)])["heads"]["main"], id);
    let event = store.join("refs/00000002.json");
    let mut changed: Value = serde_json::from_slice(&fs::read(&event).unwrap()).unwrap();
    changed["target"] = json!(theirs);
    write(&event, &changed);
    assert!(!ace(&["store", "log", p(&store)], false).status.success());
}
#[test]
fn merge_conflicts_preserve_both_sources_without_publishing_a_version() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    let files = r.join("files.json");
    write(&files, &json!(["code.txt"]));
    let store = r.join("history");
    fs::write(source.join("code.txt"), "base\n").unwrap();
    let base = ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "base",
    ])["version"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::write(source.join("code.txt"), "left\n").unwrap();
    let ours = ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "left",
        "--parent",
        &base,
    ])["version"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::write(source.join("code.txt"), "right\n").unwrap();
    let theirs = ok(&[
        "store",
        "commit",
        p(&source),
        "--store",
        p(&store),
        "--files",
        p(&files),
        "--message",
        "right",
        "--parent",
        &base,
    ])["version"]
        .as_str()
        .unwrap()
        .to_owned();
    let output = r.join("conflict");
    let report = ok(&[
        "store",
        "merge",
        &ours,
        &theirs,
        "--store",
        p(&store),
        "--output",
        p(&output),
        "--message",
        "pending merge",
    ]);
    assert_eq!(report["status"], "conflicted");
    assert!(report["version"].is_null());
    assert_eq!(report["conflicts"].as_array().unwrap().len(), 1);
    assert_eq!(
        fs::read(output.join("conflicts/0000/base")).unwrap(),
        b"base\n"
    );
    assert_eq!(
        fs::read(output.join("conflicts/0000/ours")).unwrap(),
        b"left\n"
    );
    assert_eq!(
        fs::read(output.join("conflicts/0000/theirs")).unwrap(),
        b"right\n"
    );
    assert_eq!(
        ok(&["store", "log", p(&store)])["versions"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn ambiguous_merge_bases_and_structural_aliases_require_explicit_resolution() {
    let temp = tempfile::tempdir().unwrap();
    let r = temp.path();
    let source = r.join("source");
    fs::create_dir(&source).unwrap();
    let files = r.join("files.json");
    write(&files, &json!(["code.txt"]));
    let store = r.join("history");
    let commit = |text: &str, parents: &[&str]| {
        fs::write(source.join("code.txt"), text).unwrap();
        let mut args = vec![
            "store",
            "commit",
            p(&source),
            "--store",
            p(&store),
            "--files",
            p(&files),
            "--message",
            text,
        ];
        for parent in parents {
            args.extend(["--parent", *parent]);
        }
        ok(&args)["version"].as_str().unwrap().to_owned()
    };
    let base = commit("base", &[]);
    let a = commit("A", &[&base]);
    let b = commit("B", &[&base]);
    let c = commit("C", &[&a, &b]);
    let d = commit("D", &[&a, &b]);
    let output = r.join("ambiguous");
    let failed = ace(
        &[
            "store",
            "merge",
            &c,
            &d,
            "--store",
            p(&store),
            "--output",
            p(&output),
            "--message",
            "ambiguous",
        ],
        false,
    );
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("unambiguous"));
    assert!(!output.exists());
    let explicit = ok(&[
        "store",
        "merge",
        &c,
        &d,
        "--base",
        &a,
        "--store",
        p(&store),
        "--output",
        p(&output),
        "--message",
        "explicit base",
    ]);
    assert_eq!(explicit["base"], a);
    assert_eq!(explicit["status"], "conflicted");
    let left_source = r.join("left-source");
    let right_source = r.join("right-source");
    fs::create_dir(&left_source).unwrap();
    fs::create_dir(&right_source).unwrap();
    for path in [&left_source, &right_source] {
        fs::write(path.join("code.txt"), "base").unwrap();
    }
    fs::write(left_source.join("Readme.md"), "left").unwrap();
    fs::write(right_source.join("readme.md"), "right").unwrap();
    let left_files = r.join("left.json");
    let right_files = r.join("right.json");
    write(&left_files, &json!(["code.txt", "Readme.md"]));
    write(&right_files, &json!(["code.txt", "readme.md"]));
    let left = ok(&[
        "store",
        "commit",
        p(&left_source),
        "--store",
        p(&store),
        "--files",
        p(&left_files),
        "--message",
        "left alias",
        "--parent",
        &base,
    ])["version"]
        .as_str()
        .unwrap()
        .to_owned();
    let right = ok(&[
        "store",
        "commit",
        p(&right_source),
        "--store",
        p(&store),
        "--files",
        p(&right_files),
        "--message",
        "right alias",
        "--parent",
        &base,
    ])["version"]
        .as_str()
        .unwrap()
        .to_owned();
    let preview = r.join("structural");
    let report = ok(&[
        "store",
        "merge",
        &left,
        &right,
        "--store",
        p(&store),
        "--output",
        p(&preview),
        "--message",
        "path conflict",
    ]);
    assert_eq!(report["status"], "conflicted");
    assert!(report["version"].is_null());
    assert!(report["structural_conflict"].is_string());
    assert_eq!(
        fs::read(preview.join("inputs/ours/Readme.md")).unwrap(),
        b"left"
    );
    assert_eq!(
        fs::read(preview.join("inputs/theirs/readme.md")).unwrap(),
        b"right"
    );
}
