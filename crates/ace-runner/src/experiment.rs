use crate::{sandbox, storage, *};
use ace_core::*;
use ace_policy::PolicyInput;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroU32,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CandidateResult {
    pub candidate: Candidate,
    pub evaluation: Evaluation,
    pub evidence: SealedEvidence,
    pub decision: PolicyDecision,
    pub is_baseline: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunReport {
    pub requested_experiment: ExperimentId,
    pub config: RunConfig,
    pub input_hash: ContentHash,
    pub environment: Environment,
    pub environment_hash: ContentHash,
    pub intent: Intent,
    pub experiment: Experiment,
    pub results: Vec<CandidateResult>,
    pub elites: BTreeSet<CandidateId>,
    pub baseline_champion: Option<Champion>,
    pub champion: Option<Champion>,
    pub knowledge: Knowledge,
    pub jobs: u32,
}

pub(crate) fn now() -> Timestamp {
    Timestamp(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is after epoch")
            .as_secs(),
    )
}
fn id_hash(value: &impl Serialize) -> Result<String> {
    Ok(ContentHash::of_json(value)?.as_str().into())
}
fn text(value: impl Into<String>) -> Text {
    Text::new(value).expect("nonempty runner text")
}
fn metric(name: &str) -> MetricName {
    MetricName::new(name).expect("runner metric identifier")
}
fn one() -> NonZeroU32 {
    NonZeroU32::new(1).unwrap()
}
fn artifact(hash: ContentHash) -> ArtifactRef {
    ArtifactRef {
        location: text(format!("artifacts/{}.wasm", hash.as_str())),
        hash,
    }
}

pub(crate) fn evalspec(config: &RunConfig) -> EvalSpec {
    EvalSpec {
        id: EvalSpecId::new(format!(
            "ES-local-gcd-{}",
            ContentHash::of_json(&config.harness)
                .expect("serializable harness")
                .as_str()
        ))
        .unwrap(),
        version: one(),
        oracle: VersionedOracle {
            id: OracleId::new("OR-gcd-v1").unwrap(),
            version: one(),
        },
        required_checks: ["contract", "isolation"]
            .into_iter()
            .map(|s| CheckName::new(s).unwrap())
            .collect(),
        hard_constraints: BTreeMap::from([
            (
                metric("correctness"),
                MetricConstraint {
                    comparison: Comparison::Equal,
                    value: FiniteNumber::new(1.0).unwrap(),
                    unit: text("fraction"),
                },
            ),
            (
                metric("linear_memory_bytes"),
                MetricConstraint {
                    comparison: Comparison::AtMost,
                    value: FiniteNumber::new(f64::from(config.harness.memory_pages) * 65536.0)
                        .unwrap(),
                    unit: text("bytes"),
                },
            ),
        ]),
        objectives: BTreeMap::from([
            (
                metric("mean_fuel"),
                Objective {
                    direction: Direction::Minimize,
                    unit: text("wasmi_fuel/call"),
                },
            ),
            (
                metric("linear_memory_bytes"),
                Objective {
                    direction: Direction::Minimize,
                    unit: text("bytes"),
                },
            ),
        ]),
    }
}

pub(crate) fn environment(config: &RunConfig, jobs: u32) -> Result<Environment> {
    let spec = evalspec(config);
    let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .unwrap_or_else(|_| std::env::consts::OS.into());
    let cpu = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let cpu = cpu
        .lines()
        .find(|s| s.starts_with("model name"))
        .unwrap_or(std::env::consts::ARCH);
    let host_hash = ContentHash::of_json(&(std::env::consts::OS, kernel.trim(), cpu, jobs))?;
    Ok(Environment {
        id: EnvironmentId::new("ENV-local-wasm").unwrap(),
        runtime: text(sandbox::RUNTIME_VERSION),
        image: ArtifactRef {
            location: text(format!("host://{}", std::env::consts::OS)),
            hash: host_hash,
        },
        architecture: text(std::env::consts::ARCH),
        dependency_locks: BTreeMap::from([
            (
                text("Cargo.lock"),
                ContentHash::of_bytes(include_bytes!("../../../Cargo.lock")),
            ),
            (
                text("runner-source"),
                ContentHash::of_json(&[
                    ContentHash::of_bytes(include_bytes!("config.rs")),
                    ContentHash::of_bytes(include_bytes!("sandbox.rs")),
                    ContentHash::of_bytes(include_bytes!("experiment.rs")),
                    ContentHash::of_bytes(include_bytes!("storage.rs")),
                    ContentHash::of_bytes(include_bytes!("distributed.rs")),
                ])?,
            ),
        ]),
        database_version: None,
        state_schema_version: None,
        dataset_hash: Some(ContentHash::of_json(&(
            &config.harness.public_cases,
            oracle_cases(&config.harness),
        ))?),
        traffic_profile_hash: None,
        configuration_hash: ContentHash::of_json(&(
            &config.harness,
            config.min_relative_improvement,
            config.max_wall_clock_seconds,
            jobs,
        ))?,
        feature_flags: BTreeMap::from([
            (text("no_host_imports"), true),
            (text("fuel_metering"), true),
            (text("debug_assertions"), cfg!(debug_assertions)),
        ]),
        model_versions: BTreeMap::new(),
        oracle: spec.oracle,
        evalspec: VersionedEvalSpec {
            id: spec.id,
            version: spec.version,
        },
    })
}

pub(crate) struct EvaluationContext<'a> {
    pub(crate) config: &'a RunConfig,
    pub(crate) base_hash: &'a ContentHash,
    pub(crate) env_hash: &'a ContentHash,
    pub(crate) input_hash: &'a ContentHash,
}

