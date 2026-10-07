use crate::{sandbox, *};
use ace_core::*;
use ace_protocol::{Document, Envelope};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct PersistedRun {
    report: RunReport,
    content_hash: ContentHash,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReplayReport {
    pub candidate: CandidateId,
    pub original_evidence_hash: ContentHash,
    pub environment_hash: ContentHash,
    pub original_outcome: CandidateOutcome,
    pub observed: Evaluation,
    /// Compare outcome, output trace and deterministic fuel; timing is intentionally excluded.
    pub matched: bool,
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::create_dir_all(path.parent().expect("run file has a parent"))?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
fn json(value: &impl Serialize) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn doc(path: &Path, value: Document) -> Result<()> {
    write_new(path, &json(&Envelope::new(value))?)
}
fn candidate_path(root: &Path, id: &CandidateId, name: &str) -> PathBuf {
    root.join("candidates")
        .join(id.as_str())
        .join(format!("{name}.json"))
}

pub(crate) fn persist(root: &Path, report: &RunReport, modules: &[Vec<u8>]) -> Result<()> {
    if let Some(parent) = root.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    // Exclusive creation protects pre-existing runs. A failed/interrupted write
    // leaves no completed run.json manifest, and cannot be loaded as a run.
    fs::create_dir(root)?;
    for module in modules {
        let hash = ContentHash::of_bytes(module);
        let path = root
            .join("artifacts")
            .join(format!("{}.wasm", hash.as_str()));
        if !path.exists() {
            write_new(&path, module)?;
        }
    }
    doc(
        &root.join("environment.json"),
        Document::Environment(report.environment.clone()),
    )?;
    doc(
        &root.join("intent.json"),
        Document::Intent(report.intent.clone()),
    )?;
    doc(
        &root.join("experiment.json"),
        Document::Experiment(report.experiment.clone()),
    )?;
    doc(
        &root.join("knowledge.json"),
        Document::Knowledge(report.knowledge.clone()),
    )?;
    if let Some(baseline) = &report.baseline_champion {
        baseline.validate()?;
        doc(
            &root.join("baseline-champion.json"),
            Document::Champion(baseline.clone()),
        )?;
    }
    for result in &report.results {
        let id = &result.candidate.id;
        write_new(
            &candidate_path(root, id, "evaluation"),
            &canonical_json(&result.evaluation)?,
        )?;
        doc(
            &candidate_path(root, id, "candidate"),
            Document::Candidate(result.candidate.clone()),
        )?;
        doc(
            &candidate_path(root, id, "evidence"),
            Document::Evidence(result.evidence.clone().into()),
        )?;
        doc(
            &candidate_path(root, id, "decision"),
            Document::PolicyDecision(result.decision.clone()),
        )?;
    }
    if let Some(champion) = &report.champion {
        champion.validate()?;
        doc(
            &root.join("champion.json"),
            Document::Champion(champion.clone()),
        )?;
        let index = report
            .results
            .iter()
            .position(|r| r.candidate.id == champion.candidate)
            .expect("champion candidate");
        write_new(&root.join("champion.wasm"), &modules[index])?;
    }
    report.knowledge.validate()?;
    report.intent.validate()?;
    let manifest = PersistedRun {
        content_hash: ContentHash::of_json(report)?,
        report: report.clone(),
    };
    // This completion manifest is written last, and its seal detects partial JSON.
    write_new(&root.join("run.json"), &json(&manifest)?)?;
    Ok(())
}

fn verify_doc(root: &crate::files::ReadDirectory, path: &Path, expected: Document) -> Result<()> {
    let actual = ace_protocol::decode(&root.read(path, 8_388_608)?)?;
    if actual != Envelope::new(expected) {
        return Err(RunnerError::Setup(format!(
            "run document differs: {}",
            path.display()
        )));
    }
    Ok(())
}

pub fn load_report(root: &Path) -> Result<RunReport> {
    let root = &crate::files::ReadDirectory::open(root)?;
    let manifest: PersistedRun = serde_json::from_value(ace_protocol::parse_json(
        &root.read(Path::new("run.json"), 8_388_608)?,
    )?)?;
    if manifest.content_hash != ContentHash::of_json(&manifest.report)? {
        return Err(RunnerError::Setup(
            "run manifest content hash mismatch".into(),
        ));
    }
    let report = manifest.report;
    report.config.validate()?;
    report.intent.validate()?;
    report.knowledge.validate()?;
    if !(1..=8).contains(&report.jobs)
        || report.environment.fingerprint()? != report.environment_hash
    {
        return Err(RunnerError::Setup(
            "run environment fingerprint mismatch".into(),
        ));
    }
    let specs: Vec<_> = std::iter::once(&report.config.baseline)
        .chain(&report.config.candidates)
        .collect();
    if specs.len() != report.results.len() {
        return Err(RunnerError::Setup(
            "run candidate population differs".into(),
        ));
    }
    let mut hashes = Vec::new();
    for (index, (spec, result)) in specs.into_iter().zip(&report.results).enumerate() {
        if spec.id != result.candidate.id || result.is_baseline != (index == 0) {
            return Err(RunnerError::Setup("run candidate identity mismatch".into()));
        }
        result.candidate.validate()?;
        result.evidence.validate()?;
        let evaluation_path = candidate_path(Path::new(""), &result.candidate.id, "evaluation");
        let evaluation_bytes = root.read(&evaluation_path, 8_388_608)?;
        let evaluation_artifact = result
            .evidence
            .evidence()
            .evaluator
            .output
            .as_ref()
            .ok_or_else(|| RunnerError::Setup("missing evaluator observation artifact".into()))?;
        if evaluation_bytes != canonical_json(&result.evaluation)?
            || ContentHash::of_bytes(&evaluation_bytes) != evaluation_artifact.hash
            || evaluation_artifact.location.as_str()
                != format!("candidates/{}/evaluation.json", result.candidate.id)
        {
            return Err(RunnerError::Setup(
                "evaluator observation artifact hash mismatch".into(),
            ));
        }
        let module = root.read(
            Path::new(result.candidate.patch.location.as_str()),
            1_048_576,
        )?;
        let hash = ContentHash::of_bytes(&module);
        if hash != result.candidate.patch.hash {
            return Err(RunnerError::Setup(
                "stored WASM artifact hash mismatch".into(),
            ));
        }
        hashes.push(hash);
        let id = &result.candidate.id;
        for (name, expected) in [
            ("candidate", Document::Candidate(result.candidate.clone())),
            (
                "evidence",
                Document::Evidence(result.evidence.clone().into()),
            ),
            (
                "decision",
                Document::PolicyDecision(result.decision.clone()),
            ),
        ] {
            let path = candidate_path(Path::new(""), id, name);
            verify_doc(root, &path, expected)?;
        }
        let decision = ace_policy::evaluate(&ace_policy::PolicyInput {
            cell: report.config.cell.clone(),
            candidate: id.clone(),
            experiment: report.config.experiment.clone(),
            environment_hash: report.environment_hash.clone(),
            evalspec: report.intent.evalspec.clone(),
            evidence: result.evidence.clone(),
            decided_at: result.decision.decided_at,
        })?;
        if decision != result.decision {
            return Err(RunnerError::Setup(
                "stored policy decision does not reproduce from its inputs".into(),
            ));
        }
    }
    if ContentHash::of_json(&(&report.config, hashes))? != report.input_hash {
        return Err(RunnerError::Setup("run input hash mismatch".into()));
    }
    for (name, expected) in [
        (
            "environment",
            Document::Environment(report.environment.clone()),
        ),
        ("intent", Document::Intent(report.intent.clone())),
        (
            "experiment",
            Document::Experiment(report.experiment.clone()),
        ),
        ("knowledge", Document::Knowledge(report.knowledge.clone())),
    ] {
        verify_doc(root, Path::new(&format!("{name}.json")), expected)?;
    }
    let (elites, selected) = select(&report.results, report.config.min_relative_improvement);
    if report.baseline_champion.is_some()
        != (report.results[0].decision.decision == Decision::Elite)
    {
        return Err(RunnerError::Setup(
            "baseline qualification is missing or inconsistent".into(),
        ));
    }
    if elites != report.elites
        || selected.as_ref() != report.champion.as_ref().map(|c| &c.candidate)
    {
        return Err(RunnerError::Setup(
            "stored selection does not reproduce".into(),
        ));
    }
    if let Some(champion) = &report.champion {
        champion.validate()?;
        verify_doc(
            root,
            Path::new("champion.json"),
            Document::Champion(champion.clone()),
        )?;
        if ContentHash::of_bytes(&root.read(Path::new("champion.wasm"), 1_048_576)?)
            != champion.artifact.hash
        {
            return Err(RunnerError::Setup(
                "materialized Champion hash mismatch".into(),
            ));
        }
    }
    if let Some(baseline) = &report.baseline_champion {
        baseline.validate()?;
        verify_doc(
            root,
            Path::new("baseline-champion.json"),
            Document::Champion(baseline.clone()),
        )?;
        if baseline.id != report.results[0].candidate.parent
            || baseline.candidate != report.config.baseline.id
            || baseline.artifact != report.results[0].candidate.patch
            || baseline.environment_hash != report.environment_hash
        {
            return Err(RunnerError::Setup(
                "baseline qualification context mismatch".into(),
            ));
        }
    }
    Ok(report)
}

pub fn replay(root: &Path, candidate: &CandidateId) -> Result<ReplayReport> {
    let report = load_report(root)?;
    if crate::experiment::environment(&report.config, report.jobs)?.fingerprint()?
        != report.environment_hash
    {
        return Err(RunnerError::Setup("current runtime, host or dependencies differ from the recorded environment; run a new experiment".into()));
    }
    let original = report
        .results
        .iter()
        .find(|r| &r.candidate.id == candidate)
        .ok_or_else(|| RunnerError::Setup("candidate is not in this experiment".into()))?;
    let module = read_module(root, Path::new(original.candidate.patch.location.as_str()))?;
    let observed = sandbox::evaluate_module(
        &module,
        &report.config.harness,
        sandbox::deadline(report.config.max_wall_clock_seconds),
    );
    let matched = observed.outcome == original.evaluation.outcome
        && observed.checked_calls == original.evaluation.checked_calls
        && observed.output_hash == original.evaluation.output_hash
        && observed.mean_fuel == original.evaluation.mean_fuel
        && observed.peak_linear_memory_bytes == original.evaluation.peak_linear_memory_bytes;
    Ok(ReplayReport {
        candidate: candidate.clone(),
        original_evidence_hash: original.evidence.content_hash().clone(),
        environment_hash: report.environment_hash,
        original_outcome: original.evaluation.outcome,
        observed,
        matched,
    })
}

pub fn runner_schemas() -> Result<std::collections::BTreeMap<String, serde_json::Value>> {
    let mut result = std::collections::BTreeMap::new();
    for (name, schema) in [
        (
            "cloud-plan",
            serde_json::to_value(schemars::schema_for!(CloudPlan))?,
        ),
        (
            "cloud-observation",
            serde_json::to_value(schemars::schema_for!(SealedObservation))?,
        ),
        (
            "local-experiment",
            serde_json::to_value(schemars::schema_for!(RunConfig))?,
        ),
        (
            "local-run",
            serde_json::to_value(schemars::schema_for!(PersistedRun))?,
        ),
        (
            "local-replay",
            serde_json::to_value(schemars::schema_for!(ReplayReport))?,
        ),
    ] {
        let mut schema = schema;
        schema["$id"] = format!("https://ace.org.ai/schemas/v1/{name}.schema.json").into();
        result.insert(format!("{name}.schema.json"), schema);
    }
    Ok(result)
}
