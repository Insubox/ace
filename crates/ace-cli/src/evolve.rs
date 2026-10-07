use crate::{Result, create_atomic, generate, json};
use ace_core::*;
use ace_protocol::{Document, Envelope};
use ace_runner::RunReport;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::Path,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Step {
    pub generation: u32,
    pub seed: u64,
    pub experiment: ExperimentId,
    pub run_hash: ContentHash,
    pub generation_manifest_hash: ContentHash,
    pub baseline_artifact_hash: ContentHash,
    pub champion: CandidateId,
    pub champion_artifact_hash: ContentHash,
    pub mean_fuel: FiniteNumber,
    pub improved: bool,
    pub knowledge: KnowledgeId,
    pub knowledge_hash: ContentHash,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Campaign {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub generator_version: String,
    pub seed: u64,
    pub candidates: u32,
    pub max_generations: u32,
    pub jobs: u32,
    pub patience: u32,
    pub stop_reason: StopReason,
    pub steps: Vec<Step>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StopReason {
    GenerationBudget,
    NoImprovement,
}

fn bytes(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(1_048_577)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("campaign document exceeds 1 MiB".into());
    }
    Ok(bytes)
}

fn proposal_seed(seed: u64, generation: u32) -> u64 {
    seed.wrapping_add(u64::from(generation - 1).wrapping_mul(0x9e3779b97f4a7c15))
}

fn strategy(report: &RunReport, id: &CandidateId) -> Result<String> {
    Ok(std::iter::once(&report.config.baseline)
        .chain(&report.config.candidates)
        .find(|spec| &spec.id == id)
        .ok_or("Champion has no registered strategy")?
        .strategy
        .as_str()
        .into())
}

fn knowledge(report: &RunReport, parent: Option<&KnowledgeId>) -> Result<Envelope> {
    let mut node = report.knowledge.clone();
    node.id = KnowledgeId::new(format!(
        "KN-{}",
        ContentHash::of_json(&(&report.knowledge.id, parent, &report.experiment.id))?.as_str()
    ))?;
    node.parents = parent.cloned().into_iter().collect::<BTreeSet<_>>();
    node.validate()?;
    Ok(Envelope::new(Document::Knowledge(node)))
}

fn step(
    root: &Path,
    generation: u32,
    seed: u64,
    report: &RunReport,
    parent: Option<&KnowledgeId>,
) -> Result<(Step, Envelope)> {
    let champion = report
        .champion
        .as_ref()
        .ok_or("generation has no qualified Champion")?;
    let result = report
        .results
        .iter()
        .find(|r| r.candidate.id == champion.candidate)
        .ok_or("Champion missing from population")?;
    let node = knowledge(report, parent)?;
    let Document::Knowledge(knowledge) = &node.payload else {
        unreachable!()
    };
    Ok((
        Step {
            generation,
            seed,
            experiment: report.experiment.id.clone(),
            run_hash: ContentHash::of_bytes(&bytes(&root.join("run/run.json"))?),
            generation_manifest_hash: ContentHash::of_bytes(&bytes(&root.join("generation.json"))?),
            baseline_artifact_hash: report.results[0].candidate.patch.hash.clone(),
            champion: champion.candidate.clone(),
            champion_artifact_hash: champion.artifact.hash.clone(),
            mean_fuel: result
                .evaluation
                .mean_fuel
                .ok_or("Champion has no fuel measurement")?,
            improved: champion.candidate != report.config.baseline.id,
            knowledge: knowledge.id.clone(),
            knowledge_hash: node.content_hash()?,
        },
        node,
    ))
}

pub(crate) fn run(
    root: &Path,
    seed: u64,
    candidates: u32,
    max_generations: u32,
    jobs: u32,
    patience: u32,
) -> Result<Campaign> {
    if !(4..=100).contains(&candidates)
        || !(1..=16).contains(&max_generations)
        || !(1..=8).contains(&jobs)
        || !(1..=16).contains(&patience)
    {
        return Err("evolution parameters exceed supported bounds".into());
    }
    if let Some(parent) = root.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir(root)?;
    let mut campaign = Campaign {
        schema_version: ace_protocol::ProtocolVersion,
        generator_version: "gcd-grammar-v1".into(),
        seed,
        candidates,
        max_generations,
        jobs,
        patience,
        stop_reason: StopReason::GenerationBudget,
        steps: Vec::new(),
    };
    let mut inherited = None;
    let mut unchanged = 0;
    for generation in 1..=max_generations {
        let directory = root.join(format!("generation-{generation:03}"));
        let generation_seed = proposal_seed(seed, generation);
        generate::population_with_base(
            &directory,
            generation_seed,
            candidates,
            inherited.as_ref(),
        )?;
        ace_runner::run(&directory, &directory.join("run"), jobs)?;
        let report = ace_runner::load_report(&directory.join("run"))?;
        generate::verify_controls(&report)?;
        let parent = campaign.steps.last().map(|s| &s.knowledge);
        let (receipt, node) = step(&directory, generation, generation_seed, &report, parent)?;
        let result = report
            .results
            .iter()
            .find(|r| r.candidate.id == receipt.champion)
            .ok_or("Champion missing from run")?;
        let source = String::from_utf8(bytes(
            &directory.join(format!("sources/{}.wat", receipt.champion)),
        )?)?;
        inherited = Some(generate::Base {
            bytes: bytes(&directory.join("run/champion.wasm"))?,
            source,
            strategy: strategy(&report, &receipt.champion)?,
            generator: result.candidate.provenance.generator.clone(),
            parent_experiment: report.experiment.id.clone(),
            evidence_hash: result.evidence.content_hash().clone(),
        });
        create_atomic(&directory.join("knowledge-linked.json"), &json(&node)?)?;
        create_atomic(&directory.join("receipt.json"), &json(&receipt)?)?;
        unchanged = if receipt.improved { 0 } else { unchanged + 1 };
        campaign.steps.push(receipt);
        if unchanged >= patience {
            campaign.stop_reason = StopReason::NoImprovement;
            break;
        }
    }
    create_atomic(&root.join("evolution.json"), &json(&campaign)?)?;
    // The user receives a usable artifact only after its entire lineage verifies.
    load_inner(root, false)?;
    let last = campaign.steps.last().ok_or("campaign has no generations")?;
    create_atomic(
        &root.join("champion.wasm"),
        &bytes(&root.join(format!(
            "generation-{:03}/run/champion.wasm",
            last.generation
        )))?,
    )?;
    load(root)?;
    Ok(campaign)
}

pub(crate) fn load(root: &Path) -> Result<Campaign> {
    load_inner(root, true)
}

fn load_inner(root: &Path, require_artifact: bool) -> Result<Campaign> {
    let campaign: Campaign = serde_json::from_value(ace_protocol::parse_json(&bytes(
        &root.join("evolution.json"),
    )?)?)?;
    if campaign.generator_version != "gcd-grammar-v1"
        || !(4..=100).contains(&campaign.candidates)
        || !(1..=16).contains(&campaign.max_generations)
        || !(1..=8).contains(&campaign.jobs)
        || !(1..=16).contains(&campaign.patience)
        || campaign.steps.is_empty()
        || campaign.steps.len() > campaign.max_generations as usize
    {
        return Err("invalid evolution campaign parameters".into());
    }
    let mut previous: Option<Step> = None;
    let mut previous_environment = None;
    let mut unchanged = 0;
    for (index, recorded) in campaign.steps.iter().enumerate() {
        let generation = index as u32 + 1;
        let directory = root.join(format!("generation-{generation:03}"));
        let report = ace_runner::load_report(&directory.join("run"))?;
        generate::verify_controls(&report)?;
        if report.jobs != campaign.jobs
            || report.config.candidates.len() != campaign.candidates as usize
            || previous_environment
                .as_ref()
                .is_some_and(|hash| hash != &report.environment_hash)
        {
            return Err("generation population or evaluation environment changed".into());
        }
        let seed = proposal_seed(campaign.seed, generation);
        let (expected, node) = step(
            &directory,
            generation,
            seed,
            &report,
            previous.as_ref().map(|s| &s.knowledge),
        )?;
        let receipt: Step = serde_json::from_value(ace_protocol::parse_json(&bytes(
            &directory.join("receipt.json"),
        )?)?)?;
        if &expected != recorded
            || expected != receipt
            || bytes(&directory.join("knowledge-linked.json"))? != json(&node)?
        {
            return Err("campaign evidence or Knowledge lineage differs from verified runs".into());
        }
        if previous
            .as_ref()
            .is_some_and(|p| p.champion_artifact_hash != expected.baseline_artifact_hash)
        {
            return Err("generation baseline is not the preceding qualified Champion".into());
        }
        // Rebuild the recorded population without evaluating or trusting any
        // caller-provided genotype metadata, then compare all source artifacts.
        let temporary = tempfile::tempdir()?;
        let inherited = if let Some(p) = &previous {
            let prior_dir = root.join(format!("generation-{:03}", p.generation));
            let prior = ace_runner::load_report(&prior_dir.join("run"))?;
            let prior_result = prior
                .results
                .iter()
                .find(|r| r.candidate.id == p.champion)
                .ok_or("prior Champion missing")?;
            Some(generate::Base {
                bytes: bytes(&prior_dir.join("run/champion.wasm"))?,
                source: String::from_utf8(bytes(
                    &prior_dir.join(format!("sources/{}.wat", p.champion)),
                )?)?,
                strategy: strategy(&prior, &p.champion)?,
                generator: prior_result.candidate.provenance.generator.clone(),
                parent_experiment: prior.experiment.id.clone(),
                evidence_hash: prior_result.evidence.content_hash().clone(),
            })
        } else {
            None
        };
        let rebuilt = generate::population_with_base(
            &temporary.path().join("population"),
            seed,
            campaign.candidates,
            inherited.as_ref(),
        )?;
        generate::verify_sources(&directory, &rebuilt)?;
        if bytes(&directory.join("generation.json"))? != json(&rebuilt)?
            || ace_runner::load_config(&directory)?
                != ace_runner::load_config(&temporary.path().join("population"))?
        {
            return Err("generation seed or provenance does not reproduce".into());
        }
        // Bind the regenerated input modules to the sealed run artifacts.
        let config = ace_runner::load_config(&directory)?;
        let mut expected_config = config.clone();
        expected_config.experiment = report.config.experiment.clone();
        if expected_config != report.config {
            return Err("run configuration differs from generated population".into());
        }
        for (spec, result) in std::iter::once(&config.baseline)
            .chain(&config.candidates)
            .zip(&report.results)
        {
            let module = bytes(&directory.join(&spec.module))?;
            if ContentHash::of_bytes(&module) != result.candidate.patch.hash {
                return Err("generated module differs from executed artifact".into());
            }
        }
        unchanged = if expected.improved { 0 } else { unchanged + 1 };
        if unchanged >= campaign.patience && index + 1 != campaign.steps.len() {
            return Err("campaign continued past its stop condition".into());
        }
        previous_environment = Some(report.environment_hash);
        previous = Some(expected);
    }
    let expected_reason = if unchanged >= campaign.patience {
        StopReason::NoImprovement
    } else {
        StopReason::GenerationBudget
    };
    if campaign.stop_reason != expected_reason
        || (campaign.stop_reason == StopReason::GenerationBudget
            && campaign.steps.len() != campaign.max_generations as usize)
    {
        return Err("campaign stop condition does not reproduce".into());
    }
    let artifact = root.join("champion.wasm");
    if (require_artifact || artifact.exists())
        && ContentHash::of_bytes(&bytes(&artifact)?)
            != campaign.steps.last().unwrap().champion_artifact_hash
    {
        return Err("campaign Champion artifact changed".into());
    }
    Ok(campaign)
}

pub(crate) fn print_campaign(path: &Path, campaign: &Campaign) -> Result<()> {
    let mut out = std::io::stdout().lock();
    writeln!(
        out,
        "ACE evolution completed: {} generations.",
        campaign.steps.len()
    )?;
    for step in &campaign.steps {
        writeln!(
            out,
            "Generation {}: Champion {}, {:.2} mean WASM fuel, improved: {}",
            step.generation,
            step.champion,
            step.mean_fuel.get(),
            step.improved
        )?;
    }
    writeln!(
        out,
        "Stopped: {:?}. Evidence and linked Knowledge: {}",
        campaign.stop_reason,
        path.display()
    )?;
    writeln!(out, "Verify: ace history \"{}\"", path.display())?;
    Ok(())
}
