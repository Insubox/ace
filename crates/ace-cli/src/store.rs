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
    Ok(State { root, versions })
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
        value!({"repository":state.root,"backend":"ace-native-v1","verified":true,"versions":versions,"objects":objects.len(),"tip":state.versions.last().map(|(e,_)|&e.content_hash),"snapshots":snapshots,"generator_faults":faults,"remote_push":false}),
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
