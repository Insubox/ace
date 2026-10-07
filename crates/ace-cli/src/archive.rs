//! Explicit local Git storage for evaluated winners and evidence-backed learning.
//! Uses a dedicated repository only; never stages a developer's application tree.
use crate::{Result, create_atomic, json, source};
use ace_core::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json as value};
use std::{collections::BTreeMap, fs, path::Path, process::Command};

const MARKER: &[u8] = b"{\"ace_git_archive\":1}\n";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Snapshot {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub experiment: ExperimentId,
    pub report_hash: ContentHash,
    pub champion: Option<CandidateId>,
    pub knowledge: KnowledgeId,
    pub files: BTreeMap<String, ContentHash>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FaultRecord {
    schema_version: ace_protocol::ProtocolVersion,
    pub(crate) task: crate::agent::Task,
    pub(crate) fault: crate::agent::Fault,
    pub(crate) submission: Option<crate::agent::Submission>,
    pub(crate) content_hash: ContentHash,
}
pub(crate) fn verify_fault(path: &Path) -> Result<FaultRecord> {
    let record: FaultRecord = serde_json::from_value(ace_protocol::parse_json(
        &crate::bounded_bytes(path, 262144)?,
    )?)?;
    record.fault.validate()?;
    if record.content_hash
        != ContentHash::of_json(&(&record.task, &record.fault, &record.submission))?
        || record.task.context_hash != ContentHash::of_json(&record.task.context)?
        || record.fault.context_hash != record.task.context_hash
        || record
            .submission
            .as_ref()
            .is_some_and(|s| s.context_hash != record.task.context_hash)
    {
        return Err("archived generator fault identity changed".into());
    }
    Ok(record)
}

pub(crate) fn fault_record(
    task: &crate::agent::Task,
    fault: &crate::agent::Fault,
    submission: Option<&crate::agent::Submission>,
) -> Result<FaultRecord> {
    fault.validate()?;
    let content_hash = ContentHash::of_json(&(task, fault, submission))?;
    let record = FaultRecord {
        schema_version: ace_protocol::ProtocolVersion,
        task: task.clone(),
        fault: fault.clone(),
        submission: submission.cloned(),
        content_hash,
    };
    Ok(record)
}

pub(crate) fn save_fault(
    destination: &Path,
    task: &crate::agent::Task,
    fault: &crate::agent::Fault,
    submission: Option<&crate::agent::Submission>,
) -> Result<String> {
    let root = repository(destination, false)?;
    let record = fault_record(task, fault, submission)?;
    let name = format!("agent-faults/{}/event.json", task.context_hash.as_str());
    let parent = root.join("agent-faults");
    fs::create_dir_all(&parent)?;
    if !parent.canonicalize()?.starts_with(&root) {
        return Err("generator fault path escapes archive".into());
    }
    let path = root.join(&name);
    let event_parent = path.parent().ok_or("missing fault directory")?;
    if event_parent.symlink_metadata().is_ok() && !event_parent.canonicalize()?.starts_with(&root) {
        return Err("generator fault path escapes archive".into());
    }
    if path.try_exists()? {
        if !path.canonicalize()?.starts_with(&root) || verify_fault(&path)? != record {
            return Err("generator fault already archived with different content".into());
        }
    } else {
        let lock = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(".git/ace-archive.lock"))?;
        let result = (|| -> Result<()> {
            create_atomic(&path, &json(&record)?)?;
            verify_fault(&path)?;
            git(&root, &["add", "--", &name])?;
            git(
                &root,
                &[
                    "commit",
                    "--no-verify",
                    "-m",
                    "ACE: retain generator fault; no candidate correctness conclusion",
                ],
            )?;
            Ok(())
        })();
        drop(lock);
        fs::remove_file(root.join(".git/ace-archive.lock"))?;
        result?;
    }
    git(&root, &["log", "-1", "--format=%H", "--", &name])
}

