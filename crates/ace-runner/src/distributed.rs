//! Trusted distributed evaluator boundary. Hashes detect corruption; they are
//! not signatures. Only the authenticated control plane may supply observations.
use crate::{experiment, sandbox, *};
use ace_core::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CloudPlan {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub requested_experiment: ExperimentId,
    pub config: RunConfig,
    /// Baseline first, followed by registered candidates. Artifacts are raw SHA-256.
    pub module_hashes: Vec<ContentHash>,
}
impl Validate for CloudPlan {
    fn validate(&self) -> std::result::Result<(), ValidationError> {
        self.config.validate()?;
        if self.module_hashes.len() != self.config.candidates.len() + 1 {
            return Err(ValidationError("cloud plan population differs".into()));
        }
        // JS cannot transport integers above this limit without precision loss.
        if self.config.harness.oracle_seed > 9_007_199_254_740_991 {
            return Err(ValidationError(
                "cloud oracle seed exceeds safe JSON integer range".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CloudObservation {
    pub plan_hash: ContentHash,
    pub index: u32,
    pub module_hash: ContentHash,
    pub environment: Environment,
    pub evaluation: Evaluation,
    pub observed_at: Timestamp,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SealedObservation {
    pub observation: CloudObservation,
    pub content_hash: ContentHash,
}

pub fn read_cloud_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let bytes = crate::files::read_regular(path, 3_145_728)?;
    Ok(serde_json::from_value(ace_protocol::parse_json(&bytes)?)?)
}

/// Freeze a fresh plan and content-addressed modules; no network or compilation.
pub fn prepare_cloud(directory: &Path, output: &Path) -> Result<CloudPlan> {
    let mut config = load_config(directory)?;
    let requested_experiment = config.experiment.clone();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos()
        .to_string();
    config.experiment = ExperimentId::new(format!(
        "EXP-{}",
        ContentHash::of_json(&(&requested_experiment, nonce))?.as_str()
    ))?;
    let modules = std::iter::once(&config.baseline)
        .chain(&config.candidates)
        .map(|m| read_module(directory, &m.module))
        .collect::<Result<Vec<_>>>()?;
    let plan = CloudPlan {
        schema_version: ace_protocol::ProtocolVersion,
        requested_experiment,
        config,
        module_hashes: modules.iter().map(|b| ContentHash::of_bytes(b)).collect(),
    };
    plan.validate()?;
    fs::create_dir(output)?;
    fs::create_dir(output.join("artifacts"))?;
    for (hash, bytes) in plan.module_hashes.iter().zip(modules) {
        let path = output
            .join("artifacts")
            .join(format!("{}.wasm", hash.as_str()));
        if !path.exists() {
            fs::write(path, bytes)?;
        }
    }
    fs::write(output.join("plan.json"), serde_json::to_vec_pretty(&plan)?)?;
    Ok(plan)
}

pub fn evaluate_cloud(plan: &CloudPlan, index: u32, bytes: &[u8]) -> Result<SealedObservation> {
    plan.validate()?;
    let hash = plan
        .module_hashes
        .get(index as usize)
        .ok_or_else(|| RunnerError::Setup("unregistered cloud task".into()))?;
    if bytes.len() > 1_048_576 || &ContentHash::of_bytes(bytes) != hash {
        return Err(RunnerError::Setup(
            "cloud artifact hash or size mismatch".into(),
        ));
    }
    let observation = CloudObservation {
        plan_hash: ContentHash::of_json(plan)?,
        index,
        module_hash: hash.clone(),
        environment: experiment::environment(&plan.config, 1)?,
        evaluation: sandbox::evaluate_module(
            bytes,
            &plan.config.harness,
            sandbox::deadline(plan.config.max_wall_clock_seconds),
        ),
        observed_at: experiment::now(),
    };
    Ok(SealedObservation {
        content_hash: ContentHash::of_json(&observation)?,
        observation,
    })
}

fn verify_evaluation(plan: &CloudPlan, ev: &Evaluation) -> Result<()> {
    let h = &plan.config.harness;
    let calls = h.public_cases.len() as u64
        + u64::from(h.hidden_cases)
        + h.public_cases.len() as u64
            * u64::from(h.benchmark_samples)
            * u64::from(h.benchmark_rounds);
    let qualified = ev.outcome == CandidateOutcome::Qualified;
    if ev.checked_calls > calls
        || (qualified
            && (ev.stage != EvaluationStage::L3
                || ev.checked_calls != calls
                || ev.peak_linear_memory_bytes > u64::from(h.memory_pages) * 65536
                || ev
                    .mean_fuel
                    .is_none_or(|m| m.get() < 0.0 || m.get() > h.fuel_per_call as f64)
                || ev.median_call_ns.is_none_or(|m| m.get() < 0.0)))
        || (!qualified && (ev.mean_fuel.is_some() || ev.median_call_ns.is_some()))
    {
        return Err(RunnerError::Setup(
            "inconsistent cloud evaluation measurements".into(),
        ));
    }
    Ok(())
}

/// Only complete, mutually comparable trusted observations may produce a report.
pub fn finish_cloud(
    plan: &CloudPlan,
    observations: &[SealedObservation],
    artifacts: &Path,
    output: &Path,
) -> Result<RunReport> {
    plan.validate()?;
    if observations.len() != plan.module_hashes.len() {
        return Err(RunnerError::Setup("cloud observations incomplete".into()));
    }
    let mut ordered: Vec<_> = observations.iter().collect();
    ordered.sort_by_key(|o| o.observation.index);
    let plan_hash = ContentHash::of_json(plan)?;
    let env = ordered[0].observation.environment.clone();
    let env_hash = env.fingerprint()?;
    let mut expected_env = experiment::environment(&plan.config, 1)?;
    // Aggregation can occur on another host; evaluator source/runtime/config must match.
    expected_env.image = env.image.clone();
    expected_env.architecture = env.architecture.clone();
    if env != expected_env {
        return Err(RunnerError::Setup(
            "cloud evaluator version or configuration mismatch".into(),
        ));
    }
    let modules = plan
        .module_hashes
        .iter()
        .map(|hash| {
            let bytes = read_module(artifacts, Path::new(&format!("{}.wasm", hash.as_str())))?;
            if ContentHash::of_bytes(&bytes) != *hash {
                return Err(RunnerError::Setup("cloud artifact changed".into()));
            }
            Ok(bytes)
        })
        .collect::<Result<Vec<_>>>()?;
    let input_hash = ContentHash::of_json(&(&plan.config, &plan.module_hashes))?;
    let context = experiment::EvaluationContext {
        config: &plan.config,
        base_hash: &plan.module_hashes[0],
        env_hash: &env_hash,
        input_hash: &input_hash,
    };
    let mut results = Vec::new();
    for (index, ((sealed, spec), bytes)) in ordered
        .iter()
        .zip(std::iter::once(&plan.config.baseline).chain(&plan.config.candidates))
        .zip(&modules)
        .enumerate()
    {
        let obs = &sealed.observation;
        if sealed.content_hash != ContentHash::of_json(obs)?
            || obs.index as usize != index
            || obs.plan_hash != plan_hash
            || obs.module_hash != plan.module_hashes[index]
            || obs.environment != env
        {
            return Err(RunnerError::Setup(
                "cloud observation seal, task identity or environment mismatch".into(),
            ));
        }
        verify_evaluation(plan, &obs.evaluation)?;
        results.push(experiment::candidate_result(
            &context,
            spec,
            bytes,
            obs.evaluation.clone(),
            index == 0,
            obs.observed_at,
        )?);
    }
    experiment::finish_report(
        experiment::ReportContext {
            config: plan.config.clone(),
            requested_experiment: plan.requested_experiment.clone(),
            modules,
            results,
            env,
            jobs: 1,
            timestamp: ordered[0].observation.observed_at,
        },
        output,
    )
}
