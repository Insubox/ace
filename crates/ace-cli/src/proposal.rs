//! Agent-owned WAT is assembled as data, never compiled or run as host code.
//! Registration does not qualify a candidate. Actual execution uses the same
//! import-free Wasmi sandbox, independent Oracle and deterministic policy.
use crate::{Result, create_atomic, generate, json};
use ace_core::*;
use ace_runner::{ModuleSpec, RunReport};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::Path,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Proposal {
    pub id: CandidateId,
    #[schemars(length(min = 1, max = 32768))]
    pub wat: String,
    pub strategy: Text,
    pub generator: Generator,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Batch {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub cell: CellId,
    #[schemars(length(min = 1, max = 100))]
    pub candidates: Vec<Proposal>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Parent {
    pub experiment: ExperimentId,
    pub champion: ChampionId,
    pub candidate: CandidateId,
    pub artifact_hash: ContentHash,
    pub evidence: EvidenceId,
    pub evidence_hash: ContentHash,
    pub environment_hash: ContentHash,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Source {
    pub candidate: CandidateId,
    pub source_hash: Option<ContentHash>,
    pub artifact_hash: ContentHash,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Registration {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub assembler: String,
    pub proposal_hash: ContentHash,
    pub config_hash: ContentHash,
    pub provenance_caller_asserted: bool,
    pub real_evaluation_required: bool,
    pub parent: Option<Parent>,
    pub artifacts: Vec<Source>,
}

fn read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err("proposal file exceeds its size limit".into());
    }
    Ok(bytes)
}

fn validate(batch: &Batch) -> Result<()> {
    if batch.cell.as_str() != "Gcd" || batch.candidates.is_empty() || batch.candidates.len() > 100 {
        return Err("register 1–100 proposals for the Gcd Cell".into());
    }
    if json(batch)?.len() > 3_145_728 {
        return Err("proposal batch exceeds 3 MiB".into());
    }
    let mut ids = BTreeSet::from([CandidateId::new("C-baseline")?]);
    for candidate in &batch.candidates {
        crate::mcp::portable_name(candidate.id.as_str())?;
        if !ids.insert(candidate.id.clone()) {
            return Err("proposal candidate IDs must be unique, including baseline".into());
        }
        if candidate.wat.trim().is_empty() || candidate.wat.len() > 32768 {
            return Err("each WAT source must contain 1–32768 bytes".into());
        }
        if candidate.strategy.as_str().len() > 1024
            || candidate.generator.provider.as_str().len() > 256
            || candidate.generator.model.as_str().len() > 256
            || candidate
                .generator
                .revision
                .as_ref()
                .is_some_and(|r| r.as_str().len() > 256)
        {
            return Err("proposal provenance or strategy exceeds its size limit".into());
        }
    }
    Ok(())
}

pub(crate) fn register(
    directory: &Path,
    batch: &Batch,
    baseline_run: Option<&Path>,
) -> Result<Registration> {
    validate(batch)?;
    let (base_bytes, base_source, base_generator, base_strategy, parent, profile) =
        if let Some(run) = baseline_run {
            let report = ace_runner::load_report(run)?;
            if report.config.cell.as_str() != "Gcd" {
                return Err("baseline Champion belongs to another Cell".into());
            }
            let champion = report
                .champion
                .as_ref()
                .ok_or("baseline run has no qualified Champion")?;
            let result = report
                .results
                .iter()
                .find(|r| r.candidate.id == champion.candidate)
                .ok_or("baseline Champion missing from its run")?;
            let spec = std::iter::once(&report.config.baseline)
                .chain(&report.config.candidates)
                .find(|s| s.id == champion.candidate)
                .ok_or("baseline strategy missing")?;
            let bytes = read(&run.join("champion.wasm"), 1_048_576)?;
            if ContentHash::of_bytes(&bytes) != champion.artifact.hash {
                return Err("baseline Champion artifact changed".into());
            }
            let parent = Parent {
                experiment: report.experiment.id.clone(),
                champion: champion.id.clone(),
                candidate: champion.candidate.clone(),
                artifact_hash: champion.artifact.hash.clone(),
                evidence: result.evidence.evidence().id.clone(),
                evidence_hash: result.evidence.content_hash().clone(),
                environment_hash: report.environment_hash.clone(),
            };
            let source_path = run.join(format!("sources/{}.wat", champion.candidate));
            let source = if source_path.try_exists()? {
                let source = read(&source_path, 32768)?;
                if wat::parse_bytes(&source)?.as_ref() != bytes {
                    return Err("parent Champion source differs from artifact".into());
                }
                Some(String::from_utf8(source)?)
            } else {
                None
            };
            (
                bytes,
                source,
                spec.generator.clone(),
                spec.strategy.clone(),
                Some(parent),
                Some(report.config),
            )
        } else {
            let source = generate::baseline();
            (
                wat::parse_str(&source)?,
                Some(source),
                Generator {
                    provider: Text::new("ace-local")?,
                    model: Text::new("gcd-reference-v1")?,
                    revision: Some(Text::new(env!("CARGO_PKG_VERSION"))?),
                },
                Text::new("bounded-divisor-scan")?,
                None,
                None,
            )
        };
    let base_hash = ContentHash::of_bytes(&base_bytes);
    let baseline = ModuleSpec {
        id: CandidateId::new("C-baseline")?,
        module: format!("artifacts/{}.wasm", base_hash.as_str()).into(),
        strategy: base_strategy,
        generator: base_generator,
    };
    let mut modules = Vec::new();
    let mut files = BTreeMap::new();
    let mut hashes = BTreeSet::from([base_hash.clone()]);
    let mut artifacts = vec![Source {
        candidate: baseline.id.clone(),
        source_hash: base_source
            .as_ref()
            .map(|s| ContentHash::of_bytes(s.as_bytes())),
        artifact_hash: base_hash.clone(),
    }];
    files.insert(format!("artifacts/{}.wasm", base_hash.as_str()), base_bytes);
    if let Some(source) = base_source {
        files.insert("sources/C-baseline.wat".into(), source.into_bytes());
    }
    for proposal in &batch.candidates {
        let bytes = wat::parse_str(&proposal.wat)
            .map_err(|error| format!("invalid WAT proposal: {error}"))?;
        if bytes.len() > 1_048_576 {
            return Err("assembled WASM exceeds 1 MiB".into());
        }
        let hash = ContentHash::of_bytes(&bytes);
        if !hashes.insert(hash.clone()) {
            return Err("duplicate compiled artifact, including the baseline".into());
        }
        let path = format!("artifacts/{}.wasm", hash.as_str());
        files.insert(path.clone(), bytes);
        files.insert(
            format!("sources/{}.wat", proposal.id),
            proposal.wat.as_bytes().to_vec(),
        );
        modules.push(ModuleSpec {
            id: proposal.id.clone(),
            module: path.into(),
            strategy: proposal.strategy.clone(),
            generator: proposal.generator.clone(),
        });
        artifacts.push(Source {
            candidate: proposal.id.clone(),
            source_hash: Some(ContentHash::of_bytes(proposal.wat.as_bytes())),
            artifact_hash: hash,
        });
    }
    let mut config = generate::config(baseline, modules)?;
    config.project = ProjectId::new("PRJ-agent-gcd")?;
    config.experiment = ExperimentId::new("EXP-agent-gcd")?;
    config.hypothesis = HypothesisId::new("H-agent-proposals")?;
    if let Some(profile) = profile {
        config.project = profile.project;
        config.intent = profile.intent;
        config.harness = profile.harness;
        config.min_relative_improvement = profile.min_relative_improvement;
        config.max_wall_clock_seconds = profile.max_wall_clock_seconds;
    }
    config.validate()?;
    let record = Registration {
        schema_version: ace_protocol::ProtocolVersion,
        assembler: "wat-embedded-v1".into(),
        proposal_hash: ContentHash::of_json(batch)?,
        config_hash: ContentHash::of_json(&config)?,
        provenance_caller_asserted: true,
        real_evaluation_required: true,
        parent,
        artifacts,
    };
    if let Some(parent) = directory.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir(directory)?;
    for (name, bytes) in files {
        create_atomic(&directory.join(name), &bytes)?;
    }
    create_atomic(&directory.join("proposals.json"), &json(batch)?)?;
    create_atomic(&directory.join("registration.json"), &json(&record)?)?;
    create_atomic(&directory.join("experiment.json"), &json(&config)?)?;
    Ok(record)
}

pub(crate) fn verify(directory: &Path) -> Result<Registration> {
    let record: Registration = serde_json::from_value(ace_protocol::parse_json(&read(
        &directory.join("registration.json"),
        131072,
    )?)?)?;
    let batch: Batch = serde_json::from_value(ace_protocol::parse_json(&read(
        &directory.join("proposals.json"),
        3_145_728,
    )?)?)?;
    validate(&batch)?;
    let config = ace_runner::load_config(directory)?;
    if config.cell.as_str() != "Gcd"
        || config.baseline.id.as_str() != "C-baseline"
        || record.assembler != "wat-embedded-v1"
        || !record.provenance_caller_asserted
        || !record.real_evaluation_required
        || record.proposal_hash != ContentHash::of_json(&batch)?
        || record.config_hash != ContentHash::of_json(&config)?
        || record.artifacts.len() != batch.candidates.len() + 1
        || config.candidates.len() != batch.candidates.len()
    {
        return Err("registered proposal identity changed".into());
    }
    let root = directory.canonicalize()?;
    let mut ids = BTreeSet::new();
    let mut hashes = BTreeSet::new();
    for (index, (source, spec)) in record
        .artifacts
        .iter()
        .zip(std::iter::once(&config.baseline).chain(&config.candidates))
        .enumerate()
    {
        if source.candidate != spec.id
            || !ids.insert(spec.id.clone())
            || !hashes.insert(source.artifact_hash.clone())
        {
            return Err("registered proposal population changed".into());
        }
        let path = directory.join(&spec.module).canonicalize()?;
        if !path.starts_with(&root) {
            return Err("registered artifact escapes input directory".into());
        }
        let module = read(&path, 1_048_576)?;
        if source.artifact_hash != ContentHash::of_bytes(&module) {
            return Err("registered WASM artifact changed".into());
        }
        if let Some(expected) = &source.source_hash {
            let path = directory
                .join(format!("sources/{}.wat", spec.id))
                .canonicalize()?;
            if !path.starts_with(&root) {
                return Err("registered source escapes input directory".into());
            }
            let wat = read(&path, 32768)?;
            if &ContentHash::of_bytes(&wat) != expected
                || wat::parse_bytes(&wat)?.as_ref() != module
            {
                return Err("registered WAT source changed".into());
            }
            if index > 0 && wat != batch.candidates[index - 1].wat.as_bytes() {
                return Err("proposal source differs from registered batch".into());
            }
        } else if index > 0 {
            return Err("agent candidate has no source hash".into());
        }
        if index > 0 {
            let proposal = &batch.candidates[index - 1];
            if spec.id != proposal.id
                || spec.strategy != proposal.strategy
                || spec.generator != proposal.generator
            {
                return Err("proposal provenance differs from registration".into());
            }
        }
    }
    if let Some(parent) = &record.parent
        && record.artifacts[0].artifact_hash != parent.artifact_hash
    {
        return Err("baseline differs from parent Champion".into());
    }
    Ok(record)
}

pub(crate) fn verify_if_present(directory: &Path) -> Result<Option<Registration>> {
    if directory.join("registration.json").try_exists()? {
        Ok(Some(verify(directory)?))
    } else {
        Ok(None)
    }
}

pub(crate) fn verify_run(
    directory: &Path,
    record: &Registration,
    report: &RunReport,
) -> Result<()> {
    let mut config = report.config.clone();
    config.experiment = report.requested_experiment.clone();
    if record.config_hash != ContentHash::of_json(&config)?
        || report.results.len() != record.artifacts.len()
        || report.results.iter().zip(&record.artifacts).any(|(r, a)| {
            r.candidate.id != a.candidate || r.candidate.patch.hash != a.artifact_hash
        })
    {
        return Err("executed population differs from registered proposals".into());
    }
    if &verify(directory)? != record {
        return Err("registration changed during evaluation".into());
    }
    Ok(())
}