pub(crate) fn candidate_result(
    context: &EvaluationContext<'_>,
    module: &ModuleSpec,
    bytes: &[u8],
    evaluation: Evaluation,
    is_baseline: bool,
    timestamp: Timestamp,
) -> Result<CandidateResult> {
    let config = context.config;
    let base_hash = context.base_hash;
    let env_hash = context.env_hash;
    let input_hash = context.input_hash;
    let hash = ContentHash::of_bytes(bytes);
    let candidate = Candidate {
        id: module.id.clone(),
        parent: ChampionId::new(format!(
            "CH-base-{}",
            id_hash(&(base_hash, env_hash, &config.experiment))?
        ))?,
        base: artifact(base_hash.clone()),
        cell: config.cell.clone(),
        hypothesis: config.hypothesis.clone(),
        patch: artifact(hash),
        environment_hash: env_hash.clone(),
        provenance: Provenance {
            generator: module.generator.clone(),
            input_hash: input_hash.clone(),
            tool_versions: BTreeMap::from([
                (text("ace-runner"), text(env!("CARGO_PKG_VERSION"))),
                (text("wasmi"), text("2.0.0")),
            ]),
            parent_candidates: BTreeSet::new(),
            created_at: timestamp,
        },
    };
    let spec = evalspec(config);
    let qualified = evaluation.outcome == CandidateOutcome::Qualified;
    let incomplete = evaluation.outcome == CandidateOutcome::BudgetExhausted;
    let evaluator_error = evaluation.outcome == CandidateOutcome::EvaluatorError;
    let static_failure = evaluation.stage == EvaluationStage::L0 && !incomplete;
    let evaluation_artifact = ArtifactRef {
        location: text(format!("candidates/{}/evaluation.json", module.id)),
        hash: ContentHash::of_bytes(&canonical_json(&evaluation)?),
    };
    let mut measurements = BTreeMap::new();
    if qualified {
        for (name, value, unit) in [
            ("correctness", 1.0, "fraction"),
            (
                "linear_memory_bytes",
                evaluation.peak_linear_memory_bytes as f64,
                "bytes",
            ),
            (
                "mean_fuel",
                evaluation.mean_fuel.expect("qualified measurement").get(),
                "wasmi_fuel/call",
            ),
            (
                "median_call_ns",
                evaluation.median_call_ns.expect("qualified timing").get(),
                "ns",
            ),
        ] {
            measurements.insert(
                metric(name),
                Measurement {
                    value: FiniteNumber::new(value)?,
                    unit: text(unit),
                },
            );
        }
    }
    let evidence = Evidence {
        id: EvidenceId::new(format!(
            "EV-{}",
            id_hash(&(
                config.experiment.clone(),
                &module.id,
                env_hash,
                &evaluation,
                timestamp
            ))?
        ))?,
        experiment: config.experiment.clone(),
        candidate: module.id.clone(),
        cell: config.cell.clone(),
        environment_hash: env_hash.clone(),
        evalspec: VersionedEvalSpec {
            id: spec.id.clone(),
            version: spec.version,
        },
        measurements,
        checks: BTreeMap::from([
            (
                CheckName::new("contract")?,
                if incomplete {
                    CheckOutcome::NotRun
                } else if static_failure {
                    CheckOutcome::Failed
                } else {
                    CheckOutcome::Passed
                },
            ),
            (CheckName::new("isolation")?, CheckOutcome::Passed),
        ]),
        oracle: OracleResult {
            oracle: spec.oracle.clone(),
            outcome: if qualified {
                CheckOutcome::Passed
            } else if evaluation.outcome == CandidateOutcome::FailedCorrectness {
                CheckOutcome::Failed
            } else {
                CheckOutcome::NotRun
            },
            output: if qualified || evaluation.outcome == CandidateOutcome::FailedCorrectness {
                Some(evaluation_artifact.clone())
            } else {
                None
            },
        },
        evaluator: EvaluatorResult {
            stage: evaluation.stage,
            outcome: if evaluator_error {
                CheckOutcome::Error
            } else if incomplete {
                CheckOutcome::NotRun
            } else if qualified
                || static_failure
                || evaluation.outcome == CandidateOutcome::FailedCorrectness
            {
                CheckOutcome::Passed
            } else {
                CheckOutcome::Failed
            },
            version: text(sandbox::RUNTIME_VERSION),
            output: Some(evaluation_artifact),
        },
        fast_judge: None,
        created_at: timestamp,
    };
    let evidence = SealedEvidence::new(evidence)?;
    let decision = ace_policy::evaluate(&PolicyInput {
        cell: config.cell.clone(),
        candidate: module.id.clone(),
        experiment: config.experiment.clone(),
        environment_hash: env_hash.clone(),
        evalspec: spec,
        evidence: evidence.clone(),
        decided_at: timestamp,
    })?;
    Ok(CandidateResult {
        candidate,
        evaluation,
        evidence,
        decision,
        is_baseline,
    })
}

