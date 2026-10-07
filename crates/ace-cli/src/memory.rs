//! Bounded evidence retrieval. Never send hidden Oracle cases or raw failure
//! messages to a generator, and never compare winners across evaluation profiles.
use crate::{Result, bounded_bytes, history, source};
use ace_core::*;
use ace_runner::{CandidateOutcome, RunReport};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Winner {
    pub experiment: ExperimentId,
    pub candidate: CandidateId,
    pub report_hash: ContentHash,
    pub artifact_hash: ContentHash,
    pub source_hash: ContentHash,
    pub wat: String,
    /// Decimal text avoids cross-client floating-point formatting differences.
    pub mean_fuel: String,
    pub strategy: Text,
    pub evidence: EvidenceId,
    pub evidence_hash: ContentHash,
    pub commit: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Observation {
    pub experiment: ExperimentId,
    pub candidate: CandidateId,
    pub artifact_hash: ContentHash,
    pub strategy: Text,
    pub outcome: CandidateOutcome,
    pub decision: Decision,
    pub mean_fuel: Option<String>,
    pub checked_calls: u64,
    pub evidence: EvidenceId,
    pub evidence_hash: ContentHash,
    pub knowledge: KnowledgeId,
    pub is_champion: bool,
    pub scope: String,
    pub commit: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Memory {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub project: ProjectId,
    pub cell: CellId,
    pub intent: IntentId,
    pub environment_hash: ContentHash,
    pub evalspec_hash: ContentHash,
    pub compatible_runs: usize,
    pub excluded_runs: usize,
    pub winner: Winner,
    pub observations: Vec<Observation>,
    pub seen_artifacts: BTreeSet<ContentHash>,
    pub truncated: bool,
}

pub(crate) fn archived_run(repository: &Path, hash: &ContentHash) -> Result<PathBuf> {
    history::archived_run(repository, hash)
}

pub(crate) fn query(repository: &Path, baseline: &RunReport, limit: usize) -> Result<Memory> {
    if !(1..=64).contains(&limit) {
        return Err("memory observation limit must be between 1 and 64".into());
    }
    let status = history::status(repository)?;
    let mut memory = None;
    let mut observations = Vec::new();
    let mut seen_artifacts = BTreeSet::new();
    let mut compatible_runs = 0;
    let mut excluded_runs = 0;
    let mut best_fuel = f64::INFINITY;
    let evalspec_hash = ContentHash::of_json(&baseline.intent.evalspec)?;
    for item in status["snapshots"]
        .as_array()
        .ok_or("missing archive snapshots")?
    {
        let hash: ContentHash = serde_json::from_value(item["snapshot"]["report_hash"].clone())?;
        let run = archived_run(repository, &hash)?;
        let report = ace_runner::load_report(&run)?;
        if report.config.project != baseline.config.project
            || report.config.cell != baseline.config.cell
            || report.config.intent != baseline.config.intent
            || report.environment_hash != baseline.environment_hash
            || ContentHash::of_json(&report.intent.evalspec)? != evalspec_hash
        {
            excluded_runs += 1;
            continue;
        }
        compatible_runs += 1;
        let commit = item["commit"]
            .as_str()
            .ok_or("missing archive commit")?
            .to_owned();
        let sources = source::verify(&run, &report)?;
        for result in &report.results {
            let spec = std::iter::once(&report.config.baseline)
                .chain(&report.config.candidates)
                .find(|s| s.id == result.candidate.id)
                .ok_or("missing candidate strategy")?;
            seen_artifacts.insert(result.candidate.patch.hash.clone());
            let is_champion = report
                .champion
                .as_ref()
                .is_some_and(|c| c.candidate == result.candidate.id);
            observations.push(Observation {
                experiment: report.experiment.id.clone(), candidate: result.candidate.id.clone(),
                artifact_hash: result.candidate.patch.hash.clone(), strategy: spec.strategy.clone(),
                outcome: result.evaluation.outcome, decision: result.decision.decision.clone(),
                mean_fuel: result.evaluation.mean_fuel.map(|v| v.get().to_string()),
                checked_calls: result.evaluation.checked_calls,
                evidence: result.evidence.evidence().id.clone(), evidence_hash: result.evidence.content_hash().clone(),
                knowledge: report.knowledge.id.clone(), is_champion,
                scope: "Only this evaluated GCD workload and recorded environment; unresolved evaluation is not a candidate failure".into(),
                commit: commit.clone(),
            });
            if is_champion {
                let fuel = result
                    .evaluation
                    .mean_fuel
                    .ok_or("Champion missing fuel")?
                    .get();
                if fuel < best_fuel {
                    let source = sources
                        .sources
                        .iter()
                        .find(|s| s.candidate == result.candidate.id)
                        .ok_or("archived winner source missing")?;
                    memory = Some(Winner {
                        experiment: report.experiment.id.clone(),
                        candidate: result.candidate.id.clone(),
                        report_hash: hash.clone(),
                        artifact_hash: source.artifact_hash.clone(),
                        source_hash: source.source_hash.clone(),
                        wat: String::from_utf8(bounded_bytes(
                            &run.join(format!("sources/{}.wat", result.candidate.id)),
                            32768,
                        )?)?,
                        mean_fuel: fuel.to_string(),
                        strategy: spec.strategy.clone(),
                        evidence: result.evidence.evidence().id.clone(),
                        evidence_hash: result.evidence.content_hash().clone(),
                        commit: commit.clone(),
                    });
                    best_fuel = fuel;
                }
            }
        }
    }
    // Negative evidence, the winner, alternatives and unresolved evaluations all
    // remain distinct; deduplicate repeated observations of the same artifact.
    observations.sort_by_key(|o| {
        (
            match o.outcome {
                CandidateOutcome::FailedCorrectness
                | CandidateOutcome::FailedResourceLimit
                | CandidateOutcome::FailedContract
                | CandidateOutcome::InvalidModule => 0,
                CandidateOutcome::Qualified if o.is_champion => 1,
                CandidateOutcome::Qualified => 2,
                _ => 3,
            },
            o.artifact_hash.clone(),
            o.experiment.clone(),
        )
    });
    let mut observed = BTreeSet::new();
    observations.retain(|o| observed.insert((o.artifact_hash.clone(), format!("{:?}", o.outcome))));
    let truncated = observations.len() > limit || seen_artifacts.len() > 512;
    observations.truncate(limit);
    seen_artifacts = seen_artifacts.into_iter().take(512).collect();
    Ok(Memory {
        schema_version: ace_protocol::ProtocolVersion,
        project: baseline.config.project.clone(),
        cell: baseline.config.cell.clone(),
        intent: baseline.config.intent.clone(),
        environment_hash: baseline.environment_hash.clone(),
        evalspec_hash,
        compatible_runs,
        excluded_runs,
        winner: memory.ok_or("no compatible archived qualified winner")?,
        observations,
        seen_artifacts,
        truncated,
    })
}
