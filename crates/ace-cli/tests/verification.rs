use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};
fn run(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_ace"))
        .args(args)
        .output()
        .unwrap()
}
fn ok(args: &[&str]) -> Value {
    let out = run(args);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}
fn p(path: &Path) -> &str {
    path.to_str().unwrap()
}
#[test]
fn native_server_verification_reexecutes_all_candidates_and_rejects_changed_sources() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path();
    let demo = root.join("demo");
    let result = run(&["demo", p(&demo)]);
    assert!(result.status.success());
    let store = root.join("history");
    let version = ok(&["store", "save", p(&demo.join("run")), "--store", p(&store)]);
    let snapshot = root.join("snapshot");
    ok(&[
        "store",
        "checkout",
        version["version"].as_str().unwrap(),
        "--store",
        p(&store),
        "--output",
        p(&snapshot),
    ]);
    let output = root.join("check");
    let receipt = ok(&[
        "cloud",
        "verify-snapshot",
        p(&snapshot),
        "--output",
        p(&output),
    ]);
    assert_eq!(receipt["status"], "reproduced");
    assert_eq!(receipt["candidates"].as_array().unwrap().len(), 13);
    assert!(
        receipt["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["observed_outcome"] == "failed_correctness")
    );
    assert_eq!(receipt["evaluator_binary_hash"].as_str().unwrap().len(), 64);
    assert!(output.join("run/run.json").exists());
    assert!(
        !run(&[
            "cloud",
            "verify-snapshot",
            p(&snapshot),
            "--output",
            p(&output)
        ])
        .status
        .success()
    );
    let source = snapshot.join("winner.wat");
    fs::write(&source, "(module)").unwrap();
    let manifest_path = snapshot.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["files"]["winner.wat"] = json!(ace_core::ContentHash::of_bytes(b"(module)"));
    fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let bad = root.join("bad-check");
    assert!(
        !run(&[
            "cloud",
            "verify-snapshot",
            p(&snapshot),
            "--output",
            p(&bad)
        ])
        .status
        .success()
    );
    assert!(!bad.join("receipt.json").exists());
}