/// Deterministic Pareto frontier (fuel and peak linear memory), with stable ID ties.
/// Retain the known baseline unless a qualifying candidate meets the configured
/// fuel improvement and does not regress linear memory.
pub fn select(
    results: &[CandidateResult],
    min_improvement: Probability,
) -> (BTreeSet<CandidateId>, Option<CandidateId>) {
    let qualified: Vec<_> = results
        .iter()
        .filter(|r| {
            r.decision.decision == Decision::Elite
                && r.evaluation.outcome == CandidateOutcome::Qualified
                && r.evaluation.mean_fuel.is_some()
        })
        .collect();
    let elites = qualified
        .iter()
        .filter(|current| {
            !qualified.iter().any(|other| {
                let a = &other.evaluation;
                let b = &current.evaluation;
                let af = a.mean_fuel.unwrap().get();
                let bf = b.mean_fuel.unwrap().get();
                af <= bf
                    && a.peak_linear_memory_bytes <= b.peak_linear_memory_bytes
                    && (af < bf || a.peak_linear_memory_bytes < b.peak_linear_memory_bytes)
            })
        })
        .map(|r| r.candidate.id.clone())
        .collect();
    let Some(baseline) = qualified.iter().find(|r| r.is_baseline) else {
        return (elites, None);
    };
    let base = baseline.evaluation.mean_fuel.unwrap().get();
    let mut eligible: Vec<_> = qualified
        .iter()
        .filter(|r| {
            !r.is_baseline
                && r.evaluation.peak_linear_memory_bytes
                    <= baseline.evaluation.peak_linear_memory_bytes
                && r.evaluation.mean_fuel.unwrap().get() < base
                && (base - r.evaluation.mean_fuel.unwrap().get()) / base >= min_improvement.get()
        })
        .collect();
    eligible.sort_by(|a, b| {
        a.evaluation
            .mean_fuel
            .unwrap()
            .get()
            .total_cmp(&b.evaluation.mean_fuel.unwrap().get())
            .then(a.candidate.id.cmp(&b.candidate.id))
    });
    let champion = eligible
        .first()
        .map_or(baseline, |r| r)
        .candidate
        .id
        .clone();
    (elites, Some(champion))
}

