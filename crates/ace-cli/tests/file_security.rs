//! Exercise the command boundaries reported by SAST, including inputs whose
//! bytes and seals are valid but whose filesystem objects are not authorized.
#![cfg(unix)]
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

fn ace(arguments: &[&str]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_ace"))
        .args(arguments)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let start = Instant::now();
    loop {
        if child.try_wait().unwrap().is_some() {
            return child.wait_with_output().unwrap();
        }
        if start.elapsed() > Duration::from_secs(10) {
            child.kill().unwrap();
            let output = child.wait_with_output().unwrap();
            panic!(
                "command blocked: {arguments:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn p(path: &Path) -> &str {
    path.to_str().unwrap()
}
fn ok(arguments: &[&str]) -> Value {
    let output = ace(arguments);
    assert!(
        output.status.success(),
        "{arguments:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn proposal_run_and_frozen_source_reject_external_links_with_identical_bytes() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let proposal = root.path().join("proposals.json");
    fs::write(&proposal, serde_json::to_vec(&json!({"schema_version":1,"cell":"Gcd","candidates":[
        {"id":"C-fast","wat":"(module (func $g (export \"gcd\") (param $a i32) (param $b i32) (result i32) local.get $b i32.eqz (if (result i32) (then local.get $a) (else local.get $b local.get $a local.get $b i32.rem_u call $g))))", "strategy":"euclid","generator":{"provider":"manual","model":"security-test"}}
    ]})).unwrap()).unwrap();
    let input = root.path().join("input");
    ok(&["propose", p(&proposal), "--output", p(&input)]);
    let run = root.path().join("run");
    ok(&["run", p(&input), "--output", p(&run)]);
    let config: Value =
        serde_json::from_slice(&fs::read(input.join("experiment.json")).unwrap()).unwrap();
    let mut cases = vec![
        (
            input.join("registration.json"),
            vec!["proposal-status", p(&input)],
        ),
        (
            input.join("proposals.json"),
            vec!["proposal-status", p(&input)],
        ),
        (
            input.join("experiment.json"),
            vec!["proposal-status", p(&input)],
        ),
        (
            input.join(config["candidates"][0]["module"].as_str().unwrap()),
            vec!["proposal-status", p(&input)],
        ),
        (
            input.join("sources/C-fast.wat"),
            vec!["proposal-status", p(&input)],
        ),
        (run.join("run.json"), vec!["status", p(&run)]),
        (
            run.join("candidates/C-fast/evaluation.json"),
            vec!["status", p(&run)],
        ),
    ];
    let store = root.path().join("store");
    cases.push((
        run.join("sources/C-fast.wat"),
        vec!["store", "save", p(&run), "--store", p(&store)],
    ));
    for (index, (file, command)) in cases.into_iter().enumerate() {
        let bytes = fs::read(&file).unwrap();
        let target = outside.path().join(format!("valid-{index}"));
        fs::write(&target, &bytes).unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&target, &file).unwrap();
        let output = ace(&command);
        assert!(
            !output.status.success(),
            "external link accepted by {command:?}"
        );
        fs::remove_file(&file).unwrap();
        fs::write(file, bytes).unwrap();
    }
    ok(&["proposal-status", p(&input)]);
    ok(&["status", p(&run)]);
    assert!(!store.exists());
}

#[test]
fn cli_documents_and_wat_reject_fifos_without_a_writer() {
    let root = tempfile::tempdir().unwrap();
    let fifo = root.path().join("fifo");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    let destination = root.path().join("output");
    for command in [
        vec!["judge", "compare", p(&fifo)],
        vec!["propose", p(&fifo), "--output", p(&destination)],
    ] {
        let output = ace(&command);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("regular file"));
    }
    assert!(!destination.exists());
    for (file, command) in [
        ("registration.json", vec!["proposal-status", p(root.path())]),
        ("run.json", vec!["status", p(root.path())]),
        ("evolution.json", vec!["history", p(root.path())]),
        (
            "experiment.json",
            vec!["run", p(root.path()), "--output", p(&destination)],
        ),
    ] {
        let path = root.path().join(file);
        assert!(
            Command::new("mkfifo")
                .arg(&path)
                .status()
                .unwrap()
                .success()
        );
        let output = ace(&command);
        assert!(!output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("regular file"),
            "{command:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        fs::remove_file(path).unwrap();
    }
}

#[test]
fn generated_sources_and_modules_reject_links_and_special_files() {
    let root = tempfile::tempdir().unwrap();
    let campaign = root.path().join("campaign");
    ok(&[
        "evolve",
        p(&campaign),
        "--candidates",
        "4",
        "--generations",
        "1",
        "--jobs",
        "1",
        "--json",
    ]);
    let input = campaign.join("generation-001");
    let generation: Value =
        serde_json::from_slice(&fs::read(input.join("generation.json")).unwrap()).unwrap();
    let candidate = generation["artifacts"][0]["candidate"].as_str().unwrap();
    for file in [
        input.join(format!("sources/{candidate}.wat")),
        input.join(format!("artifacts/{candidate}.wasm")),
    ] {
        let bytes = fs::read(&file).unwrap();
        let outside = root.path().join("external");
        fs::write(&outside, &bytes).unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&outside, &file).unwrap();
        assert!(!ace(&["history", p(&campaign)]).status.success());
        fs::remove_file(&file).unwrap();
        assert!(
            Command::new("mkfifo")
                .arg(&file)
                .status()
                .unwrap()
                .success()
        );
        let output = ace(&["history", p(&campaign)]);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("regular file"));
        fs::remove_file(&file).unwrap();
        fs::write(file, bytes).unwrap();
    }
    ok(&["history", p(&campaign)]);
}
