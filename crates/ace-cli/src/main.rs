use ace_core::*;
use ace_protocol::{Document, Envelope};
use clap::{Parser, Subcommand};
use std::{
    error::Error,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

mod evolve;
mod generate;
mod mcp;

#[derive(Parser)]
#[command(
    name = "ace",
    version,
    about = "ACE: domain documents, isolated local experiments and evidence"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Serve local ACE tools over MCP stdio inside an explicit workspace.
    Mcp {
        #[arg(long)]
        workspace: PathBuf,
    },
    /// Run successive offline generations, carrying verified Champions and Knowledge.
    Evolve {
        #[arg(default_value = "ace-evolution")]
        directory: PathBuf,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 24, value_parser = clap::value_parser!(u32).range(4..=100))]
        candidates: u32,
        #[arg(long, default_value_t = 4, value_parser = clap::value_parser!(u32).range(1..=16))]
        generations: u32,
        #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u32).range(1..=8))]
        jobs: u32,
        /// Stop after this many consecutive generations without a qualified improvement.
        #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u32).range(1..=16))]
        patience: u32,
        #[arg(long)]
        json: bool,
    },
    /// Verify an evolution campaign's run evidence, Champion lineage and Knowledge graph.
    History { directory: PathBuf },
    /// Generate candidates and execute a complete offline experiment.
    Demo {
        #[arg(default_value = "ace-demo")]
        directory: PathBuf,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 12, value_parser = clap::value_parser!(u32).range(4..=100))]
        candidates: u32,
        #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u32).range(1..=8))]
        jobs: u32,
        /// Emit the normal machine-readable run summary.
        #[arg(long)]
        json: bool,
    },
    /// Create a reproducible GCD candidate population without external tools.
    Generate {
        directory: PathBuf,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 12, value_parser = clap::value_parser!(u32).range(4..=100))]
        candidates: u32,
    },
    /// Advisory fast-judge routing and calibration; never qualifies or promotes.
    Judge {
        #[command(subcommand)]
        command: JudgeCommand,
    },
    /// Frozen task protocol for the trusted Cloudflare control plane.
    Cloud {
        #[command(subcommand)]
        command: CloudCommand,
    },
    /// Execute precompiled WASM candidates with an independent local GCD oracle.
    Run {
        directory: PathBuf,
        #[arg(long)]
        output: Option<PathBuf>,
        #[arg(long, default_value_t = 1)]
        jobs: u32,
    },
    /// Verify a saved run and show its population, elites and local Champion.
    Status { run: PathBuf },
    /// Show the qualified local Champion; no production deployment is performed.
    Champion { run: PathBuf },
    /// Show the structured learning derived from a completed local experiment.
    Knowledge { run: PathBuf },
    /// Explain a candidate's measured outcome and deterministic policy decision.
    Explain {
        run: PathBuf,
        candidate: CandidateId,
    },
    /// Re-execute a frozen candidate and compare outputs and fuel with its original run.
    Replay {
        run: PathBuf,
        candidate: CandidateId,
    },
    /// Initialize local project metadata without overwriting an existing project.
    Init {
        path: PathBuf,
        #[arg(long)]
        id: ProjectId,
        #[arg(long)]
        name: String,
    },
    /// Validate a versioned domain document and its local semantic invariants.
    Validate { file: PathBuf },
    /// Print the domain-separated hash of a validated document envelope.
    Hash { file: PathBuf },
    /// Generate JSON schemas, or compare them with committed schemas.
    Schema {
        #[arg(long, default_value = "schemas")]
        out: PathBuf,
        #[arg(long)]
        check: bool,
    },
    /// Evaluate trusted policy input; does not promote or deploy a candidate.
    Policy { file: PathBuf },
    /// Seal, persist, or retrieve immutable local evidence.
    Evidence {
        #[command(subcommand)]
        command: EvidenceCommand,
    },
}

#[derive(Subcommand)]
enum JudgeCommand {
    /// Show the versioned default shadow policy.
    Policy,
    /// Route a retained inference against the exact public context bytes.
    Route {
        context: PathBuf,
        attempt: PathBuf,
        #[arg(long)]
        policy: Option<PathBuf>,
    },
    /// Summarize evidence-linked labels and hypothetical filtering errors.
    Calibrate {
        file: PathBuf,
        #[arg(long)]
        policy: Option<PathBuf>,
        /// Verify ground truth against complete sealed runs (repeatable).
        #[arg(long = "run")]
        runs: Vec<PathBuf>,
    },
    /// Compare bypass, L1a and L1a+L1b using the same frozen execution labels.
    Compare {
        file: PathBuf,
        #[arg(long)]
        policy: Option<PathBuf>,
        #[arg(long = "run")]
        runs: Vec<PathBuf>,
    },
}

