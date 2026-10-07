//! Freeze source only when it assembles to the exact artifact actually evaluated.
use crate::{Result, create_atomic, json};
use ace_core::*;
use ace_runner::RunReport;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Source {
    pub candidate: CandidateId,
    pub source_hash: ContentHash,
    pub artifact_hash: ContentHash,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Sources {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub report_hash: ContentHash,
    pub sources: Vec<Source>,
    pub metadata: std::collections::BTreeMap<String, ContentHash>,
}

pub(crate) fn freeze(input: &Path, run: &Path, report: &RunReport) -> Result<Sources> {
    let reader = ace_runner::files::ReadDirectory::open(input)?;
    let mut sources = Vec::new();
    let mut files = Vec::new();
    for result in &report.results {
        crate::mcp::portable_name(result.candidate.id.as_str())?;
        let name = format!("sources/{}.wat", result.candidate.id);
        let path = input.join(&name);
        if !path.try_exists()? {
            continue; // Legacy precompiled-only experiments have no source claim.
        }
        let bytes = reader.read(Path::new(&name), 32768)?;
        if ContentHash::of_bytes(&wat::parse_bytes(&bytes)?) != result.candidate.patch.hash {
            return Err("source does not assemble to the evaluated artifact".into());
        }
        sources.push(Source {
            candidate: result.candidate.id.clone(),
            source_hash: ContentHash::of_bytes(&bytes),
            artifact_hash: result.candidate.patch.hash.clone(),
        });
        files.push((name, bytes));
    }
    let mut metadata = std::collections::BTreeMap::new();
    for (input_name, saved_name) in [
        ("registration.json", "proposal-registration.json"),
        ("proposals.json", "proposal-batch.json"),
        ("generation.json", "generation.json"),
        ("agent-task.json", "agent-task.json"),
        ("agent-submission.json", "agent-submission.json"),
    ] {
        let path = input.join(input_name);
        if path.try_exists()? {
            let bytes = reader.read(Path::new(input_name), 3_145_728)?;
            ace_protocol::parse_json(&bytes)?;
            metadata.insert(saved_name.to_owned(), ContentHash::of_bytes(&bytes));
            files.push((saved_name.to_owned(), bytes));
        }
    }
    let record = Sources {
        schema_version: ace_protocol::ProtocolVersion,
        report_hash: ContentHash::of_json(report)?,
        sources,
        metadata,
    };
    for (name, bytes) in files {
        create_atomic(&run.join(name), &bytes)?;
    }
    create_atomic(&run.join("sources.json"), &json(&record)?)?;
    verify(run, report)
}

pub(crate) fn verify(run: &Path, report: &RunReport) -> Result<Sources> {
    let reader = ace_runner::files::ReadDirectory::open(run)?;
    let record: Sources = serde_json::from_value(ace_protocol::parse_json(
        &reader.read(Path::new("sources.json"), 131072)?,
    )?)?;
    if record.report_hash != ContentHash::of_json(report)? {
        return Err("sources belong to another run report".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for (name, hash) in &record.metadata {
        if ![
            "proposal-registration.json",
            "proposal-batch.json",
            "generation.json",
            "agent-task.json",
            "agent-submission.json",
        ]
        .contains(&name.as_str())
        {
            return Err("unexpected source metadata file".into());
        }
        if ContentHash::of_bytes(&reader.read(Path::new(name), 3_145_728)?) != *hash {
            return Err("frozen source metadata changed".into());
        }
    }
    for source in &record.sources {
        crate::mcp::portable_name(source.candidate.as_str())?;
        let result = report
            .results
            .iter()
            .find(|r| r.candidate.id == source.candidate)
            .ok_or("source candidate absent from run")?;
        let bytes = reader.read(
            Path::new(&format!("sources/{}.wat", source.candidate)),
            32768,
        )?;
        if !ids.insert(source.candidate.clone())
            || source.source_hash != ContentHash::of_bytes(&bytes)
            || source.artifact_hash != result.candidate.patch.hash
            || ContentHash::of_bytes(&wat::parse_bytes(&bytes)?) != source.artifact_hash
        {
            return Err("frozen source differs from evaluated artifact".into());
        }
    }
    Ok(record)
}