pub fn run(directory: &Path, output: &Path, jobs: u32) -> Result<RunReport> {
    if !(1..=8).contains(&jobs) {
        return Err(RunnerError::Setup("jobs must be between 1 and 8".into()));
    }
    if output.exists() {
        return Err(RunnerError::Setup(
            "run output already exists; choose a new directory".into(),
        ));
    }
    let mut config = load_config(directory)?;
    let requested_experiment = config.experiment.clone();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos()
        .to_string();
    config.experiment =
        ExperimentId::new(format!("EXP-{}", id_hash(&(&requested_experiment, nonce))?))?;
    let modules: Vec<_> = std::iter::once(&config.baseline)
        .chain(&config.candidates)
        .map(|module| read_module(directory, &module.module))
        .collect::<Result<_>>()?;
    let timestamp = now();
    let input_hash = ContentHash::of_json(&(
        &config,
        modules
            .iter()
            .map(|b| ContentHash::of_bytes(b))
            .collect::<Vec<_>>(),
    ))?;
    let env = environment(&config, jobs)?;
    let env_hash = env.fingerprint()?;
    let deadline = sandbox::deadline(config.max_wall_clock_seconds);
    let baseline = sandbox::evaluate_module(&modules[0], &config.harness, deadline);
    let evaluations = Mutex::new(vec![None; config.candidates.len()]);
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..jobs {
            let evaluations = &evaluations;
            let next = &next;
            let modules = &modules;
            let harness = &config.harness;
            scope.spawn(move || {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    if index >= modules.len() - 1 {
                        break;
                    }
                    let result = sandbox::evaluate_module(&modules[index + 1], harness, deadline);
                    evaluations.lock().expect("worker results mutex")[index] = Some(result);
                }
            });
        }
    });
    let workers = evaluations.into_inner().expect("worker results mutex");
    // Worker results remain in input order, independent of scheduling.
    let evaluations =
        std::iter::once(baseline).chain(workers.into_iter().map(|r| r.expect("worker completed")));
    let base_hash = ContentHash::of_bytes(&modules[0]);
    let context = EvaluationContext {
        config: &config,
        base_hash: &base_hash,
        env_hash: &env_hash,
        input_hash: &input_hash,
    };
    let results = std::iter::once(&config.baseline)
        .chain(&config.candidates)
        .zip(&modules)
        .zip(evaluations)
        .enumerate()
        .map(|(index, ((module, bytes), evaluation))| {
            candidate_result(&context, module, bytes, evaluation, index == 0, now())
        })
        .collect::<Result<Vec<_>>>()?;
    finish_report(
        ReportContext {
            config,
            requested_experiment,
            modules,
            results,
            env,
            jobs,
            timestamp,
        },
        output,
    )
}

pub(crate) struct ReportContext {
    pub config: RunConfig,
    pub requested_experiment: ExperimentId,
    pub modules: Vec<Vec<u8>>,
    pub results: Vec<CandidateResult>,
    pub env: Environment,
    pub jobs: u32,
    pub timestamp: Timestamp,
}