#[derive(Subcommand)]
enum CloudCommand {
    Prepare {
        directory: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    Evaluate {
        plan: PathBuf,
        #[arg(long)]
        index: u32,
        #[arg(long)]
        module: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    Finish {
        plan: PathBuf,
        #[arg(long)]
        observations: PathBuf,
        #[arg(long)]
        artifacts: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
}

#[derive(Subcommand)]
enum EvidenceCommand {
    /// Read a raw Evidence JSON object and emit a sealed versioned document.
    Seal { file: PathBuf },
    /// Persist a sealed evidence document; different content under the same ID is rejected.
    Record {
        file: PathBuf,
        #[arg(long, default_value = ".")]
        project: PathBuf,
    },
    /// Retrieve evidence and verify its seal before printing it.
    Show {
        id: EvidenceId,
        #[arg(long, default_value = ".")]
        project: PathBuf,
    },
}

fn main() {
    if let Err(error) = run(Cli::parse()) {
        eprintln!("ace: {error}");
        std::process::exit(1);
    }
}

fn read_document(path: &Path) -> Result<Envelope> {
    Ok(ace_protocol::decode(&fs::read(path)?)?)
}
fn json(value: &impl serde::Serialize) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn print(value: &impl serde::Serialize) -> Result<()> {
    std::io::stdout().lock().write_all(&json(value)?)?;
    Ok(())
}

/// Publish a complete file atomically, with no replacement of an existing name.
fn create_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("output has no parent")?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist_noclobber(path)?;
    Ok(())
}

fn ensure_project(project: &Path) -> Result<()> {
    let document = read_document(&project.join(".ace/project.json"))?;
    if !matches!(document.payload, Document::Project(_)) {
        return Err("invalid project metadata".into());
    }
    Ok(())
}

fn evidence_path(project: &Path, id: &EvidenceId) -> PathBuf {
    project.join(".ace/evidence").join(format!("{id}.json"))
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Mcp { workspace } => mcp::serve(&workspace)?,
        Command::Evolve {
            directory,
            seed,
            candidates,
            generations,
            jobs,
            patience,
            json,
        } => {
            let campaign = evolve::run(&directory, seed, candidates, generations, jobs, patience)?;
            if json {
                print(&campaign)?;
            } else {
                evolve::print_campaign(&directory, &campaign)?;
            }
        }
        Command::History { directory } => print(&evolve::load(&directory)?)?,
        Command::Generate {
            directory,
            seed,
            candidates,
        } => {
            print(&generate::population(&directory, seed, candidates)?)?;
        }
        Command::Demo {
            directory,
            seed,
            candidates,
            jobs,
            json,
        } => {
            generate::population(&directory, seed, candidates)?;
            let output = directory.join("run");
            let report = ace_runner::run(&directory, &output, jobs)?;
            let verified = ace_runner::load_report(&output)?;
            generate::verify_controls(&verified)?;
            if report != verified {
                return Err("demo output failed independent saved-run verification".into());
            }
            if json {
                print_summary(&output, &verified)?;
            } else {
                generate::print_demo(&output, &verified)?;
            }
        }
        Command::Judge { command } => match command {
            JudgeCommand::Policy => print(&ace_eval::RoutingPolicy::default())?,
            JudgeCommand::Route {
                context,
                attempt,
                policy,
            } => {
                let bytes = bounded_bytes(&context, 32_768)?;
                let context: ace_eval::JudgeContext =
                    serde_json::from_value(ace_protocol::parse_json(&bytes)?)?;
                let attempt: ace_eval::JudgeAttempt = read_judge_json(&attempt)?;
                attempt.validate()?;
                let input_hash = ContentHash::of_bytes(&bytes);
                if attempt.input_hash != input_hash {
                    return Err("judge input bytes fingerprint mismatch".into());
                }
                let policy = judge_policy(policy)?;
                print(&ace_eval::route(
                    &context,
                    &input_hash,
                    attempt.result.as_ref(),
                    attempt.fault,
                    &policy,
                )?)?;
            }
            JudgeCommand::Calibrate { file, policy, runs } => {
                let dataset: ace_eval::CalibrationDataset = read_judge_json(&file)?;
                verify_calibration_labels(&dataset, &runs)?;
                print(&ace_eval::calibrate(&dataset, &judge_policy(policy)?)?)?;
            }
            JudgeCommand::Compare { file, policy, runs } => {
                let dataset: ace_eval::ComparisonDataset = read_judge_json(&file)?;
                dataset.validate()?;
                verify_calibration_labels(&dataset.first_stage, &runs)?;
                print(&ace_eval::compare(&dataset, &judge_policy(policy)?)?)?;
            }
        },
        Command::Cloud { command } => match command {
            CloudCommand::Prepare { directory, output } => {
                print(&ace_runner::prepare_cloud(&directory, &output)?)?;
            }
            CloudCommand::Evaluate {
                plan,
                index,
                module,
                output,
            } => {
                let plan = ace_runner::read_cloud_json(&plan)?;
                use std::io::Read;
                let mut bytes = Vec::new();
                fs::File::open(module)?
                    .take(1_048_577)
                    .read_to_end(&mut bytes)?;
                create_atomic(
                    &output,
                    &json(&ace_runner::evaluate_cloud(&plan, index, &bytes)?)?,
                )?;
            }
            CloudCommand::Finish {
                plan,
                observations,
                artifacts,
                output,
            } => {
                let plan: ace_runner::CloudPlan = ace_runner::read_cloud_json(&plan)?;
                let observations = (0..plan.module_hashes.len())
                    .map(|i| ace_runner::read_cloud_json(&observations.join(format!("{i}.json"))))
                    .collect::<ace_runner::Result<Vec<ace_runner::SealedObservation>>>()?;
                let report = ace_runner::finish_cloud(&plan, &observations, &artifacts, &output)?;
                print_summary(&output, &report)?;
            }
        },
        Command::Run {
            directory,
            output,
            jobs,
        } => {
            let output = output.unwrap_or_else(|| {
                PathBuf::from(".ace/runs").join(format!(
                    "run-{}",
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .expect("system time")
                        .as_nanos()
                ))
            });
            let report = ace_runner::run(&directory, &output, jobs)?;
            print_summary(&output, &report)?;
        }
        Command::Status { run } => print_summary(&run, &ace_runner::load_report(&run)?)?,
        Command::Champion { run } => {
            let report = ace_runner::load_report(&run)?;
            let champion = report
                .champion
                .ok_or("no Champion: baseline did not qualify")?;
            print(&Envelope::new(Document::Champion(champion)))?;
        }
        Command::Knowledge { run } => print(&Envelope::new(Document::Knowledge(
            ace_runner::load_report(&run)?.knowledge,
        )))?,
        Command::Explain { run, candidate } => {
            let report = ace_runner::load_report(&run)?;
            let result = report
                .results
                .iter()
                .find(|r| r.candidate.id == candidate)
                .ok_or("candidate not in this run")?;
            print(result)?;
        }
        Command::Replay { run, candidate } => {
            let report = ace_runner::replay(&run, &candidate)?;
            print(&report)?;
            if !report.matched {
                return Err("replay did not match original deterministic observations".into());
            }
        }
        Command::Init { path, id, name } => {
            let project = Project {
                id,
                name: Text::new(name)?,
                created_at: Timestamp(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs()),
            };
            let document = Envelope::new(Document::Project(project));
            create_atomic(&path.join(".ace/project.json"), &json(&document)?)?;
            print(&document)?;
        }
        Command::Validate { file } => {
            let document = read_document(&file)?;
            println!("valid {}", document.content_hash()?.as_str());
        }
        Command::Hash { file } => println!("{}", read_document(&file)?.content_hash()?.as_str()),
        Command::Schema { out, check } => {
            let mut schemas = ace_protocol::schemas()?;
            schemas.extend(ace_runner::runner_schemas()?);
            schemas.extend(ace_eval::schemas()?);
            schemas.insert(
                "generation.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(generate::Generation))?,
            );
            schemas.insert(
                "evolution.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(evolve::Campaign))?,
            );
            for (name, schema) in schemas {
                let path = out.join(name);
                let expected = json(&schema)?;
                if check {
                    if fs::read(&path)? != expected {
                        return Err(format!("schema differs: {}", path.display()).into());
                    }
                } else {
                    fs::create_dir_all(&out)?;
                    fs::write(path, expected)?;
                }
            }
            println!("schemas {}", if check { "match" } else { "generated" });
        }
        Command::Policy { file } => {
            let document = read_document(&file)?;
            let Document::PolicyInput(input) = document.payload else {
                return Err("expected policy_input document".into());
            };
            print(&Envelope::new(Document::PolicyDecision(
                ace_policy::evaluate(&input)?,
            )))?;
        }
        Command::Evidence { command } => match command {
            EvidenceCommand::Seal { file } => {
                let evidence: Evidence =
                    serde_json::from_value(ace_protocol::parse_json(&fs::read(file)?)?)?;
                print(&Envelope::new(Document::Evidence(
                    SealedEvidence::new(evidence)?.into(),
                )))?;
            }
            EvidenceCommand::Record { file, project } => {
                ensure_project(&project)?;
                let document = read_document(&file)?;
                let Document::Evidence(evidence) = &document.payload else {
                    return Err("expected evidence document".into());
                };
                let path = evidence_path(&project, &evidence.evidence().id);
                match create_atomic(&path, &json(&document)?) {
                    Ok(()) => (),
                    Err(error) => {
                        // Identical content is idempotent; corrupted or conflicting content is not.
                        if !path.is_file() || read_document(&path)? != document {
                            return Err(error);
                        }
                    }
                }
                println!("{}", evidence.content_hash().as_str());
            }
            EvidenceCommand::Show { id, project } => {
                ensure_project(&project)?;
                let document = read_document(&evidence_path(&project, &id))?;
                let Document::Evidence(evidence) = &document.payload else {
                    return Err("stored file is not evidence".into());
                };
                if evidence.evidence().id != id {
                    return Err("stored evidence ID mismatch".into());
                }
                print(&document)?;
            }
        },
    }
    Ok(())
}

fn bounded_bytes(path: &Path, limit: u64) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err("judge JSON exceeds byte budget".into());
    }
    Ok(bytes)
}

