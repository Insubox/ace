//! Browser source is data. Only the fixed profile and trusted observations
//! produce qualification; the resulting native snapshot retains all alternatives.
use crate::{Result, create_atomic, json, proposal, source, store};
use ace_core::*;
use ace_runner::CloudPlan;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Request {
    project: ProjectId,
    experiment: ExperimentId,
    wat: String,
    strategy: Text,
}

pub(crate) fn prepare(request: &Path, output: &Path) -> Result<CloudPlan> {
    let request: Request = serde_json::from_value(ace_protocol::parse_json(
        &crate::bounded_bytes(request, 65536)?,
    )?)?;
    crate::mcp::portable_name(request.project.as_str())?;
    if !request.experiment.as_str().starts_with("EXP-OBS-")
        || request.strategy.as_str().len() > 1024
    {
        return Err("invalid Observatory request scope".into());
    }
    let batch = proposal::Batch {
        schema_version: ace_protocol::ProtocolVersion,
        cell: CellId::new("Gcd")?,
        candidates: vec![proposal::Proposal {
            id: CandidateId::new("C-proposal")?,
            wat: request.wat,
            strategy: request.strategy,
            generator: Generator {
                provider: Text::new("user-proposal")?,
                model: Text::new("manual-wat")?,
                revision: None,
            },
        }],
    };
    proposal::register_scoped(
        output,
        &batch,
        None,
        Some((request.project, request.experiment.clone())),
    )?;
    let config = ace_runner::load_config(output)?;
    let plan = CloudPlan {
        schema_version: ace_protocol::ProtocolVersion,
        requested_experiment: request.experiment,
        module_hashes: std::iter::once(&config.baseline)
            .chain(&config.candidates)
            .map(|spec| {
                Ok(ContentHash::of_bytes(&crate::bounded_bytes(
                    &output.join(&spec.module),
                    1_048_576,
                )?))
            })
            .collect::<Result<Vec<_>>>()?,
        config,
    };
    plan.validate()?;
    create_atomic(&output.join("plan.json"), &json(&plan)?)?;
    Ok(plan)
}

pub(crate) fn archive(
    run: &Path,
    prepared: &Path,
    destination: &Path,
) -> Result<serde_json::Value> {
    let registration = proposal::verify(prepared)?;
    let report = ace_runner::load_report(run)?;
    proposal::verify_run(prepared, &registration, &report)?;
    source::freeze(prepared, run, &report)?;
    // The original modules are retained even for losing or rejected proposals.
    for result in &report.results {
        let name = format!("artifacts/{}.wasm", result.candidate.patch.hash.as_str());
        let bytes = crate::bounded_bytes(&prepared.join(&name), 1_048_576)?;
        if ContentHash::of_bytes(&bytes) != result.candidate.patch.hash {
            return Err("Observatory artifact changed".into());
        }
        let path = run.join(name);
        if !path.try_exists()? {
            create_atomic(&path, &bytes)?;
        }
    }
    if !destination.try_exists()? {
        fs::create_dir_all(destination.parent().unwrap_or(Path::new(".")))?;
    }
    store::save(run, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_trial_retains_a_losing_proposal_and_rejects_changed_source() -> Result<()> {
        let root = tempfile::tempdir()?;
        let request = root.path().join("request.json");
        create_atomic(&request, &json(&Request { project: ProjectId::new("private-project")?,
            experiment: ExperimentId::new("EXP-OBS-test")?,
            wat: "(module (func (export \"gcd\") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))".into(),
            strategy: Text::new("test addition against the independent GCD oracle")? })?)?;
        let prepared = root.path().join("prepared");
        let plan = prepare(&request, &prepared)?;
        assert_eq!(plan.config.project.as_str(), "private-project");
        let artifacts = prepared.join("artifacts");
        let observations = plan
            .module_hashes
            .iter()
            .enumerate()
            .map(|(i, h)| {
                Ok(ace_runner::evaluate_cloud(
                    &plan,
                    i as u32,
                    &fs::read(artifacts.join(format!("{}.wasm", h.as_str())))?,
                )?)
            })
            .collect::<Result<Vec<_>>>()?;
        let run = root.path().join("run");
        ace_runner::finish_cloud(&plan, &observations, &artifacts, &run)?;
        let native = root.path().join("native");
        let saved = archive(&run, &prepared, &native)?;
        let id: ContentHash = serde_json::from_value(saved["version"].clone())?;
        store::status(&native)?;
        let view = native.join("views").join(id.as_str());
        assert!(view.join("run/sources/C-proposal.wat").is_file());
        let learning: serde_json::Value =
            serde_json::from_slice(&fs::read(view.join("learning.json"))?)?;
        assert_eq!(
            learning["outcomes"][1]["evaluation"]["outcome"],
            "failed_correctness"
        );
        assert_eq!(
            crate::verify::snapshot(&view, &root.path().join("replayed"))?["status"],
            "reproduced"
        );
        fs::write(prepared.join("sources/C-proposal.wat"), "(module)")?;
        assert!(archive(&run, &prepared, &root.path().join("changed")).is_err());
        Ok(())
    }
}