fn git(repository: &Path, arguments: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    // Prevent inherited Git routing, alternate indexes, config injections and hooks.
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", ".git/ace-empty-config")
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(repository)
        .args(["-c", "core.hooksPath=.git/ace-empty-hooks"])
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "user.name=ACE",
            "-c",
            "user.email=ace@localhost",
        ])
        .args(arguments);
    let output = command
        .output()
        .map_err(|e| format!("Git is required for archive operations: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git archive failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

fn repository(path: &Path, create: bool) -> Result<std::path::PathBuf> {
    if !path.try_exists()? {
        if !create {
            return Err("archive repository does not exist".into());
        }
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        fs::create_dir(path)?;
        let root = path.canonicalize()?;
        git(
            &root,
            &["init", "--initial-branch=ace-history", "--template="],
        )?;
        fs::create_dir(root.join(".git/ace-empty-hooks"))?;
        create_atomic(&root.join(".git/ace-empty-config"), b"")?;
        create_atomic(&root.join(".ace-archive.json"), MARKER)?;
        // Seals are byte identities: clones must not rewrite line endings.
        create_atomic(&root.join(".gitattributes"), b"* -text\n")?;
        return Ok(root);
    }
    if path.symlink_metadata()?.file_type().is_symlink() {
        return Err("archive repository must not be a symlink".into());
    }
    let root = path.canonicalize()?;
    if !root.join(".git").is_dir()
        || root
            .join(".git")
            .symlink_metadata()?
            .file_type()
            .is_symlink()
        || crate::bounded_bytes(&root.join(".ace-archive.json"), 1024)? != MARKER
        || Path::new(&git(&root, &["rev-parse", "--show-toplevel"])?).canonicalize()? != root
    {
        return Err("use a dedicated ACE archive repository".into());
    }
    if !git(&root, &["status", "--porcelain", "--untracked-files=all"])?.is_empty() {
        return Err(
            "archive repository has pending changes; preserve or resolve them first".into(),
        );
    }
    Ok(root)
}

fn insert(files: &mut BTreeMap<String, Vec<u8>>, run: &Path, name: &str) -> Result<()> {
    let root = run.canonicalize()?;
    let path = run.join(name).canonicalize()?;
    if !path.starts_with(&root) {
        return Err("archive input escapes run directory".into());
    }
    files.insert(
        format!("run/{name}"),
        crate::bounded_bytes(&path, 8_388_608)?,
    );
    Ok(())
}

pub(crate) fn snapshot_files(run: &Path) -> Result<(Snapshot, BTreeMap<String, Vec<u8>>)> {
    let report = ace_runner::load_report(run)?;
    let sources = source::verify(run, &report)?;
    let mut files = BTreeMap::new();
    for name in [
        "run.json",
        "environment.json",
        "intent.json",
        "experiment.json",
        "knowledge.json",
        "sources.json",
    ] {
        insert(&mut files, run, name)?;
    }
    if report.baseline_champion.is_some() {
        insert(&mut files, run, "baseline-champion.json")?;
    }
    for result in &report.results {
        crate::mcp::portable_name(result.candidate.id.as_str())?;
        for name in ["candidate", "evaluation", "evidence", "decision"] {
            insert(
                &mut files,
                run,
                &format!("candidates/{}/{name}.json", result.candidate.id),
            )?;
        }
        insert(
            &mut files,
            run,
            &format!("artifacts/{}.wasm", result.candidate.patch.hash.as_str()),
        )?;
    }
    for source in &sources.sources {
        insert(
            &mut files,
            run,
            &format!("sources/{}.wat", source.candidate),
        )?;
    }
    for name in sources.metadata.keys() {
        insert(&mut files, run, name)?;
    }
    if let Some(champion) = &report.champion {
        if !sources
            .sources
            .iter()
            .any(|s| s.candidate == champion.candidate)
        {
            return Err(
                "qualified Champion source is missing; archive requires verified winner source"
                    .into(),
            );
        }
        insert(&mut files, run, "champion.json")?;
        insert(&mut files, run, "champion.wasm")?;
        files.insert(
            "winner.wat".into(),
            files[&format!("run/sources/{}.wat", champion.candidate)].clone(),
        );
        files.insert("winner.wasm".into(), files["run/champion.wasm"].clone());
    }
    // Keep unsuccessful and successful observations, not only the current winner.
    files.insert("learning.json".into(), json(&value!({
        "scope":format!("Only this evaluated {} workload and recorded environment; no general proof or prediction",report.config.harness.oracle.display()),
        "knowledge":report.knowledge,
        "outcomes":report.results,
        "champion":report.champion.as_ref().map(|c| &c.candidate),
    }))?);
    if run.join("knowledge-linked.json").try_exists()? {
        insert(&mut files, run, "knowledge-linked.json")?;
    }
    let snapshot = Snapshot {
        schema_version: ace_protocol::ProtocolVersion,
        experiment: report.experiment.id.clone(),
        report_hash: ContentHash::of_json(&report)?,
        champion: report.champion.as_ref().map(|c| c.candidate.clone()),
        knowledge: report.knowledge.id.clone(),
        files: files
            .iter()
            .map(|(n, b)| (n.clone(), ContentHash::of_bytes(b)))
            .collect(),
    };
    Ok((snapshot, files))
}

pub(crate) fn save(run: &Path, destination: &Path) -> Result<Value> {
    let report = ace_runner::load_report(run)?;
    let (snapshot, files) = snapshot_files(run)?;
    let name = format!("runs/{}", snapshot.report_hash.as_str());
    let root = repository(destination, true)?;
    fs::create_dir_all(root.join("runs"))?;
    if !root.join("runs").canonicalize()?.starts_with(&root) {
        return Err("archive snapshot directory escapes repository".into());
    }
    let output = root.join(&name);
    if output.try_exists()? {
        if !output.canonicalize()?.starts_with(&root) {
            return Err("archive snapshot escapes repository".into());
        }
        verify_snapshot(&output)?;
        let old: Snapshot = serde_json::from_value(ace_protocol::parse_json(
            &ace_runner::files::read_beneath(&output, Path::new("manifest.json"), 262144)?,
        )?)?;
        if old != snapshot {
            return Err("experiment already archived with different content".into());
        }
    } else {
        // Serialize independent processes without modifying an existing snapshot.
        let lock = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(".git/ace-archive.lock"))?;
        let result = (|| -> Result<()> {
            for (file, bytes) in files {
                create_atomic(&output.join(file), &bytes)?;
            }
            create_atomic(&output.join("manifest.json"), &json(&snapshot)?)?;
            verify_snapshot(&output)?;
            git(
                &root,
                &["add", "--", ".ace-archive.json", ".gitattributes", &name],
            )?;
            git(
                &root,
                &[
                    "commit",
                    "--no-verify",
                    "-m",
                    &format!(
                        "ACE {}: winner and learning for {} evaluated versions",
                        report.experiment.id,
                        report.results.len()
                    ),
                ],
            )?;
            Ok(())
        })();
        drop(lock);
        fs::remove_file(root.join(".git/ace-archive.lock"))?;
        result?;
    }
    let commit = git(
        &root,
        &[
            "log",
            "-1",
            "--format=%H",
            "--",
            &format!("{name}/manifest.json"),
        ],
    )?;
    if commit.is_empty() {
        return Err("snapshot has no Git commit".into());
    }
    Ok(value!({"repository":root,"commit":commit,"snapshot":snapshot,"remote_push":false}))
}

pub(crate) fn verify_snapshot(root: &Path) -> Result<Snapshot> {
    let snapshot: Snapshot = serde_json::from_value(ace_protocol::parse_json(
        &crate::bounded_bytes(&root.join("manifest.json"), 262144)?,
    )?)?;
    let canonical = root.canonicalize()?;
    for (name, hash) in &snapshot.files {
        let path = root.join(name).canonicalize()?;
        if !path.starts_with(&canonical)
            || ContentHash::of_bytes(&crate::bounded_bytes(&path, 8_388_608)?) != *hash
        {
            return Err("archived file hash differs from manifest".into());
        }
    }
    let report = ace_runner::load_report(&root.join("run"))?;
    let sources = source::verify(&root.join("run"), &report)?;
    let expected_learning = json(&value!({
        "scope":format!("Only this evaluated {} workload and recorded environment; no general proof or prediction",report.config.harness.oracle.display()),
        "knowledge":report.knowledge,
        "outcomes":report.results,
        "champion":report.champion.as_ref().map(|c| &c.candidate),
    }))?;
    if crate::bounded_bytes(&root.join("learning.json"), 8_388_608)? != expected_learning {
        return Err("archived learning differs from evaluated outcomes".into());
    }
    if let Some(champion) = &report.champion
        && (!sources
            .sources
            .iter()
            .any(|s| s.candidate == champion.candidate)
            || crate::bounded_bytes(&root.join("winner.wat"), 32768)?
                != crate::bounded_bytes(
                    &root.join(format!("run/sources/{}.wat", champion.candidate)),
                    32768,
                )?
            || ContentHash::of_bytes(&crate::bounded_bytes(&root.join("winner.wasm"), 1_048_576)?)
                != champion.artifact.hash)
    {
        return Err("archived winner differs from evaluated Champion".into());
    }
    if snapshot.report_hash != ContentHash::of_json(&report)?
        || snapshot.experiment != report.experiment.id
        || snapshot.knowledge != report.knowledge.id
        || snapshot.champion != report.champion.as_ref().map(|c| c.candidate.clone())
    {
        return Err("archived identity differs from evaluated run".into());
    }
    Ok(snapshot)
}

pub(crate) fn status(destination: &Path) -> Result<Value> {
    let root = repository(destination, false)?;
    if !root.join("runs").canonicalize()?.starts_with(&root) {
        return Err("archive snapshot directory escapes repository".into());
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(root.join("runs"))? {
        if snapshots.len() >= 256 {
            return Err("archive scan exceeds 256 snapshots; select a smaller archive".into());
        }
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            return Err("unexpected archive entry".into());
        }
        let snapshot = verify_snapshot(&entry.path())?;
        let name = format!("runs/{}/manifest.json", snapshot.report_hash.as_str());
        let commit = git(&root, &["log", "-1", "--format=%H", "--", &name])?;
        if commit.is_empty() {
            return Err("archive snapshot is not committed".into());
        }
        snapshots.push(value!({"snapshot":snapshot,"commit":commit}));
    }
    snapshots.sort_by_key(|s| s["snapshot"]["experiment"].as_str().unwrap().to_owned());
    let mut faults = Vec::new();
    if root.join("agent-faults").try_exists()? {
        let parent = root.join("agent-faults").canonicalize()?;
        if !parent.starts_with(&root) {
            return Err("generator fault path escapes archive".into());
        }
        for entry in fs::read_dir(parent)? {
            if faults.len() >= 256 {
                return Err("generator fault scan exceeds 256 events".into());
            }
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                return Err("unexpected generator fault entry".into());
            }
            let event = entry.path().join("event.json");
            if !event.canonicalize()?.starts_with(&root) {
                return Err("generator fault event escapes archive".into());
            }
            let record = verify_fault(&event)?;
            let name = format!(
                "agent-faults/{}/event.json",
                record.task.context_hash.as_str()
            );
            let commit = git(&root, &["log", "-1", "--format=%H", "--", &name])?;
            if commit.is_empty() {
                return Err("generator fault was not committed".into());
            }
            faults.push(value!({"context_hash":record.task.context_hash,"fault":record.fault.fault,"commit":commit,
                "candidate_evaluation_performed":false}));
        }
    }
    faults.sort_by_key(|f| f["context_hash"].as_str().unwrap().to_owned());
    Ok(
        value!({"repository":root,"snapshots":snapshots,"generator_faults":faults,"verified":true,"remote_push":false}),
    )
}
