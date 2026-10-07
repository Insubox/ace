use ace_core::*;
use ace_protocol::{Document, Envelope, decode};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn ace(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ace"))
        .args(args)
        .output()
        .unwrap()
}
fn success(output: Output) -> Output {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../examples/domain-kernel/{name}.json"))
}
fn text(path: &Path) -> &str {
    path.to_str().unwrap()
}
fn init(project: &Path) {
    success(ace(&[
        "init",
        text(project),
        "--id",
        "PRJ-test",
        "--name",
        "Test project",
    ]));
}

#[test]
fn initialize_validate_and_hash_without_overwriting_existing_project() {
    let temp = tempfile::tempdir().unwrap();
    init(temp.path());
    let project = temp.path().join(".ace/project.json");
    let original = fs::read(&project).unwrap();
    assert!(
        !ace(&[
            "init",
            text(temp.path()),
            "--id",
            "PRJ-new",
            "--name",
            "Replacement"
        ])
        .status
        .success()
    );
    assert_eq!(original, fs::read(&project).unwrap());
    success(ace(&["validate", text(&project)]));
    let output = success(ace(&["hash", text(&project)]));
    let expected = decode(&original).unwrap().content_hash().unwrap();
    assert_eq!(
        String::from_utf8(output.stdout).unwrap().trim(),
        expected.as_str()
    );
}

#[test]
fn evidence_can_be_sealed_recorded_idempotently_and_retrieved_but_not_replaced() {
    let temp = tempfile::tempdir().unwrap();
    init(temp.path());
    let sealed = success(ace(&["evidence", "seal", text(&fixture("evidence.seed"))]));
    let file = temp.path().join("sealed.json");
    fs::write(&file, &sealed.stdout).unwrap();
    let record_args = [
        "evidence",
        "record",
        text(&file),
        "--project",
        text(temp.path()),
    ];
    success(ace(&record_args));
    success(ace(&record_args));
    let shown = success(ace(&[
        "evidence",
        "show",
        "EV-example",
        "--project",
        text(temp.path()),
    ]));
    let original = decode(&shown.stdout).unwrap();
    assert_eq!(original, decode(&sealed.stdout).unwrap());
    let Document::Evidence(seal) = original.payload else {
        panic!("not evidence")
    };
    let mut altered = seal.evidence().clone();
    altered.created_at = Timestamp(999);
    let replacement = Envelope::new(Document::Evidence(
        SealedEvidence::new(altered).unwrap().into(),
    ));

    fs::write(&file, serde_json::to_vec(&replacement).unwrap()).unwrap();
    assert!(!ace(&record_args).status.success());
    let stored =
        decode(&fs::read(temp.path().join(".ace/evidence/EV-example.json")).unwrap()).unwrap();
    assert_eq!(stored, decode(&shown.stdout).unwrap());
    assert!(
        !ace(&[
            "evidence",
            "show",
            "../EV-example",
            "--project",
            text(temp.path())
        ])
        .status
        .success()
    );
}

#[test]
fn corrupt_evidence_and_uninitialized_projects_fail() {
    let temp = tempfile::tempdir().unwrap();
    assert!(
        !ace(&[
            "evidence",
            "record",
            text(&fixture("evidence")),
            "--project",
            text(temp.path())
        ])
        .status
        .success()
    );
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture("evidence")).unwrap()).unwrap();
    value["payload"]["data"]["evidence"]["candidate"] = json!("C-forged");
    let file = temp.path().join("corrupt.json");
    fs::write(&file, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(!ace(&["validate", text(&file)]).status.success());
    assert!(!ace(&["hash", text(&file)]).status.success());
}

#[test]
fn policy_outputs_a_valid_auditable_document_and_rejects_wrong_input_kind() {
    let output = success(ace(&["policy", text(&fixture("policy-input"))]));
    let Document::PolicyDecision(decision) = decode(&output.stdout).unwrap().payload else {
        panic!("wrong kind")
    };
    assert_eq!(decision.decision, Decision::Elite);
    assert_eq!(decision.candidate.as_str(), "C-example");
    assert!(
        !ace(&["policy", text(&fixture("candidate"))])
            .status
            .success()
    );
}

#[test]
fn schema_check_detects_modified_outputs() {
    let temp = tempfile::tempdir().unwrap();
    success(ace(&["schema", "--out", text(temp.path())]));
    success(ace(&["schema", "--out", text(temp.path()), "--check"]));
    fs::write(temp.path().join("cell.schema.json"), b"{}").unwrap();
    assert!(
        !ace(&["schema", "--out", text(temp.path()), "--check"])
            .status
            .success()
    );
}

#[test]
fn concurrent_identical_evidence_records_preserve_one_complete_observation() {
    let temp = tempfile::tempdir().unwrap();
    init(temp.path());
    let file = fixture("evidence");
    let args = [
        "evidence",
        "record",
        text(&file),
        "--project",
        text(temp.path()),
    ];
    let first = Command::new(env!("CARGO_BIN_EXE_ace"))
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let second = Command::new(env!("CARGO_BIN_EXE_ace"))
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let first = success(first.wait_with_output().unwrap());
    let second = success(second.wait_with_output().unwrap());
    assert_eq!(first.stdout, second.stdout);
    let stored = fs::read(temp.path().join(".ace/evidence/EV-example.json")).unwrap();
    assert_eq!(
        decode(&stored).unwrap(),
        decode(&fs::read(&file).unwrap()).unwrap()
    );
}

#[test]
fn sealing_rejects_duplicate_keys_in_raw_observations() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("ambiguous.json");
    let source = fs::read_to_string(fixture("evidence.seed")).unwrap();
    let ambiguous = source.replacen(
        "\"id\": \"EV-example\"",
        "\"id\": \"EV-example\", \"id\": \"EV-other\"",
        1,
    );
    assert_ne!(source, ambiguous);
    fs::write(&file, ambiguous).unwrap();
    let result = ace(&["evidence", "seal", text(&file)]);
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("duplicate JSON key"));
}
