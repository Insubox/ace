//! Local stdio tools. The operator selects the workspace; all tool paths are
//! category + validated IDs under that root. No shell, network or native source
//! execution is exposed. Tool errors are separate from candidate failures.
use crate::{Result, evolve, generate, proposal, summary};
use ace_core::*;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Generate {
    experiment: CheckName,
    seed: Option<generate::Seed>,
    candidates: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Propose {
    experiment: CheckName,
    proposals: proposal::Batch,
    baseline_run: Option<CheckName>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReadProposals {
    experiment: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Run {
    experiment: CheckName,
    run: CheckName,
    jobs: Option<u32>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReadRun {
    run: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Inspect {
    run: CheckName,
    report: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Explain {
    run: CheckName,
    candidate: CandidateId,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Evolve {
    campaign: CheckName,
    seed: Option<generate::Seed>,
    candidates: Option<u32>,
    generations: Option<u32>,
    jobs: Option<u32>,
    patience: Option<u32>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct History {
    campaign: CheckName,
}

#[derive(Deserialize)]
#[serde(tag = "name", content = "arguments", deny_unknown_fields)]
enum Call {
    #[serde(rename = "ace_store_refs")]
    StoreRefs(ReadStore),
    #[serde(rename = "ace_store_branch")]
    StoreBranch(StoreBranch),
    #[serde(rename = "ace_store_diff")]
    StoreDiff(StoreDiff),
    #[serde(rename = "ace_store_merge")]
    StoreMerge(StoreMerge),
    #[serde(rename = "ace_store_fetch")]
    StoreFetch(StoreFetch),
    #[serde(rename = "ace_store_save")]
    StoreSave(StoreSave),
    #[serde(rename = "ace_store_log")]
    StoreLog(ReadStore),
    #[serde(rename = "ace_store_checkout")]
    StoreCheckout(StoreCheckout),
    #[serde(rename = "ace_store_clone")]
    StoreClone(StoreClone),
    #[serde(rename = "ace_store_commit")]
    StoreCommit(StoreCommit),
    #[serde(rename = "ace_store_export_git")]
    StoreExportGit(StoreExportGit),
    #[serde(rename = "ace_inspect")]
    Inspect(Inspect),
    #[serde(rename = "ace_memory")]
    Memory(ReadMemory),
    #[serde(rename = "ace_agent_start")]
    AgentStart(AgentStart),
    #[serde(rename = "ace_agent_next")]
    AgentNext(ReadAgent),
    #[serde(rename = "ace_agent_status")]
    AgentStatus(ReadAgent),
    #[serde(rename = "ace_agent_submit")]
    AgentSubmit(AgentSubmit),
    #[serde(rename = "ace_agent_fault")]
    AgentFault(AgentFault),
    #[serde(rename = "ace_archive")]
    Archive(Archive),
    #[serde(rename = "ace_archive_status")]
    ArchiveStatus(ReadArchive),
    #[serde(rename = "ace_propose")]
    Propose(Propose),
    #[serde(rename = "ace_proposal_status")]
    ProposalStatus(ReadProposals),
    #[serde(rename = "ace_generate")]
    Generate(Generate),
    #[serde(rename = "ace_run")]
    Run(Run),
    #[serde(rename = "ace_status")]
    Status(ReadRun),
    #[serde(rename = "ace_champion")]
    Champion(ReadRun),
    #[serde(rename = "ace_knowledge")]
    Knowledge(ReadRun),
    #[serde(rename = "ace_explain")]
    Explain(Explain),
    #[serde(rename = "ace_evolve")]
    Evolve(Evolve),
    #[serde(rename = "ace_history")]
    History(History),
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreBranch {
    store: CheckName,
    name: CheckName,
    target: ContentHash,
    expected: Option<ContentHash>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreDiff {
    store: CheckName,
    left: ContentHash,
    right: ContentHash,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreMerge {
    store: CheckName,
    ours: ContentHash,
    theirs: ContentHash,
    base: Option<ContentHash>,
    output: CheckName,
    message: Text,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreFetch {
    source: CheckName,
    destination: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreSave {
    run: CheckName,
    store: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReadStore {
    store: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreCheckout {
    store: CheckName,
    version: ContentHash,
    output: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreClone {
    store: CheckName,
    destination: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreCommit {
    source: CheckName,
    store: CheckName,
    files: Vec<String>,
    message: Text,
    parents: Option<std::collections::BTreeSet<ContentHash>>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct StoreExportGit {
    store: CheckName,
    repository: CheckName,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReadMemory {
    repository: Option<CheckName>,
    store: Option<CheckName>,
    baseline_run: CheckName,
    limit: Option<usize>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AgentStart {
    campaign: CheckName,
    baseline_run: CheckName,
    repository: Option<CheckName>,
    store: Option<CheckName>,
    rounds: Option<u32>,
    candidates: Option<u32>,
    attempts: Option<u32>,
    patience: Option<u32>,
    jobs: Option<u32>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReadAgent {
    campaign: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AgentSubmit {
    campaign: CheckName,
    submission: crate::agent::Submission,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct AgentFault {
    campaign: CheckName,
    fault: crate::agent::Fault,
}

fn agent_path(root: &Path, campaign: &CheckName) -> Result<PathBuf> {
    let directory = path(root, "agents", campaign, true)?;
    crate::agent::check_workspace(&directory, root)?;
    Ok(directory)
}
fn history_path(
    root: &Path,
    repository: Option<&CheckName>,
    store: Option<&CheckName>,
    create: bool,
) -> Result<PathBuf> {
    let (category, name) = match (repository, store) {
        (Some(name), None) => ("archives", name),
        (None, Some(name)) => ("stores", name),
        _ => return Err("choose one native store name or optional Git repository name".into()),
    };
    portable_name(name.as_str())?;
    let exists = root.join(category).join(name.as_str()).try_exists()?;
    path(root, category, name, exists || !create)
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Archive {
    run: CheckName,
    repository: CheckName,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReadArchive {
    repository: CheckName,
}

pub(crate) fn portable_name(name: &str) -> Result<()> {
    // Domain IDs permit ':' for cloud identities; local filenames use a narrower
    // portable set, reject dot components and Windows device names.
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if name.len() > 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || reserved.contains(&name.to_ascii_uppercase().as_str())
    {
        return Err(
            "use a portable experiment/run name containing letters, digits, '-' or '_'".into(),
        );
    }
    Ok(())
}

fn path(root: &Path, category: &str, id: &CheckName, existing: bool) -> Result<PathBuf> {
    let name = id.as_str();
    portable_name(name)?;
    let parent = root.join(category);
    if !existing {
        fs::create_dir_all(&parent)?;
    }
    let parent = parent.canonicalize()?;
    if !parent.starts_with(root) {
        return Err("tool path escapes the selected workspace".into());
    }
    let path = parent.join(name);
    if existing {
        let path = path.canonicalize()?;
        if !path.starts_with(root) {
            return Err("tool path escapes the selected workspace".into());
        }
        Ok(path)
    } else {
        if path.symlink_metadata().is_ok() {
            return Err("destination already exists; choose a fresh name".into());
        }
        Ok(path)
    }
}

fn tool<T: JsonSchema>(name: &str, description: &str, readonly: bool) -> Value {
    json!({"name":name, "description":description, "inputSchema":schemars::schema_for!(T),
        "annotations":{"readOnlyHint":readonly,"destructiveHint":false,"idempotentHint":readonly,"openWorldHint":false}})
}

fn tools() -> Value {
    json!({"tools":[
        tool::<ReadStore>("ace_store_refs","Verify and list native branch heads and their append-only expectation log.",true),
        tool::<StoreBranch>("ace_store_branch","Create or advance a published native branch using an explicit previous-head expectation. Rewinds and stale expectations fail.",false),
        tool::<StoreDiff>("ace_store_diff","Compare exact native file identities and bounded UTF-8 line edits; does not execute source.",true),
        tool::<StoreMerge>("ace_store_merge","Merge native source ancestry into fresh merges/<output>. Preserve every conflict's base/ours/theirs bytes; conflicts publish no version. Merged source needs fresh evaluation.",false),
        tool::<StoreFetch>("ace_store_fetch","Import verified immutable DAG nodes between existing stores while preserving version IDs. Existing branch heads remain intact.",false),
        tool::<StoreSave>("ace_store_save", "Save verified winner source, every evaluated version and evidence-backed learning in ACE's native version engine under stores/<store>. No Git or account required.", false),
        tool::<ReadStore>("ace_store_log", "Verify native content objects, version parents and the ordered hash journal. Return source versions, evaluated winners/losers and generator faults.", true),
        tool::<StoreCheckout>("ace_store_checkout", "Restore exact bytes from a native version into a fresh checkouts/<output> folder. Never runs source or replaces existing files.", false),
        tool::<StoreClone>("ace_store_clone", "Copy verified native versions and shared content objects to a fresh stores/<destination>, without Git or network access.", false),
        tool::<StoreCommit>("ace_store_commit", "Version explicitly listed regular files from sources/<source> in the native store. Maximum 4096 paths, 8 MiB per file, 128 MiB per version. Optional parents must already exist; no automatic source execution or merge.", false),
        tool::<StoreExportGit>("ace_store_export_git", "Optionally export evaluated versions and faults from a native store to a fresh dedicated Git archive. Arbitrary source versions are not yet supported by this adapter. Git is required only for this export.", false),
        tool::<Inspect>("ace_inspect", "Export a verified run as an interactive offline HTML inspector under reports/<report>/index.html. Shows candidate source, measurements, policy, evidence and retained learning; never runs source. Requires a fresh report name.", false),
        tool::<ReadMemory>("ace_memory", "Retrieve bounded positive and negative observations and winner WAT from verified native ACE or optional Git history compatible with the chosen baseline run. Hidden Oracle cases and raw failure messages are excluded. Default 16 observations; maximum 64.", true),
        tool::<AgentStart>("ace_agent_start", "Start a bounded agent campaign under agents/<campaign>, archiving and replaying its qualified baseline. Context includes winner source and verified learning. Defaults: 4 rounds, 2 proposals, 3 attempts, patience 2, jobs 2. Choose a native store under stores/<store>, or optional Git under archives/<repository>.", false),
        tool::<ReadAgent>("ace_agent_next", "Freeze or return the next public generation task. The context hash binds subsequent proposals. Returns a terminal stop reason when bounds or patience are exhausted.", false),
        tool::<ReadAgent>("ace_agent_status", "Verify campaign tasks, evaluated proposals, source snapshots, winner ancestry and Git records. Does not create another task.", true),
        tool::<AgentSubmit>("ace_agent_submit", "Submit proposals for the pending context hash. Executes the independent Oracle and policy, archives winner source and all learning, and advances the campaign. Generator text and metadata never qualify a candidate.", false),
        tool::<AgentFault>("ace_agent_fault", "Record an unavailable, timed-out or malformed generation attempt without assigning a candidate correctness label. Faults consume the bounded retry allowance.", false),
        tool::<Archive>("ace_archive", "Commit a verified run, winning WAT source and learning from every candidate to a dedicated local Git repository under archives/<repository>. Requires Git on PATH. Preserves existing commits; no remote push or application repository modification.", false),
        tool::<ReadArchive>("ace_archive_status", "Verify committed local Git snapshots, archived evidence and source-to-WASM identity. Requires Git on PATH.", true),
        tool::<Propose>("ace_propose", "Register agent-authored WAT programs for import-free Gcd, MaxU32 or MinU32 Cells with ABI (i32,i32)->i32 interpreted as u32. Default trusted reference, or a verified local Champion selected with baseline_run. 1–100 candidates, at most 32 KiB source each; entire MCP frame remains limited to 64 KiB. Provenance is caller asserted. Registration never qualifies; call ace_run next.", false),
        tool::<ReadProposals>("ace_proposal_status", "Verify the frozen proposal batch, source-to-WASM hashes, registered generator metadata and baseline identity before evaluation.", true),
        tool::<Generate>("ace_generate", "Create a fresh bounded GCD population, including three diagnostic controls. Defaults: seed 42, 12 candidates; maximum 100.", false),
        tool::<Run>("ace_run", "Execute a registered population with independent correctness checks and fuel/memory limits. Inputs are experiments/<experiment>; fresh outputs are runs/<run>. Defaults: 2 jobs; maximum 8.", false),
        tool::<ReadRun>("ace_status", "Verify a sealed run and report candidate outcomes and its qualified Champion.", true),
        tool::<ReadRun>("ace_champion", "Verify and return the local qualified Champion; does not deploy it.", true),
        tool::<ReadRun>("ace_knowledge", "Verify and retrieve evidence-backed structured Knowledge from a run.", true),
        tool::<Explain>("ace_explain", "Verify the run and return one candidate's measured evaluation, evidence and policy decision.", true),
        tool::<Evolve>("ace_evolve", "Run bounded generations with verified Champion inheritance and linked Knowledge. Fresh output: campaigns/<campaign>. Defaults: seed 42, 24 candidates, 4 generations, 2 jobs, patience 2. Maximum: 16 generations, 100 candidates.", false),
        tool::<History>("ace_history", "Verify a campaign's evidence, generated sources, stop condition and full Champion/Knowledge lineage.", true)
    ]})
}

fn execute(root: &Path, call: Call) -> Result<Value> {
    Ok(match call {
        Call::StoreRefs(args) => crate::store::refs(&path(root, "stores", &args.store, true)?)?,
        Call::StoreBranch(args) => crate::store::branch(
            &path(root, "stores", &args.store, true)?,
            args.name.as_str(),
            &args.target,
            args.expected.as_ref(),
        )?,
        Call::StoreDiff(args) => crate::store::diff(
            &path(root, "stores", &args.store, true)?,
            &args.left,
            &args.right,
        )?,
        Call::StoreMerge(args) => crate::store::merge(
            &path(root, "stores", &args.store, true)?,
            &args.ours,
            &args.theirs,
            args.base.as_ref(),
            &path(root, "merges", &args.output, false)?,
            args.message,
        )?,
        Call::StoreFetch(args) => crate::store::fetch(
            &path(root, "stores", &args.source, true)?,
            &path(root, "stores", &args.destination, true)?,
        )?,
        Call::StoreSave(args) => crate::store::save(
            &path(root, "runs", &args.run, true)?,
            &history_path(root, None, Some(&args.store), true)?,
        )?,
        Call::StoreLog(args) => crate::store::status(&path(root, "stores", &args.store, true)?)?,
        Call::StoreCheckout(args) => crate::store::checkout(
            &path(root, "stores", &args.store, true)?,
            &args.version,
            &path(root, "checkouts", &args.output, false)?,
        )?,
        Call::StoreClone(args) => crate::store::clone_store(
            &path(root, "stores", &args.store, true)?,
            &path(root, "stores", &args.destination, false)?,
        )?,
        Call::StoreCommit(args) => {
            let destination = history_path(root, None, Some(&args.store), true)?;
            let id = crate::store::commit_source(
                &path(root, "sources", &args.source, true)?,
                &destination,
                &args.files,
                args.message,
                args.parents,
            )?;
            json!({"version":id,"store":destination,"backend":"ace-native-v1"})
        }
        Call::StoreExportGit(args) => crate::store::export_git(
            &path(root, "stores", &args.store, true)?,
            &path(root, "archives", &args.repository, false)?,
        )?,
        Call::Inspect(args) => crate::inspect::export(
            &path(root, "runs", &args.run, true)?,
            &path(root, "reports", &args.report, false)?.join("index.html"),
        )?,
        Call::Memory(args) => serde_json::to_value(crate::memory::query(
            &history_path(root, args.repository.as_ref(), args.store.as_ref(), false)?,
            &ace_runner::load_report(&path(root, "runs", &args.baseline_run, true)?)?,
            args.limit.unwrap_or(16),
        )?)?,
        Call::AgentStart(args) => {
            let destination =
                history_path(root, args.repository.as_ref(), args.store.as_ref(), true)?;
            serde_json::to_value(crate::agent::start(
                &path(root, "agents", &args.campaign, false)?,
                args.campaign,
                &path(root, "runs", &args.baseline_run, true)?,
                &destination,
                crate::agent::Bounds {
                    rounds: args.rounds.unwrap_or(4),
                    candidates: args.candidates.unwrap_or(2),
                    attempts: args.attempts.unwrap_or(3),
                    patience: args.patience.unwrap_or(2),
                    jobs: args.jobs.unwrap_or(2),
                },
                args.store.is_some(),
            )?)?
        }
        Call::AgentNext(args) => {
            serde_json::to_value(crate::agent::next(&agent_path(root, &args.campaign)?)?)?
        }
        Call::AgentStatus(args) => {
            serde_json::to_value(crate::agent::status(&agent_path(root, &args.campaign)?)?)?
        }
        Call::AgentSubmit(args) => serde_json::to_value(crate::agent::submit(
            &agent_path(root, &args.campaign)?,
            &args.submission,
        )?)?,
        Call::AgentFault(args) => serde_json::to_value(crate::agent::fault(
            &agent_path(root, &args.campaign)?,
            &args.fault,
        )?)?,
        Call::Archive(args) => {
            portable_name(args.repository.as_str())?;
            let exists = root
                .join("archives")
                .join(args.repository.as_str())
                .try_exists()?;
            crate::archive::save(
                &path(root, "runs", &args.run, true)?,
                &path(root, "archives", &args.repository, exists)?,
            )?
        }
        Call::ArchiveStatus(args) => {
            crate::archive::status(&path(root, "archives", &args.repository, true)?)?
        }
        Call::Propose(args) => {
            let baseline = args
                .baseline_run
                .map(|id| path(root, "runs", &id, true))
                .transpose()?;
            serde_json::to_value(proposal::register(
                &path(root, "experiments", &args.experiment, false)?,
                &args.proposals,
                baseline.as_deref(),
            )?)?
        }
        Call::ProposalStatus(args) => serde_json::to_value(proposal::verify(&path(
            root,
            "experiments",
            &args.experiment,
            true,
        )?)?)?,
        Call::Generate(args) => serde_json::to_value(generate::population(
            &path(root, "experiments", &args.experiment, false)?,
            args.seed.map(generate::Seed::get).unwrap_or(42),
            args.candidates.unwrap_or(12),
        )?)?,
        Call::Run(args) => {
            let input = path(root, "experiments", &args.experiment, true)?;
            let output = path(root, "runs", &args.run, false)?;
            let registration = proposal::verify_if_present(&input)?;
            let report = ace_runner::run(&input, &output, args.jobs.unwrap_or(2))?;
            let verified = ace_runner::load_report(&output)?;
            if report != verified {
                return Err("saved run verification differed".into());
            }
            if let Some(record) = registration {
                proposal::verify_run(&input, &record, &verified)?;
            }
            crate::source::freeze(&input, &output, &verified)?;
            summary(&output, &verified)
        }
        Call::Status(args) => {
            let path = path(root, "runs", &args.run, true)?;
            summary(&path, &ace_runner::load_report(&path)?)
        }
        Call::Champion(args) => serde_json::to_value(
            ace_runner::load_report(&path(root, "runs", &args.run, true)?)?
                .champion
                .ok_or("no qualified Champion in this run")?,
        )?,
        Call::Knowledge(args) => serde_json::to_value(
            ace_runner::load_report(&path(root, "runs", &args.run, true)?)?.knowledge,
        )?,
        Call::Explain(args) => {
            let report = ace_runner::load_report(&path(root, "runs", &args.run, true)?)?;
            serde_json::to_value(
                report
                    .results
                    .iter()
                    .find(|r| r.candidate.id == args.candidate)
                    .ok_or("candidate is not registered in this run")?,
            )?
        }
        Call::Evolve(args) => serde_json::to_value(evolve::run(
            &path(root, "campaigns", &args.campaign, false)?,
            args.seed.map(generate::Seed::get).unwrap_or(42),
            args.candidates.unwrap_or(24),
            args.generations.unwrap_or(4),
            args.jobs.unwrap_or(2),
            args.patience.unwrap_or(2),
        )?)?,
        Call::History(args) => serde_json::to_value(evolve::load(&path(
            root,
            "campaigns",
            &args.campaign,
            true,
        )?)?)?,
    })
}

fn reply(root: &Path, request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    if request.get("jsonrpc") != Some(&json!("2.0"))
        || !(id.is_null() || id.is_string() || id.is_number())
    {
        return json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}});
    }
    let result = match request.get("method").and_then(Value::as_str) {
        Some("initialize") => {
            let requested = request
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str);
            let version = if requested == Some("2025-03-26") {
                "2025-03-26"
            } else {
                "2025-06-18"
            };
            json!({"protocolVersion":version,"capabilities":{"tools":{}},"serverInfo":{"name":"ace-local","version":env!("CARGO_PKG_VERSION")},"instructions":"Local import-free Gcd, MaxU32 and MinU32 WASM experiments. All generated candidates need real evaluation. Tools preserve existing outputs and use the operator-selected workspace. Knowledge and Champion advice never deploy software."})
        }
        Some("ping") => json!({}),
        Some("tools/list") => tools(),
        Some("tools/call") => {
            let result = request
                .get("params")
                .ok_or("missing tool parameters")
                .map_err(|e| e.into())
                .and_then(|params| Ok(serde_json::from_value::<Call>(params.clone())?))
                .and_then(|call| execute(root, call));
            match result {
                Ok(value) => {
                    json!({"content":[{"type":"text","text":serde_json::to_string(&value).expect("serializable result")}],"structuredContent":value,"isError":false})
                }
                Err(error) => {
                    json!({"content":[{"type":"text","text":error.to_string()}],"isError":true})
                }
            }
        }
        _ => {
            return json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}});
        }
    };
    json!({"jsonrpc":"2.0","id":id,"result":result})
}

pub(crate) fn serve(workspace: &Path) -> Result<()> {
    fs::create_dir_all(workspace)?;
    let root = workspace.canonicalize()?;
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut bytes = Vec::new();
        let read = Read::by_ref(&mut input)
            .take(65_537)
            .read_until(b'\n', &mut bytes)?;
        if read == 0 {
            break;
        }
        if bytes.len() > 65_536 {
            return Err("MCP request exceeds 64 KiB".into());
        }
        let response = match ace_protocol::parse_json(&bytes) {
            Ok(request)
                if request.is_object()
                    && request.get("jsonrpc") == Some(&json!("2.0"))
                    && request.get("method").is_some_and(Value::is_string)
                    && request.get("id").is_none() =>
            {
                continue;
            }
            Ok(request) => reply(&root, &request),
            Err(_) => {
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}})
            }
        };
        serde_json::to_writer(&mut output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}
