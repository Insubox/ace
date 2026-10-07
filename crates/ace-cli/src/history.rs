//! ACE owns version history; Git is an explicit compatibility backend.
use crate::{Result, agent, archive, store};
use ace_core::ContentHash;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(crate) fn save(run: &Path, destination: &Path) -> Result<Value> {
    if store::is_native(destination) {
        store::save(run, destination)
    } else {
        archive::save(run, destination)
    }
}
pub(crate) fn status(destination: &Path) -> Result<Value> {
    if store::is_native(destination) {
        store::status(destination)
    } else {
        archive::status(destination)
    }
}
pub(crate) fn save_fault(
    destination: &Path,
    task: &agent::Task,
    fault: &agent::Fault,
    submission: Option<&agent::Submission>,
) -> Result<String> {
    if store::is_native(destination) {
        store::save_fault(destination, task, fault, submission)
    } else {
        archive::save_fault(destination, task, fault, submission)
    }
}
pub(crate) fn archived_run(destination: &Path, report: &ContentHash) -> Result<PathBuf> {
    if store::is_native(destination) {
        return store::archived_run(destination, report);
    }
    let root = destination.canonicalize()?;
    let snapshot = root.join("runs").join(report.as_str());
    if !snapshot.canonicalize()?.starts_with(&root)
        || archive::verify_snapshot(&snapshot)?.report_hash != *report
    {
        return Err("memory source differs from requested archive report".into());
    }
    Ok(snapshot.join("run"))
}
