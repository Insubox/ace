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

fn parse_content_hash(value: &str) -> std::result::Result<ContentHash, String> {
    ContentHash::try_from(value.to_owned()).map_err(|e| e.to_string())
}

mod agent;
mod archive;
mod evolve;
mod generate;
mod history;
mod inspect;
mod mcp;
mod memory;
mod observatory;
mod proposal;
mod source;
mod store;
mod verify;

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
    /// ACE's native version engine: capture, verify, restore and copy source/learning.
    Store {
        #[command(subcommand)]
        command: StoreCommand,
    },
    /// Export a verified run as an interactive offline HTML inspector.
    Inspect {
        run: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Retrieve bounded, verified positive and negative learning for an exact run profile.
    Memory {
        repository: PathBuf,
        #[arg(long)]
        baseline_run: PathBuf,
        #[arg(long, default_value_t = 16)]
        limit: usize,
    },
    /// Start a bounded campaign for an external agent; validates and archives its baseline.
    AgentStart {
        directory: PathBuf,
        #[arg(long)]
        campaign: CheckName,
        #[arg(long)]
        baseline_run: PathBuf,
        #[arg(long, conflicts_with = "store", required_unless_present = "store")]
        repository: Option<PathBuf>,
        #[arg(
            long,
            conflicts_with = "repository",
            required_unless_present = "repository"
        )]
        store: Option<PathBuf>,
        #[arg(long, default_value_t = 4)]
        rounds: u32,
        #[arg(long, default_value_t = 2)]
        candidates: u32,
        #[arg(long, default_value_t = 3)]
        attempts: u32,
        #[arg(long, default_value_t = 2)]
        patience: u32,
        #[arg(long, default_value_t = 2)]
        jobs: u32,
    },
    /// Freeze the next public task, including winner source and evidence-linked learning.
    AgentNext { directory: PathBuf },
    /// Evaluate proposals for the frozen task, archive all learning and advance the campaign.
    AgentSubmit { directory: PathBuf, file: PathBuf },
    /// Record a generator fault without assigning a candidate correctness label.
    AgentFault { directory: PathBuf, file: PathBuf },
    /// Verify an agent campaign's task, evidence, source and ancestry receipts.
    AgentStatus { directory: PathBuf },
    /// Commit a verified run, winner source and all learning to a dedicated local Git repository.
    Archive {
        run: PathBuf,
        #[arg(long)]
        repository: PathBuf,
    },
    /// Verify committed archive snapshots, winner sources and evidence-backed learning.
    ArchiveStatus { repository: PathBuf },
    /// Assemble and register agent-authored WAT proposals; does not qualify them.
    Propose {
        file: PathBuf,
        #[arg(long)]
        output: PathBuf,
        /// Use a verified previous Champion as baseline and preserve its evaluation profile.
        #[arg(long)]
        baseline_run: Option<PathBuf>,
    },
    /// Verify registered agent proposals and their source-to-WASM hashes.
    ProposalStatus { directory: PathBuf },
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
        /// Archive each completed generation in a dedicated local Git repository.
        #[arg(long, conflicts_with = "store")]
        git_repository: Option<PathBuf>,
        /// Retain each evaluated generation in ACE's native version engine.
        #[arg(long, conflicts_with = "git_repository")]
        store: Option<PathBuf>,
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
enum StoreCommand {
    /// Save a verified evaluated version, its source and learning without Git.
    Save {
        run: PathBuf,
        #[arg(long)]
        store: PathBuf,
    },
    /// Capture explicitly listed regular files in a native source version.
    Commit {
        source: PathBuf,
        #[arg(long)]
        store: PathBuf,
        #[arg(long)]
        files: PathBuf,
        #[arg(long)]
        message: String,
        #[arg(long, value_parser = parse_content_hash)]
        parent: Vec<ContentHash>,
    },
    /// Import another verified store without rewriting immutable version identities.
    Fetch {
        source: PathBuf,
        destination: PathBuf,
    },
    /// List verified native branch heads and their compare-and-swap history.
    Refs { store: PathBuf },
    /// Create or advance a branch with an explicit previous-head expectation.
    Branch {
        store: PathBuf,
        name: String,
        #[arg(value_parser=parse_content_hash)]
        target: ContentHash,
        #[arg(long,value_parser=parse_content_hash)]
        expect: Option<ContentHash>,
    },
    /// Compare exact files and bounded line edits between two native versions.
    Diff {
        #[arg(value_parser=parse_content_hash)]
        left: ContentHash,
        #[arg(value_parser=parse_content_hash)]
        right: ContentHash,
        #[arg(long)]
        store: PathBuf,
    },
    /// Three-way merge source into a fresh preview; preserve conflicts explicitly.
    Merge {
        #[arg(value_parser=parse_content_hash)]
        ours: ContentHash,
        #[arg(value_parser=parse_content_hash)]
        theirs: ContentHash,
        #[arg(long)]
        store: PathBuf,
        #[arg(long,value_parser=parse_content_hash)]
        base: Option<ContentHash>,
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        message: String,
    },
    /// Verify native objects, version ancestry, journal, winner source and learning.
    Log { store: PathBuf },
    /// Restore an exact native version into a fresh directory.
    Checkout {
        #[arg(value_parser = parse_content_hash)]
        version: ContentHash,
        #[arg(long)]
        store: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Copy verified native history and content objects into a fresh store.
    Clone {
        source: PathBuf,
        destination: PathBuf,
    },
    /// Optionally export evaluated versions/faults to a fresh dedicated Git repository.
    ExportGit {
        store: PathBuf,
        #[arg(long)]
        repository: PathBuf,
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
    /// Assemble one Observatory proposal with a fixed server-selected profile.
    PrepareTrial {
        request: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Freeze complete server-produced evidence and source in a native snapshot.
    ArchiveTrial {
        run: PathBuf,
        #[arg(long)]
        prepared: PathBuf,
        #[arg(long)]
        store: PathBuf,
    },
    /// Validate native source/evidence and reproduce deterministic observations on this host.
    VerifySnapshot {
        snapshot: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
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
    Ok(ace_protocol::decode(&bounded_bytes(path, 8_388_608)?)?)
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
        Command::Store { command } => match command {
            StoreCommand::Save {
                run,
                store: destination,
            } => print(&store::save(&run, &destination)?)?,
            StoreCommand::Fetch {
                source,
                destination,
            } => print(&store::fetch(&source, &destination)?)?,
            StoreCommand::Refs { store: destination } => print(&store::refs(&destination)?)?,
            StoreCommand::Branch {
                store: destination,
                name,
                target,
                expect,
            } => print(&store::branch(
                &destination,
                &name,
                &target,
                expect.as_ref(),
            )?)?,
            StoreCommand::Diff {
                left,
                right,
                store: destination,
            } => print(&store::diff(&destination, &left, &right)?)?,
            StoreCommand::Merge {
                ours,
                theirs,
                store: destination,
                base,
                output,
                message,
            } => print(&store::merge(
                &destination,
                &ours,
                &theirs,
                base.as_ref(),
                &output,
                Text::new(message)?,
            )?)?,
            StoreCommand::Log { store: destination } => print(&store::status(&destination)?)?,
            StoreCommand::Checkout {
                version,
                store: destination,
                output,
            } => print(&store::checkout(&destination, &version, &output)?)?,
            StoreCommand::Clone {
                source,
                destination,
            } => print(&store::clone_store(&source, &destination)?)?,
            StoreCommand::ExportGit {
                store: source,
                repository,
            } => print(&store::export_git(&source, &repository)?)?,
            StoreCommand::Commit {
                source,
                store: destination,
                files,
                message,
                parent,
            } => {
                let names: Vec<String> = serde_json::from_value(ace_protocol::parse_json(
                    &bounded_bytes(&files, 1_048_576)?,
                )?)?;
                let parents = if parent.is_empty() {
                    None
                } else {
                    Some(parent.into_iter().collect())
                };
                let id = store::commit_source(
                    &source,
                    &destination,
                    &names,
                    Text::new(message)?,
                    parents,
                )?;
                print(
                    &serde_json::json!({"version":id,"store":destination,"backend":"ace-native-v1"}),
                )?;
            }
        },
        Command::Inspect { run, output } => print(&inspect::export(&run, &output)?)?,
        Command::Memory {
            repository,
            baseline_run,
            limit,
        } => print(&memory::query(
            &repository,
            &ace_runner::load_report(&baseline_run)?,
            limit,
        )?)?,
        Command::AgentStart {
            directory,
            campaign,
            baseline_run,
            repository,
            store,
            rounds,
            candidates,
            attempts,
            patience,
            jobs,
        } => print(&agent::start(
            &directory,
            campaign,
            &baseline_run,
            store
                .as_deref()
                .or(repository.as_deref())
                .ok_or("choose native --store or optional Git --repository")?,
            agent::Bounds {
                rounds,
                candidates,
                attempts,
                patience,
                jobs,
            },
            store.is_some(),
        )?)?,
        Command::AgentNext { directory } => print(&agent::next(&directory)?)?,
        Command::AgentStatus { directory } => print(&agent::status(&directory)?)?,
        Command::AgentSubmit { directory, file } => {
            let submission =
                serde_json::from_value(ace_protocol::parse_json(&bounded_bytes(&file, 262144)?)?)?;
            print(&agent::submit(&directory, &submission)?)?;
        }
        Command::AgentFault { directory, file } => {
            let fault =
                serde_json::from_value(ace_protocol::parse_json(&bounded_bytes(&file, 262144)?)?)?;
            print(&agent::fault(&directory, &fault)?)?;
        }
        Command::Archive { run, repository } => print(&archive::save(&run, &repository)?)?,
        Command::ArchiveStatus { repository } => print(&archive::status(&repository)?)?,
        Command::Propose {
            file,
            output,
            baseline_run,
        } => {
            let batch: proposal::Batch = serde_json::from_value(ace_protocol::parse_json(
                &bounded_bytes(&file, 3_145_728)?,
            )?)?;
            print(&proposal::register(
                &output,
                &batch,
                baseline_run.as_deref(),
            )?)?;
        }
        Command::ProposalStatus { directory } => print(&proposal::verify(&directory)?)?,
        Command::Mcp { workspace } => mcp::serve(&workspace)?,
        Command::Evolve {
            directory,
            seed,
            candidates,
            generations,
            jobs,
            patience,
            json,
            git_repository,
            store,
        } => {
            if let Some(destination) = &store {
                crate::store::init(destination)?;
            }
            let campaign = evolve::run_with_git(
                &directory,
                seed,
                candidates,
                generations,
                jobs,
                patience,
                store.as_deref().or(git_repository.as_deref()),
            )?;
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
            source::freeze(&directory, &output, &verified)?;
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
            CloudCommand::PrepareTrial { request, output } => {
                print(&observatory::prepare(&request, &output)?)?;
            }
            CloudCommand::ArchiveTrial {
                run,
                prepared,
                store,
            } => {
                print(&observatory::archive(&run, &prepared, &store)?)?;
            }
            CloudCommand::VerifySnapshot { snapshot, output } => {
                print(&verify::snapshot(&snapshot, &output)?)?
            }
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
                let bytes = bounded_bytes(&module, 1_048_576)?;
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
            let registration = proposal::verify_if_present(&directory)?;
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
            if let Some(record) = registration {
                proposal::verify_run(&directory, &record, &report)?;
            }
            source::freeze(&directory, &output, &report)?;
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
                "native-version.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(store::Version))?,
            );
            schemas.insert(
                "native-journal-entry.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(store::Entry))?,
            );
            schemas.insert(
                "native-ref-event.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(store::RefEvent))?,
            );
            schemas.insert(
                "memory.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(memory::Memory))?,
            );
            schemas.insert(
                "agent-task.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(agent::Task))?,
            );
            schemas.insert(
                "agent-submission.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(agent::Submission))?,
            );
            schemas.insert(
                "agent-fault.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(agent::Fault))?,
            );
            schemas.insert(
                "agent-status.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(agent::Status))?,
            );
            schemas.insert(
                "sources.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(source::Sources))?,
            );
            schemas.insert(
                "git-snapshot.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(archive::Snapshot))?,
            );
            schemas.insert(
                "proposal-batch.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(proposal::Batch))?,
            );
            schemas.insert(
                "proposal-registration.schema.json".into(),
                serde_json::to_value(schemars::schema_for!(proposal::Registration))?,
            );
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
                    if bounded_bytes(&path, 1_048_576)? != expected {
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
                let evidence: Evidence = serde_json::from_value(ace_protocol::parse_json(
                    &bounded_bytes(&file, 1_048_576)?,
                )?)?;
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
    Ok(ace_runner::files::read_regular(path, limit)?)
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
