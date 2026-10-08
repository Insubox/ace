//! Fixed Python application profiles. Trusted comparisons run outside candidate containers.
use crate::{Result, create_atomic, json, store};
use ace_core::{ContentHash, Text};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json as value};
use std::{
    collections::BTreeMap,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
const TEMPLATES: &str = include_str!("../../../applications/templates.json");
const CASES: &str = include_str!("../../../applications/cases.json");
const EXECUTOR: &str = include_str!("../../../applications/executor.py");
const NAMES: [&str; 5] = [
    "main.py",
    "core.py",
    "ace-app.json",
    "dependencies.lock.json",
    "README.md",
];
fn profile(name: &str) -> Result<()> {
    if !["hello-world", "tictactoe", "calculator"].contains(&name) {
        return Err("choose hello-world, tictactoe or calculator".into());
    }
    Ok(())
}
pub(crate) fn init(name: &str, output: &Path) -> Result<Value> {
    profile(name)?;
    if output.symlink_metadata().is_ok() {
        return Err("application output already exists; choose a fresh directory".into());
    }
    std::fs::create_dir_all(output)?;
    let templates: BTreeMap<String, BTreeMap<String, String>> = serde_json::from_str(TEMPLATES)?;
    for (path, source) in &templates[name] {
        create_atomic(&output.join(path), source.as_bytes())?;
    }
    Ok(
        value!({"profile":name,"directory":output,"runtime":"python3-stdlib-v1","dependencies":"standard_library_only"}),
    )
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    profile: String,
    runtime: String,
    entrypoint: String,
    dependencies: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Lock {
    schema_version: u32,
    runtime: String,
    external: Vec<String>,
    local: Vec<String>,
}
fn source(directory: &Path) -> Result<(String, BTreeMap<String, String>)> {
    let root = ace_runner::files::ReadDirectory::open(directory)?;
    let mut files = BTreeMap::new();
    let mut total = 0;
    for name in NAMES {
        let bytes = root.read(Path::new(name), 32768)?;
        total += bytes.len();
        files.insert(name.to_owned(), String::from_utf8(bytes)?);
    }
    if total > 65536 {
        return Err("application source exceeds 64 KiB".into());
    }
    let manifest: Manifest =
        serde_json::from_value(ace_protocol::parse_json(files["ace-app.json"].as_bytes())?)?;
    let lock: Lock = serde_json::from_value(ace_protocol::parse_json(
        files["dependencies.lock.json"].as_bytes(),
    )?)?;
    profile(&manifest.profile)?;
    if manifest.schema_version != 1
        || manifest.runtime != "python3-stdlib-v1"
        || manifest.entrypoint != "main.py"
        || manifest.dependencies != "dependencies.lock.json"
        || lock.schema_version != 1
        || lock.runtime != manifest.runtime
        || !lock.external.is_empty()
        || lock.local != ["core.py"]
    {
        return Err("unsupported manifest or dependency lock; this profile uses the Python standard library only".into());
    }
    Ok((manifest.profile, files))
}
fn command(mut command: Command) -> Result<Vec<u8>> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut data = Vec::new();
        stdout.take(32769).read_to_end(&mut data).map(|_| data)
    });
    let err = std::thread::spawn(move || {
        let mut data = Vec::new();
        stderr.take(8193).read_to_end(&mut data).map(|_| data)
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Docker command exceeded its 30-second deadline".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let bytes = out.join().map_err(|_| "Docker output reader failed")??;
    let errors = err.join().map_err(|_| "Docker error reader failed")??;
    if !status.success() || bytes.len() > 32768 || errors.len() > 8192 {
        return Err("Docker operation failed or exceeded output budget; check Docker and the selected local image".into());
    }
    Ok(bytes)
}
struct Container(String);
impl Drop for Container {
    fn drop(&mut self) {
        let mut cmd = Command::new("docker");
        cmd.args(["rm", "--force", &self.0]);
        let _ = command(cmd);
    }
}
impl Container {
    fn invoke(&self, request: Value) -> Result<Value> {
        let mut cmd = Command::new("docker");
        cmd.args([
            "exec",
            &self.0,
            "python3",
            "-I",
            "-c",
            EXECUTOR,
            &serde_json::to_string(&request)?,
        ]);
        Ok(serde_json::from_value(ace_protocol::parse_json(
            &command(cmd)?,
        )?)?)
    }
}
#[derive(Deserialize, Serialize)]
struct Case {
    id: String,
    input: Value,
    expected: Value,
}
fn equivalent(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => match (a.as_f64(), b.as_f64()) {
            (Some(a), Some(b)) => a.is_finite() && (a - b).abs() <= 1e-10 * b.abs().max(1.0),
            _ => false,
        },
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equivalent(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && b.iter()
                    .all(|(key, b)| a.get(key).is_some_and(|a| equivalent(a, b)))
        }
        _ => a == b,
    }
}
pub(crate) fn test(
    directory: &Path,
    output: &Path,
    destination: Option<&Path>,
    image: &str,
) -> Result<Value> {
    if output.symlink_metadata().is_ok() {
        return Err("test output already exists; choose a fresh directory".into());
    }
    let (name, files) = source(directory)?;
    let suites: BTreeMap<String, Vec<Case>> = serde_json::from_str(CASES)?;
    let suite = &suites[&name];
    let mut inspect = Command::new("docker");
    inspect.args(["image", "inspect", "--format", "{{.Id}}", image]);
    let image_id = String::from_utf8(command(inspect)?)?.trim().to_owned();
    if !image_id.starts_with("sha256:") || image_id.len() != 71 {
        return Err("selected image has no immutable Docker identity".into());
    }
    let temporary = tempfile::tempdir()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o755))?;
    }
    for (path, text) in &files {
        create_atomic(&temporary.path().join(path), text.as_bytes())?;
    }
    let mount = format!(
        "type=bind,source={},target=/workspace/app,readonly",
        temporary.path().canonicalize()?.display()
    );
    if temporary.path().to_string_lossy().contains(',') {
        return Err("Docker application staging path contains a comma".into());
    }
    let container = Container(format!(
        "ace-app-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    let mut start = Command::new("docker");
    start.args([
        "run",
        "--detach",
        "--name",
        &container.0,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "256m",
        "--memory-swap",
        "256m",
        "--pids-limit",
        "16",
        "--cpus",
        "1",
        "--user",
        "1000:1000",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "--mount",
        &mount,
        "--entrypoint",
        "python3",
        &image_id,
        "-I",
        "-c",
        "import time;time.sleep(300)",
    ]);
    command(start)?;
    let compilation = container.invoke(value!({"mode":"compile"}))?;
    let compiled = compilation["compiled"]
        .as_bool()
        .ok_or("compiler result missing")?;
    let mut results = Vec::new();
    if compiled {
        for test in suite {
            let observation = container.invoke(value!({"mode":"run","input":test.input}))?;
            let actual = serde_json::from_str::<Value>(
                observation["stdout"]
                    .as_str()
                    .ok_or("candidate output missing")?,
            )
            .ok();
            let error = if observation["timed_out"] == true {
                Some("execution_timeout")
            } else if observation["exit_code"] != 0 {
                Some("execution_failed")
            } else if actual.is_none() {
                Some("output_not_json")
            } else {
                None
            };
            let passed = error.is_none()
                && actual
                    .as_ref()
                    .is_some_and(|a| equivalent(a, &test.expected));
            results.push(value!({"id":test.id,"passed":passed,"expected":test.expected,"actual":actual,"error":error}));
        }
    }
    drop(container);
    let passed = results.iter().filter(|r| r["passed"] == true).count();
    let report = value!({"schema_version":1,"profile":name,"runtime":compilation["runtime"],"compiled":compiled,"compile_errors":compilation["errors"],"status":if compiled&&passed==suite.len(){"passed"}else{"failed"},"cases":results,"passed":passed,"total":suite.len(),"source_hash":ContentHash::of_json(&files)?,"suite_hash":ContentHash::of_json(suite)?,"image_hash":image_id,"scope":"Recorded public application suite; fixed Python standard-library dependencies; read-only, resource-limited offline Docker container. Passing does not prove all inputs or qualify performance."});
    std::fs::create_dir_all(output)?;
    create_atomic(&output.join("report.json"), &json(&report)?)?;
    let version = if let Some(destination) = destination {
        let mut tree = files
            .into_iter()
            .map(|(p, t)| (p, t.into_bytes()))
            .collect::<BTreeMap<_, _>>();
        tree.insert("application/report.json".into(), json(&report)?);
        tree.insert("application/learning.json".into(),json(&value!({"status":report["status"],"scope":report["scope"],"failed_cases":report["cases"].as_array().unwrap().iter().filter(|c|c["passed"]!=true).collect::<Vec<_>>(),"promotion":"not_automatic"}))?);
        Some(store::commit_application_files(
            tree,
            destination,
            Text::new(format!(
                "Application {name}: {}",
                report["status"].as_str().unwrap()
            ))?,
            None,
        )?)
    } else {
        None
    };
    Ok(value!({"report":report,"native_version":version,"output":output}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_json_contract_rejects_extra_fields_and_wrong_types() {
        assert!(equivalent(&value!({"result":5}), &value!({"result":5.0})));
        assert!(!equivalent(
            &value!({"result":5,"passed":true}),
            &value!({"result":5})
        ));
        assert!(!equivalent(&value!({"result":"5"}), &value!({"result":5})));
    }
    #[test]
    fn calculator_suite_identity_matches_javascript_wire_contract() {
        let cases: Value =
            serde_json::from_str(include_str!("../../../applications/cases.json")).unwrap();
        assert_eq!(
            ContentHash::of_json(&cases["calculator"]).unwrap().as_str(),
            "76837a02d3e704362ed8c0dd2ddf189aec0f9901f30780526e5c10843d54781d"
        );
    }
    #[test]
    fn templates_have_valid_manifest_and_locked_local_dependencies() {
        for name in ["hello-world", "tictactoe", "calculator"] {
            let root = tempfile::tempdir().unwrap();
            let directory = root.path().join("app");
            init(name, &directory).unwrap();
            assert_eq!(source(&directory).unwrap().0, name);
            std::fs::write(directory.join("dependencies.lock.json"),br#"{"schema_version":1,"runtime":"python3-stdlib-v1","external":["requests"],"local":["core.py"]}"#).unwrap();
            assert!(source(&directory).is_err());
        }
    }
}
