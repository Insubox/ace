//! ACE's native content-addressed version engine. No Git subprocess or service.
use crate::{Result, agent, archive, bounded_bytes, create_atomic, json};
use ace_core::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json as value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

const MARKER: &[u8] = b"{\"ace_native_store\":1}\n";
const MAX_FILE: u64 = 8_388_608;
const MAX_TREE: usize = 134_217_728;
const MAX_FILES: usize = 4096;
const MAX_VERSIONS: usize = 256;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Kind {
    Source,
    Evaluation { report_hash: ContentHash },
    GeneratorFault { context_hash: ContentHash },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Version {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub parents: BTreeSet<ContentHash>,
    pub kind: Kind,
    pub message: Text,
    pub files: BTreeMap<String, ContentHash>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SealedVersion {
    version: Version,
    content_hash: ContentHash,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub sequence: u32,
    pub previous: Option<ContentHash>,
    pub version: ContentHash,
    pub content_hash: ContentHash,
}
struct State {
    root: PathBuf,
    versions: Vec<(Entry, Version)>,
}
pub(crate) fn is_native(root: &Path) -> bool {
    root.join(".ace-store.json").symlink_metadata().is_ok()
}

fn regular(root: &Path, path: &Path) -> Result<PathBuf> {
    if !path.symlink_metadata()?.file_type().is_file() || !path.canonicalize()?.starts_with(root) {
        return Err("native store requires regular files inside its root".into());
    }
    Ok(path.to_owned())
}
fn folder(root: &Path, name: &str) -> Result<PathBuf> {
    let path = root.join(name);
    if !path.symlink_metadata()?.file_type().is_dir() || !path.canonicalize()?.starts_with(root) {
        return Err("native store directory escapes its root".into());
    }
    Ok(path)
}
fn root(path: &Path) -> Result<PathBuf> {
    if !path.symlink_metadata()?.file_type().is_dir() {
        return Err("native store root must be a directory, not a symlink".into());
    }
    let root = path.canonicalize()?;
    if bounded_bytes(&regular(&root, &root.join(".ace-store.json"))?, 1024)? != MARKER {
        return Err("use a dedicated ACE native store".into());
    }
    for name in ["objects", "versions", "journal", "views"] {
        folder(&root, name)?;
    }
    Ok(root)
}
pub(crate) fn init(path: &Path) -> Result<()> {
    if path.symlink_metadata().is_ok() {
        root(path)?;
        return Ok(());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir(path)?;
    for name in ["objects", "versions", "journal", "views"] {
        fs::create_dir(path.join(name))?;
    }
    create_atomic(&path.join(".ace-store.json"), MARKER)
}
fn valid_name(name: &str) -> Result<()> {
    if name.len() > 2048
        || name.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.len() > 255
                || part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
                || matches!(
                    part.split('.')
                        .next()
                        .unwrap()
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
    {
        return Err("use portable relative regular-file paths in a native version".into());
    }
    Ok(())
}
fn validate_tree(files: &BTreeMap<String, ContentHash>) -> Result<()> {
    if files.is_empty() || files.len() > MAX_FILES {
        return Err("native version needs 1–4096 explicit files".into());
    }
    let folded = files
        .keys()
        .map(|n| n.to_lowercase())
        .collect::<BTreeSet<_>>();
    if folded.len() != files.len() {
        return Err("native paths conflict on a case-insensitive filesystem".into());
    }
    for name in files.keys() {
        valid_name(name)?;
        let mut parent = Path::new(name).parent();
        while let Some(path) = parent {
            if folded.contains(&path.to_string_lossy().to_lowercase()) {
                return Err("version file conflicts with another file's directory".into());
            }
            parent = path.parent();
        }
    }
    Ok(())
}
fn entry_hash(entry: &Entry) -> Result<ContentHash> {
    Ok(ContentHash::of_json(&(
        entry.schema_version,
        entry.sequence,
        &entry.previous,
        &entry.version,
    ))?)
}
fn state(path: &Path) -> Result<State> {
    let root = root(path)?;
    let mut paths = fs::read_dir(folder(&root, "journal")?)?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    if paths.len() > MAX_VERSIONS {
        return Err("native store exceeds 256 versions; select a smaller store".into());
    }
    paths.sort();
    let mut versions = Vec::new();
    let mut previous = None;
    let mut known = BTreeSet::new();
    for (index, path) in paths.iter().enumerate() {
        let entry: Entry = serde_json::from_value(ace_protocol::parse_json(&bounded_bytes(
            &regular(&root, path)?,
            8192,
        )?)?)?;
        if entry.sequence as usize != index + 1
            || path.file_name().and_then(|s| s.to_str())
                != Some(format!("{:08}.json", entry.sequence).as_str())
            || entry.previous != previous
            || entry.content_hash != entry_hash(&entry)?
            || known.contains(&entry.version)
        {
            return Err("native version journal order, parent or hash changed".into());
        }
        let vp = root.join(format!("versions/{}.json", entry.version.as_str()));
        let sealed: SealedVersion = serde_json::from_value(ace_protocol::parse_json(
            &bounded_bytes(&regular(&root, &vp)?, 1_048_576)?,
        )?)?;
        if sealed.content_hash != entry.version
            || sealed.content_hash != ContentHash::of_json(&sealed.version)?
            || !sealed.version.parents.is_subset(&known)
            || sealed.version.parents.len() > 2
            || sealed.version.message.as_str().len() > 4096
        {
            return Err("native version identity or ancestry changed".into());
        }
        validate_tree(&sealed.version.files)?;
        let mut total = 0;
        for hash in sealed.version.files.values() {
            let bytes = bounded_bytes(
                &regular(&root, &root.join(format!("objects/{}", hash.as_str())))?,
                MAX_FILE,
            )?;
            total += bytes.len();
            if total > MAX_TREE || ContentHash::of_bytes(&bytes) != *hash {
                return Err("native version object changed or exceeds byte budget".into());
            }
        }
        previous = Some(entry.content_hash.clone());
        known.insert(entry.version.clone());
        versions.push((entry, sealed.version));
    }
    let state = State { root, versions };
    read_refs(&state)?;
    Ok(state)
}
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
fn lock(root: &Path) -> Result<Lock> {
    let path = root.join(".ace-store.lock");
    fs::create_dir(&path).map_err(|e| format!("native store is locked or unavailable: {e}"))?;
    Ok(Lock(path))
}

fn commit(
    path: &Path,
    kind: Kind,
    files: BTreeMap<String, Vec<u8>>,
    message: Text,
    parents: Option<BTreeSet<ContentHash>>,
) -> Result<ContentHash> {
    let hashes = files
        .iter()
        .map(|(n, b)| (n.clone(), ContentHash::of_bytes(b)))
        .collect::<BTreeMap<_, _>>();
    validate_tree(&hashes)?;
    if message.as_str().len() > 4096
        || files.values().any(|b| b.len() > MAX_FILE as usize)
        || files.values().map(Vec::len).sum::<usize>() > MAX_TREE
    {
        return Err("native version exceeds message or file byte budget".into());
    }
    init(path)?;
    let root = root(path)?;
    let _lock = lock(&root)?;
    let state = state(&root)?;
    // Evaluation/fault identities are immutable and idempotent, even after later commits.
    if kind != Kind::Source
        && let Some((entry, version)) = state.versions.iter().find(|(_, v)| v.kind == kind)
    {
        if version.files != hashes {
            return Err(
                "native evaluation or fault already retained with different content".into(),
            );
        }
        return Ok(entry.version.clone());
    }
    if state.versions.len() >= MAX_VERSIONS {
        return Err("native store reached its 256-version bound".into());
    }
    let parents = parents.unwrap_or_else(|| {
        state
            .versions
            .last()
            .map(|(e, _)| BTreeSet::from([e.version.clone()]))
            .unwrap_or_default()
    });
    if parents.len() > 2
        || parents
            .iter()
            .any(|p| !state.versions.iter().any(|(e, _)| &e.version == p))
    {
        return Err("native parents must refer to existing versions in this store".into());
    }
    let version = Version {
        schema_version: ace_protocol::ProtocolVersion,
        parents,
        kind,
        message,
        files: hashes,
    };
    let id = ContentHash::of_json(&version)?;
    if state.versions.iter().any(|(e, _)| e.version == id) {
        return Ok(id);
    }
    for (name, bytes) in files {
        let hash = &version.files[&name];
        let object = root.join(format!("objects/{}", hash.as_str()));
        if object.symlink_metadata().is_ok() {
            if bounded_bytes(&regular(&root, &object)?, MAX_FILE)? != bytes {
                return Err("existing native object differs; no overwrite".into());
            }
        } else {
            create_atomic(&object, &bytes)?;
        }
    }
    let version_path = root.join(format!("versions/{}.json", id.as_str()));
    let sealed = json(&SealedVersion {
        version,
        content_hash: id.clone(),
    })?;
    if version_path.symlink_metadata().is_ok() {
        if bounded_bytes(&regular(&root, &version_path)?, 1_048_576)? != sealed {
            return Err("existing native version differs; no overwrite".into());
        }
    } else {
        create_atomic(&version_path, &sealed)?;
    }
    let mut entry = Entry {
        schema_version: ace_protocol::ProtocolVersion,
        sequence: state.versions.len() as u32 + 1,
        previous: state.versions.last().map(|(e, _)| e.content_hash.clone()),
        version: id.clone(),
        content_hash: ContentHash::of_bytes(b""),
    };
    entry.content_hash = entry_hash(&entry)?;
    // Publication point: loose verified objects/versions from an interruption are reusable.
    create_atomic(
        &root.join(format!("journal/{:08}.json", entry.sequence)),
        &json(&entry)?,
    )?;
    Ok(id)
}

pub(crate) fn commit_application_files(
    files: BTreeMap<String, Vec<u8>>,
    destination: &Path,
    message: Text,
    parents: Option<BTreeSet<ContentHash>>,
) -> Result<ContentHash> {
    commit(destination, Kind::Source, files, message, parents)
}

pub(crate) fn commit_source(
    source: &Path,
    destination: &Path,
    names: &[String],
    message: Text,
    parents: Option<BTreeSet<ContentHash>>,
) -> Result<ContentHash> {
    if names.is_empty() || names.len() > MAX_FILES {
        return Err("explicit file list must contain 1–4096 paths".into());
    }
    let root = source.canonicalize()?;
    let mut files = BTreeMap::new();
    let mut total = 0;
    for name in names {
        valid_name(name)?;
        let bytes = bounded_bytes(&regular(&root, &root.join(name))?, MAX_FILE)?;
        total += bytes.len();
        if total > MAX_TREE || files.insert(name.clone(), bytes).is_some() {
            return Err("duplicate file or native source exceeds byte budget".into());
        }
    }
    commit(destination, Kind::Source, files, message, parents)
}
fn restore(root: &Path, version: &Version, output: &Path) -> Result<()> {
    if output.symlink_metadata().is_ok() {
        return Err("checkout destination already exists; choose a fresh folder".into());
    }
    fs::create_dir_all(output)?;
    for (name, hash) in &version.files {
        let bytes = bounded_bytes(
            &regular(root, &root.join(format!("objects/{}", hash.as_str())))?,
            MAX_FILE,
        )?;
        if ContentHash::of_bytes(&bytes) != *hash {
            return Err("native object changed before checkout".into());
        }
        create_atomic(&output.join(name), &bytes)?;
    }
    Ok(())
}
pub(crate) fn checkout(destination: &Path, id: &ContentHash, output: &Path) -> Result<Value> {
    let state = state(destination)?;
    let (_, version) = state
        .versions
        .iter()
        .find(|(e, _)| &e.version == id)
        .ok_or("native version not found")?;
    restore(&state.root, version, output)?;
    Ok(value!({"version":id,"output":output,"files":version.files.len(),"verified":true}))
}
fn view(state: &State, entry: &Entry, version: &Version) -> Result<PathBuf> {
    let path = state.root.join(format!("views/{}", entry.version.as_str()));
    if path.symlink_metadata().is_err() {
        restore(&state.root, version, &path)?;
    }
    if !path.symlink_metadata()?.file_type().is_dir()
        || !path.canonicalize()?.starts_with(&state.root)
    {
        return Err("native view escapes store".into());
    }
    for (name, hash) in &version.files {
        if ContentHash::of_bytes(&bounded_bytes(
            &regular(&path.canonicalize()?, &path.join(name))?,
            MAX_FILE,
        )?) != *hash
        {
            return Err("native materialized view changed; original objects were preserved".into());
        }
    }
    Ok(path)
}
pub(crate) fn save(run: &Path, destination: &Path) -> Result<Value> {
    let (snapshot, mut files) = archive::snapshot_files(run)?;
    files.insert("manifest.json".into(), json(&snapshot)?);
    let id = commit(
        destination,
        Kind::Evaluation {
            report_hash: snapshot.report_hash.clone(),
        },
        files,
        Text::new("ACE evaluated version: winner source and all retained learning")?,
        None,
    )?;
    Ok(
        value!({"repository":destination.canonicalize()?,"commit":id,"version":id,"backend":"ace-native-v1","snapshot":snapshot,"remote_push":false}),
    )
}
pub(crate) fn save_fault(
    destination: &Path,
    task: &agent::Task,
    fault: &agent::Fault,
    submission: Option<&agent::Submission>,
) -> Result<String> {
    let record = archive::fault_record(task, fault, submission)?;
    let id = commit(
        destination,
        Kind::GeneratorFault {
            context_hash: task.context_hash.clone(),
        },
        BTreeMap::from([("event.json".into(), json(&record)?)]),
        Text::new("ACE generator fault: no candidate evaluation conclusion")?,
        None,
    )?;
    Ok(id.as_str().to_owned())
}
pub(crate) fn archived_run(destination: &Path, report: &ContentHash) -> Result<PathBuf> {
    let state = state(destination)?;
    let (entry, version) = state
        .versions
        .iter()
        .find(|(_, v)| {
            v.kind
                == Kind::Evaluation {
                    report_hash: report.clone(),
                }
        })
        .ok_or("evaluated report not found in native history")?;
    let path = view(&state, entry, version)?;
    if archive::verify_snapshot(&path)?.report_hash != *report {
        return Err("native evaluation differs from version kind".into());
    }
    Ok(path.join("run"))
}
pub(crate) fn status(destination: &Path) -> Result<Value> {
    let state = state(destination)?;
    let (ref_events, heads) = read_refs(&state)?;
    let mut snapshots = Vec::new();
    let mut faults = Vec::new();
    let mut versions = Vec::new();
    let mut objects = BTreeSet::new();
    for (entry, version) in &state.versions {
        objects.extend(version.files.values().cloned());
        versions.push(value!({"version":entry.version,"sequence":entry.sequence,"journal_hash":entry.content_hash,"parents":version.parents,"kind":version.kind,"message":version.message,"files":version.files.len()}));
        match &version.kind {
            Kind::Source => {}
            Kind::Evaluation { report_hash } => {
                let path = view(&state, entry, version)?;
                let snapshot = archive::verify_snapshot(&path)?;
                if &snapshot.report_hash != report_hash {
                    return Err("native evaluation version belongs to a different report".into());
                }
                snapshots.push(value!({"snapshot":snapshot,"commit":entry.version}));
            }
            Kind::GeneratorFault { context_hash } => {
                let record =
                    archive::verify_fault(&view(&state, entry, version)?.join("event.json"))?;
                if &record.task.context_hash != context_hash {
                    return Err("native fault belongs to a different context".into());
                }
                faults.push(value!({"context_hash":context_hash,"fault":record.fault.fault,"commit":entry.version,"candidate_evaluation_performed":false}));
            }
        }
    }
    Ok(
        value!({"repository":state.root,"backend":"ace-native-v1","verified":true,"versions":versions,"objects":objects.len(),"tip":state.versions.last().map(|(e,_)|&e.content_hash),"snapshots":snapshots,"generator_faults":faults,"remote_push":false,"refs":heads,"ref_tip":ref_events.last().map(|e|&e.content_hash)}),
    )
}
pub(crate) fn clone_store(source: &Path, destination: &Path) -> Result<Value> {
    status(source)?;
    let state = state(source)?;
    if destination.symlink_metadata().is_ok() {
        return Err("native clone destination already exists".into());
    }
    init(destination)?;
    let dest = root(destination)?;
    let _lock = lock(&dest)?;
    let mut objects = BTreeSet::new();
    for (entry, version) in &state.versions {
        for hash in version.files.values() {
            if objects.insert(hash.clone()) {
                create_atomic(
                    &dest.join(format!("objects/{}", hash.as_str())),
                    &bounded_bytes(
                        &regular(
                            &state.root,
                            &state.root.join(format!("objects/{}", hash.as_str())),
                        )?,
                        MAX_FILE,
                    )?,
                )?;
            }
        }
        let sealed = SealedVersion {
            version: version.clone(),
            content_hash: entry.version.clone(),
        };
        create_atomic(
            &dest.join(format!("versions/{}.json", entry.version.as_str())),
            &json(&sealed)?,
        )?;
        create_atomic(
            &dest.join(format!("journal/{:08}.json", entry.sequence)),
            &json(entry)?,
        )?;
    }
    for event in read_refs(&state)?.0 {
        create_atomic(
            &dest.join(format!("refs/{:08}.json", event.sequence)),
            &json(&event)?,
        )?;
    }
    status(destination)
}
pub(crate) fn export_git(source: &Path, destination: &Path) -> Result<Value> {
    status(source)?;
    let state = state(source)?;
    if destination.symlink_metadata().is_ok() {
        return Err("Git export requires a fresh dedicated destination".into());
    }
    if state.versions.iter().any(|(_, v)| v.kind == Kind::Source) {
        return Err("Git export currently supports evaluated/fault history; native arbitrary-source versions remain intact".into());
    }
    for (entry, version) in &state.versions {
        let path = view(&state, entry, version)?;
        match version.kind {
            Kind::Evaluation { .. } => {
                archive::save(&path.join("run"), destination)?;
            }
            Kind::GeneratorFault { .. } => {
                let record = archive::verify_fault(&path.join("event.json"))?;
                archive::save_fault(
                    destination,
                    &record.task,
                    &record.fault,
                    record.submission.as_ref(),
                )?;
            }
            Kind::Source => unreachable!(),
        }
    }
    archive::status(destination)
}

/// Native branch references are an append-only, independently verified CAS log.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct RefEvent {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub sequence: u32,
    pub previous: Option<ContentHash>,
    pub branch: String,
    pub expected: Option<ContentHash>,
    pub target: ContentHash,
    pub content_hash: ContentHash,
}
fn branch_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || !name.as_bytes()[0].is_ascii_alphanumeric()
    {
        return Err(
            "branch names use 1–64 portable letters, digits, hyphens or underscores".into(),
        );
    }
    Ok(())
}
fn ref_hash(event: &RefEvent) -> Result<ContentHash> {
    Ok(ContentHash::of_json(&(
        event.schema_version,
        event.sequence,
        &event.previous,
        &event.branch,
        &event.expected,
        &event.target,
    ))?)
}
fn ancestors(state: &State, id: &ContentHash) -> BTreeSet<ContentHash> {
    let mut known = BTreeSet::new();
    let mut next = vec![id.clone()];
    while let Some(id) = next.pop() {
        if known.insert(id.clone())
            && let Some((_, version)) = state.versions.iter().find(|(e, _)| e.version == id)
        {
            next.extend(version.parents.iter().cloned());
        }
    }
    known
}
fn read_refs(state: &State) -> Result<(Vec<RefEvent>, BTreeMap<String, ContentHash>)> {
    let path = state.root.join("refs");
    match path.symlink_metadata() {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), BTreeMap::new()));
        }
        Err(error) => return Err(error.into()),
        Ok(_) => {}
    }
    let mut paths = fs::read_dir(folder(&state.root, "refs")?)?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    paths.sort();
    if paths.len() > 1024 {
        return Err("native reference log exceeds 1024 events".into());
    }
    let mut events: Vec<RefEvent> = Vec::new();
    let mut heads = BTreeMap::new();
    for (index, path) in paths.iter().enumerate() {
        let event: RefEvent = serde_json::from_value(ace_protocol::parse_json(&bounded_bytes(
            &regular(&state.root, path)?,
            8192,
        )?)?)?;
        branch_name(&event.branch)?;
        if path.file_name().and_then(|s| s.to_str()) != Some(&format!("{:08}.json", index + 1))
            || event.sequence as usize != index + 1
            || event.previous != events.last().map(|e| e.content_hash.clone())
            || event.content_hash != ref_hash(&event)?
            || heads.get(&event.branch) != event.expected.as_ref()
            || !state
                .versions
                .iter()
                .any(|(e, _)| e.version == event.target)
            || event
                .expected
                .as_ref()
                .is_some_and(|old| !ancestors(state, &event.target).contains(old))
        {
            return Err(
                "native reference history, target or fast-forward expectation changed".into(),
            );
        }
        heads.insert(event.branch.clone(), event.target.clone());
        events.push(event);
    }
    Ok((events, heads))
}
pub(crate) fn refs(destination: &Path) -> Result<Value> {
    let state = state(destination)?;
    let (events, heads) = read_refs(&state)?;
    Ok(
        value!({"schema_version":1,"heads":heads,"events":events,"tip":events.last().map(|e|&e.content_hash),"verified":true}),
    )
}
pub(crate) fn branch(
    destination: &Path,
    name: &str,
    target: &ContentHash,
    expected: Option<&ContentHash>,
) -> Result<Value> {
    branch_name(name)?;
    let root = root(destination)?;
    let _lock = lock(&root)?;
    let state = state(&root)?;
    let (events, heads) = read_refs(&state)?;
    if heads.get(name) != expected {
        return Err(
            "branch changed; read its current head and retry with an explicit expectation".into(),
        );
    }
    if !state.versions.iter().any(|(e, _)| &e.version == target)
        || expected.is_some_and(|old| !ancestors(&state, target).contains(old))
    {
        return Err("branch target must exist and extend the previous head".into());
    }
    if events.len() >= 1024 {
        return Err("native reference log reached 1024 events".into());
    }
    let mut event = RefEvent {
        schema_version: ace_protocol::ProtocolVersion,
        sequence: events.len() as u32 + 1,
        previous: events.last().map(|e| e.content_hash.clone()),
        branch: name.into(),
        expected: expected.cloned(),
        target: target.clone(),
        content_hash: ContentHash::of_bytes(b""),
    };
    event.content_hash = ref_hash(&event)?;
    let path = root.join("refs");
    if path.symlink_metadata().is_err() {
        fs::create_dir(&path)?;
    }
    folder(&root, "refs")?;
    create_atomic(
        &path.join(format!("{:08}.json", event.sequence)),
        &json(&event)?,
    )?;
    Ok(value!({"branch":name,"head":target,"event":event,"verified":true}))
}
fn selected<'a>(state: &'a State, id: &ContentHash) -> Result<&'a Version> {
    state
        .versions
        .iter()
        .find(|(e, _)| &e.version == id)
        .map(|(_, v)| v)
        .ok_or_else(|| "native version not found".into())
}
fn file_bytes(state: &State, hash: &ContentHash) -> Result<Vec<u8>> {
    let bytes = bounded_bytes(
        &regular(
            &state.root,
            &state.root.join(format!("objects/{}", hash.as_str())),
        )?,
        MAX_FILE,
    )?;
    if ContentHash::of_bytes(&bytes) != *hash {
        return Err("native content object changed".into());
    }
    Ok(bytes)
}
#[derive(Clone, Debug, PartialEq)]
struct Edit {
    start: usize,
    end: usize,
    lines: Vec<String>,
}
fn lines(bytes: &[u8]) -> Option<Vec<String>> {
    if bytes.len() > 65536 {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let lines = text
        .split_inclusive('\n')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    (lines.len() <= 256).then_some(lines)
}
fn edits(base: &[String], changed: &[String]) -> Vec<Edit> {
    let mut lengths = vec![vec![0_u16; changed.len() + 1]; base.len() + 1];
    for i in (0..base.len()).rev() {
        for j in (0..changed.len()).rev() {
            lengths[i][j] = if base[i] == changed[j] {
                lengths[i + 1][j + 1] + 1
            } else {
                lengths[i + 1][j].max(lengths[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut result = Vec::new();
    let mut pending: Option<Edit> = None;
    while i < base.len() || j < changed.len() {
        if i < base.len() && j < changed.len() && base[i] == changed[j] {
            if let Some(edit) = pending.take() {
                result.push(edit);
            }
            i += 1;
            j += 1;
        } else {
            let edit = pending.get_or_insert(Edit {
                start: i,
                end: i,
                lines: Vec::new(),
            });
            if j < changed.len() && (i == base.len() || lengths[i][j + 1] >= lengths[i + 1][j]) {
                edit.lines.push(changed[j].clone());
                j += 1;
            } else {
                i += 1;
                edit.end = i;
            }
        }
    }
    if let Some(edit) = pending {
        result.push(edit);
    }
    result
}
fn merge_text(base: &[u8], ours: &[u8], theirs: &[u8]) -> Option<Vec<u8>> {
    let (base, ours, theirs) = (lines(base)?, lines(ours)?, lines(theirs)?);
    let mut left = edits(&base, &ours);
    let right = edits(&base, &theirs);
    for incoming in right {
        if left.iter().any(|e| e == &incoming) {
            continue;
        }
        if left.iter().any(|e| {
            if e.start == e.end || incoming.start == incoming.end {
                e.start <= incoming.end && incoming.start <= e.end
            } else {
                e.start < incoming.end && incoming.start < e.end
            }
        }) {
            return None;
        }
        left.push(incoming);
    }
    left.sort_by_key(|e| (e.start, e.end));
    let mut result = String::new();
    let mut cursor = 0;
    for edit in left {
        for line in &base[cursor..edit.start] {
            result.push_str(line);
        }
        for line in &edit.lines {
            result.push_str(line);
        }
        cursor = edit.end;
    }
    for line in &base[cursor..] {
        result.push_str(line);
    }
    Some(result.into_bytes())
}
pub(crate) fn diff(destination: &Path, left: &ContentHash, right: &ContentHash) -> Result<Value> {
    let state = state(destination)?;
    let (left_version, right_version) = (selected(&state, left)?, selected(&state, right)?);
    let paths = left_version
        .files
        .keys()
        .chain(right_version.files.keys())
        .collect::<BTreeSet<_>>();
    let mut changes = Vec::new();
    for path in paths {
        let (before, after) = (left_version.files.get(path), right_version.files.get(path));
        if before == after {
            continue;
        }
        let text_edits = if changes.len() < 20 {
            match(before,after){(Some(a),Some(b))=>match(lines(&file_bytes(&state,a)?),lines(&file_bytes(&state,b)?)){(Some(a),Some(b))=>Some(edits(&a,&b).into_iter().map(|e|value!({"start_line":e.start+1,"removed_lines":e.end-e.start,"replacement":e.lines})).collect::<Vec<_>>()),_=>None},_=>None}
        } else {
            None
        };
        changes.push(value!({"path":path,"change":if before.is_none(){"added"}else if after.is_none(){"removed"}else{"modified"},"before":before,"after":after,"text_edits":text_edits}));
    }
    Ok(
        value!({"left":left,"right":right,"changes":changes,"verified":true,"text_preview_limit":{"files":20,"bytes_per_file":65536,"lines_per_file":256}}),
    )
}
pub(crate) fn merge(
    destination: &Path,
    ours: &ContentHash,
    theirs: &ContentHash,
    base: Option<&ContentHash>,
    output: &Path,
    message: Text,
) -> Result<Value> {
    let state = state(destination)?;
    let (ours_version, theirs_version) = (selected(&state, ours)?, selected(&state, theirs)?);
    let common = ancestors(&state, ours)
        .intersection(&ancestors(&state, theirs))
        .cloned()
        .collect::<BTreeSet<_>>();
    let base = if let Some(id) = base {
        if !common.contains(id) {
            return Err("explicit merge base must be an ancestor of both versions".into());
        }
        id.clone()
    } else {
        let lowest = common
            .iter()
            .filter(|id| {
                !common
                    .iter()
                    .any(|other| other != *id && ancestors(&state, other).contains(*id))
            })
            .collect::<Vec<_>>();
        if lowest.len() != 1 {
            return Err("merge needs one unambiguous common ancestor or an explicit --base".into());
        }
        lowest[0].clone()
    };
    let base_version = selected(&state, &base)?;
    let paths = base_version
        .files
        .keys()
        .chain(ours_version.files.keys())
        .chain(theirs_version.files.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut merged = BTreeMap::new();
    let mut conflicts = Vec::new();
    let mut conflict_bytes = Vec::new();
    for path in paths {
        let (b, o, t) = (
            base_version.files.get(&path),
            ours_version.files.get(&path),
            theirs_version.files.get(&path),
        );
        let chosen = if o == t {
            Some(o)
        } else if o == b {
            Some(t)
        } else if t == b {
            Some(o)
        } else {
            None
        };
        if let Some(chosen) = chosen {
            if let Some(hash) = chosen {
                merged.insert(path, file_bytes(&state, hash)?);
            }
            continue;
        }
        let (bb, ob, tb) = (
            b.map(|h| file_bytes(&state, h)).transpose()?,
            o.map(|h| file_bytes(&state, h)).transpose()?,
            t.map(|h| file_bytes(&state, h)).transpose()?,
        );
        if let (Some(bb), Some(ob), Some(tb)) = (&bb, &ob, &tb)
            && let Some(bytes) = merge_text(bb, ob, tb)
        {
            merged.insert(path, bytes);
            continue;
        }
        let index = conflicts.len();
        conflicts.push(value!({"path":path,"base":b,"ours":o,"theirs":t,"preserved_under":format!("conflicts/{index:04}")}));
        conflict_bytes.push((index, bb, ob, tb));
    }
    let hashes = merged
        .iter()
        .map(|(p, b)| (p.clone(), ContentHash::of_bytes(b)))
        .collect();
    let structural = validate_tree(&hashes).err().map(|e| e.to_string());
    if output.symlink_metadata().is_ok() {
        return Err("merge output already exists; choose a fresh directory".into());
    }
    fs::create_dir_all(output)?;
    if structural.is_none() {
        fs::create_dir(output.join("merged"))?;
        for (path, bytes) in &merged {
            create_atomic(&output.join("merged").join(path), bytes)?;
        }
    }
    for (index, base, ours, theirs) in conflict_bytes {
        for (label, bytes) in [("base", base), ("ours", ours), ("theirs", theirs)] {
            if let Some(bytes) = bytes {
                create_atomic(
                    &output.join(format!("conflicts/{index:04}/{label}")),
                    &bytes,
                )?;
            }
        }
    }
    if structural.is_some() {
        for (label, version) in [
            ("base", base_version),
            ("ours", ours_version),
            ("theirs", theirs_version),
        ] {
            restore(&state.root, version, &output.join("inputs").join(label))?;
        }
    }
    let clean = conflicts.is_empty() && structural.is_none();
    let version = if clean {
        Some(commit(
            destination,
            Kind::Source,
            merged,
            message,
            Some(BTreeSet::from([ours.clone(), theirs.clone()])),
        )?)
    } else {
        None
    };
    let report = value!({"status":if clean{"merged"}else{"conflicted"},"base":base,"ours":ours,"theirs":theirs,"version":version,"conflicts":conflicts,"structural_conflict":structural,"output":output,"source_versions_unchanged":true,"evaluation_required":true});
    create_atomic(&output.join("merge.json"), &json(&report)?)?;
    Ok(report)
}

/// Import verified immutable DAG nodes while preserving their version identities.
/// Publication order is local to a store; it is not the identity of a version.
pub(crate) fn fetch(source: &Path, destination: &Path) -> Result<Value> {
    status(source)?;
    let incoming = state(source)?;
    init(destination)?;
    let root = root(destination)?;
    if root == incoming.root {
        return Ok(value!({"imported":0,"incoming_refs":read_refs(&incoming)?.1,"verified":true}));
    }
    let guard = lock(&root)?;
    let mut current = state(&root)?;
    let mut known = current
        .versions
        .iter()
        .map(|(e, _)| e.version.clone())
        .collect::<BTreeSet<_>>();
    let missing = incoming
        .versions
        .iter()
        .filter(|(e, _)| !known.contains(&e.version))
        .count();
    if known.len() + missing > MAX_VERSIONS {
        return Err("combined history exceeds the native 256-version limit".into());
    }
    for (original, version) in &incoming.versions {
        if known.contains(&original.version) {
            continue;
        }
        if !version.parents.is_subset(&known) {
            return Err("imported ancestry is incomplete".into());
        }
        for hash in version.files.values() {
            let path = root.join(format!("objects/{}", hash.as_str()));
            let bytes = file_bytes(&incoming, hash)?;
            if path.symlink_metadata().is_ok() {
                if bounded_bytes(&regular(&root, &path)?, MAX_FILE)? != bytes {
                    return Err("existing imported object differs".into());
                }
            } else {
                create_atomic(&path, &bytes)?;
            }
        }
        let sealed = json(&SealedVersion {
            version: version.clone(),
            content_hash: original.version.clone(),
        })?;
        let path = root.join(format!("versions/{}.json", original.version.as_str()));
        if path.symlink_metadata().is_ok() {
            let retained: SealedVersion = serde_json::from_value(ace_protocol::parse_json(
                &bounded_bytes(&regular(&root, &path)?, 1048576)?,
            )?)?;
            if retained.content_hash != original.version || retained.version != *version {
                return Err("existing imported version differs".into());
            }
        } else {
            create_atomic(&path, &sealed)?;
        }
        let mut entry = Entry {
            schema_version: ace_protocol::ProtocolVersion,
            sequence: current.versions.len() as u32 + 1,
            previous: current.versions.last().map(|(e, _)| e.content_hash.clone()),
            version: original.version.clone(),
            content_hash: ContentHash::of_bytes(b""),
        };
        entry.content_hash = entry_hash(&entry)?;
        create_atomic(
            &root.join(format!("journal/{:08}.json", entry.sequence)),
            &json(&entry)?,
        )?;
        known.insert(entry.version.clone());
        current.versions.push((entry, version.clone()));
    }
    let (events, heads) = read_refs(&incoming)?;
    if read_refs(&current)?.0.is_empty() {
        for event in events {
            create_atomic(
                &root.join(format!("refs/{:08}.json", event.sequence)),
                &json(&event)?,
            )?;
        }
    }
    drop(guard);
    status(destination)?;
    Ok(
        value!({"imported":missing,"incoming_refs":heads,"destination":destination,"verified":true,"version_identities_preserved":true}),
    )
}

#[cfg(test)]
mod collaboration_tests {
    use super::*;
    #[test]
    fn line_merge_preserves_crlf_and_rejects_overlapping_edits() {
        assert_eq!(
            merge_text(
                b"one\r\ntwo\r\nthree\r\n",
                b"ONE\r\ntwo\r\nthree\r\n",
                b"one\r\ntwo\r\nTHREE\r\n"
            ),
            Some(b"ONE\r\ntwo\r\nTHREE\r\n".to_vec())
        );
        assert_eq!(
            merge_text(b"a\nb\nc\n", b"a\nLEFT\nc\n", b"a\nRIGHT\nc\n"),
            None
        );
        assert_eq!(
            merge_text(b"a\nb\n", b"a\n", b"A\nb\n"),
            Some(b"A\n".to_vec())
        );
        assert_eq!(
            merge_text(b"a\nb\n", b"a\nleft\nb\n", b"a\nright\nb\n"),
            None
        );
        assert_eq!(
            merge_text(b"a\nb\n", b"a\nSAME\nb\n", b"a\nSAME\nb\n"),
            Some(b"a\nSAME\nb\n".to_vec())
        );
        assert_eq!(merge_text(&[0xff], b"a", b"b"), None);
    }
}