pub(crate) fn finish_report(context: ReportContext, output: &Path) -> Result<RunReport> {
    let ReportContext {
        config,
        requested_experiment,
        modules,
        results,
        env,
        jobs,
        timestamp,
    } = context;
    let env_hash = env.fingerprint()?;
    let input_hash = ContentHash::of_json(&(
        &config,
        modules
            .iter()
            .map(|b| ContentHash::of_bytes(b))
            .collect::<Vec<_>>(),
    ))?;
    let (elites, selected) = select(&results, config.min_relative_improvement);
    let baseline_champion = if results[0].decision.decision == Decision::Elite {
        Some(Champion {
            id: results[0].candidate.parent.clone(),
            cell: config.cell.clone(),
            candidate: config.baseline.id.clone(),
            artifact: results[0].candidate.patch.clone(),
            environment_hash: env_hash.clone(),
            evalspec: env.evalspec.clone(),
            oracle: env.oracle.clone(),
            qualification_evidence: BTreeSet::from([results[0].evidence.evidence().id.clone()]),
            policy_version: text("ace-local-baseline-qualification-v1"),
            qualified_at: now(),
        })
    } else {
        None
    };
    let champion = selected
        .map(|id| {
            let result = results
                .iter()
                .find(|r| r.candidate.id == id)
                .expect("selected candidate exists");
            Ok::<_, RunnerError>(Champion {
                id: ChampionId::new(format!(
                    "CH-{}",
                    id_hash(&(&config.experiment, &id, &env_hash))?
                ))?,
                cell: config.cell.clone(),
                candidate: id,
                artifact: result.candidate.patch.clone(),
                environment_hash: env_hash.clone(),
                evalspec: env.evalspec.clone(),
                oracle: env.oracle.clone(),
                qualification_evidence: BTreeSet::from([result.evidence.evidence().id.clone()]),
                policy_version: text("ace-local-selection-v1"),
                qualified_at: now(),
            })
        })
        .transpose()?;
    let claims = results.iter().map(|result| {
        let module = std::iter::once(&config.baseline).chain(&config.candidates)
            .find(|m| m.id == result.candidate.id).expect("registered candidate");
        let passed = result.evaluation.outcome == CandidateOutcome::Qualified;
        let unrun = matches!(result.evaluation.outcome, CandidateOutcome::BudgetExhausted | CandidateOutcome::EvaluatorError);
        let statement = if passed {
            format!("Strategy {} passed {} checked calls; measured mean WASMI fuel was {} per workload call",
                module.strategy.as_str(), result.evaluation.checked_calls, result.evaluation.mean_fuel.unwrap().get())
        } else { format!("Strategy {}: {}", module.strategy.as_str(), result.evaluation.reason.as_str()) };
        Ok::<_, RunnerError>(Claim {
            id: ClaimId::new(format!("CL-{}", id_hash(&result.evidence.evidence().id)?))?, statement: text(statement),
            status: if passed { ClaimStatus::Proven } else if unrun { ClaimStatus::Open } else { ClaimStatus::Rejected },
            supporting_evidence: if passed { BTreeSet::from([result.evidence.evidence().id.clone()]) } else { BTreeSet::new() },
            contradicting_evidence: if !passed && !unrun { BTreeSet::from([result.evidence.evidence().id.clone()]) } else { BTreeSet::new() },
            scope: text("Only this recorded GCD workload and WASMI environment; not proof over every input"),
            confidence: Probability::new(if unrun { 0.0 } else { 1.0 })?, environment_hash: env_hash.clone(),
            created_at: now(), superseded_by: None,
        })
    }).collect::<Result<Vec<_>>>()?;
    let knowledge = Knowledge {
        id: KnowledgeId::new(format!("K-{}", id_hash(&(&config.experiment, &env_hash))?))?,
        cell: config.cell.clone(),
        version: one(),
        parents: BTreeSet::new(),
        claims,
        agent_summary: text(format!(
            "{} registered modules evaluated; {} Pareto elites; local Champion: {}",
            results.len(),
            elites.len(),
            champion
                .as_ref()
                .map(|c| c.candidate.as_str())
                .unwrap_or("none: baseline did not qualify")
        )),
        created_at: now(),
    };
    let spec = evalspec(&config);
    let intent = Intent {
        id: config.intent.clone(),
        cell: config.cell.clone(),
        objective: text(
            "Minimize measured WASMI instruction fuel while preserving mathematical GCD outputs",
        ),
        evalspec: spec,
        budget: Budget {
            max_candidates: NonZeroU32::new(config.candidates.len() as u32).unwrap(),
            max_wall_clock_seconds: NonZeroU32::new(config.max_wall_clock_seconds).unwrap(),
            max_compute_usd: FiniteNumber::new(0.0)?,
        },
        stop: StopPolicy {
            min_relative_improvement: config.min_relative_improvement,
            generations_without_material_gain: one(),
        },
    };
    let experiment = Experiment {
        id: config.experiment.clone(),
        cell: config.cell.clone(),
        intent: config.intent.clone(),
        hypothesis: config.hypothesis.clone(),
        parent_knowledge: None,
        candidates: results.iter().map(|r| r.candidate.id.clone()).collect(),
        environment_hash: env_hash.clone(),
        evalspec: env.evalspec.clone(),
        oracle: env.oracle.clone(),
        status: if results.iter().any(|r| {
            matches!(
                r.evaluation.outcome,
                CandidateOutcome::BudgetExhausted | CandidateOutcome::EvaluatorError
            )
        }) {
            ExperimentStatus::Stopped
        } else {
            ExperimentStatus::Completed
        },
        evidence: results
            .iter()
            .map(|r| r.evidence.evidence().id.clone())
            .collect(),
        created_at: timestamp,
    };
    let report = RunReport {
        requested_experiment,
        config,
        input_hash,
        environment: env,
        environment_hash: env_hash,
        intent,
        experiment,
        results,
        elites,
        baseline_champion,
        champion,
        knowledge,
        jobs,
    };
    storage::persist(output, &report, &modules)?;
    Ok(report)
}