fn read_judge_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    Ok(serde_json::from_value(ace_protocol::parse_json(
        &bounded_bytes(path, 8_388_608)?,
    )?)?)
}

fn judge_policy(path: Option<PathBuf>) -> Result<ace_eval::RoutingPolicy> {
    let policy = match path {
        Some(path) => read_judge_json(&path)?,
        None => ace_eval::RoutingPolicy::default(),
    };
    policy.validate()?;
    Ok(policy)
}

fn verify_calibration_labels(
    dataset: &ace_eval::CalibrationDataset,
    runs: &[PathBuf],
) -> Result<()> {
    if runs.is_empty() {
        if !dataset.synthetic_predictions {
            return Err("live calibration requires --run evidence verification".into());
        }
        return Ok(());
    }
    let reports = runs
        .iter()
        .map(|p| ace_runner::load_report(p))
        .collect::<ace_runner::Result<Vec<_>>>()?;
    for row in &dataset.rows {
        let report = reports
            .iter()
            .find(|r| r.experiment.id == row.context.experiment)
            .ok_or("calibration source run missing")?;
        let candidate = report
            .results
            .iter()
            .find(|r| r.candidate.id == row.context.candidate)
            .ok_or("calibration candidate missing from source run")?;
        let label = match candidate.evaluation.outcome {
            ace_runner::CandidateOutcome::Qualified => ace_eval::CalibrationLabel::Qualified,
            ace_runner::CandidateOutcome::FailedCorrectness => {
                ace_eval::CalibrationLabel::CorrectnessFailure
            }
            ace_runner::CandidateOutcome::FailedResourceLimit => {
                ace_eval::CalibrationLabel::ResourceFailure
            }
            ace_runner::CandidateOutcome::FailedContract
            | ace_runner::CandidateOutcome::InvalidModule => {
                ace_eval::CalibrationLabel::ContractFailure
            }
            _ => ace_eval::CalibrationLabel::InfrastructureFailure,
        };
        let winner = report
            .champion
            .as_ref()
            .is_some_and(|c| c.candidate == row.context.candidate);
        if row.label != label
            || row.winner != winner
            || row.context.artifact_hash != candidate.candidate.patch.hash
            || row.evidence.experiment != report.experiment.id
            || row.evidence.evidence != candidate.evidence.evidence().id
            || &row.evidence.content_hash != candidate.evidence.content_hash()
        {
            return Err("calibration ground truth differs from sealed source evidence".into());
        }
    }
    Ok(())
}

fn print_summary(path: &Path, report: &ace_runner::RunReport) -> Result<()> {
    print(&summary(path, report))
}

fn summary(path: &Path, report: &ace_runner::RunReport) -> serde_json::Value {
    serde_json::json!({
        "run": path,
        "experiment": report.experiment.id,
        "requested_experiment": report.requested_experiment,
        "status": report.experiment.status,
        "champion": report.champion.as_ref().map(|c| &c.candidate),
        "elites": report.elites,
        "candidates": report.results.iter().map(|r| serde_json::json!({
            "id": r.candidate.id, "baseline": r.is_baseline,
            "outcome": r.evaluation.outcome, "reason": r.evaluation.reason,
            "mean_fuel": r.evaluation.mean_fuel, "median_call_ns": r.evaluation.median_call_ns,
        })).collect::<Vec<_>>()
    })
}
