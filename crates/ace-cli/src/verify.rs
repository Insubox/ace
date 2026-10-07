//! Independently re-evaluate an uploaded native snapshot in the current host.
//! Original timing, environment and generator identity remain caller asserted.
use crate::{Result, archive, bounded_bytes, create_atomic, json, source};
use ace_core::*;
use ace_runner::{CandidateOutcome, RunReport};
use serde_json::{Value, json as value};
use std::{fs, path::Path};

pub(crate) fn compare(original: &RunReport, checked: &RunReport) -> Value {
    let candidates: Vec<_> = original.results.iter().zip(&checked.results).map(|(a,b)| {
        let matched = a.candidate.id == b.candidate.id
            && a.candidate.patch.hash == b.candidate.patch.hash
            && a.evaluation.outcome == b.evaluation.outcome
            && a.evaluation.checked_calls == b.evaluation.checked_calls
            && a.evaluation.output_hash == b.evaluation.output_hash
            && a.evaluation.mean_fuel == b.evaluation.mean_fuel
            && a.evaluation.peak_linear_memory_bytes == b.evaluation.peak_linear_memory_bytes
            && a.decision.decision == b.decision.decision;
        value!({"candidate":b.candidate.id,"artifact_hash":b.candidate.patch.hash,
            "claimed_outcome":a.evaluation.outcome,"observed_outcome":b.evaluation.outcome,
            "matched":matched,"evidence_hash":b.evidence.content_hash(),"decision":b.decision.decision})
    }).collect();
    let incomplete = original.results.iter().chain(&checked.results).any(|r| {
        matches!(
            r.evaluation.outcome,
            CandidateOutcome::BudgetExhausted | CandidateOutcome::EvaluatorError
        )
    });
    let champion_matches = original.champion.as_ref().map(|c| &c.candidate)
        == checked.champion.as_ref().map(|c| &c.candidate);
    let matched = original.results.len() == checked.results.len()
        && champion_matches
        && candidates.iter().all(|c| c["matched"] == true);
    value!({"status":if incomplete {"inconclusive"} else if matched {"reproduced"} else {"mismatch"},
        "original_report_hash":ContentHash::of_json(original).expect("serializable report"),
        "original_environment_hash":original.environment_hash,
        "verified_report_hash":ContentHash::of_json(checked).expect("serializable report"),
        "verified_environment_hash":checked.environment_hash,
        "same_environment":original.environment_hash == checked.environment_hash,
        "harness_hash":ContentHash::of_json(&checked.config.harness).expect("serializable harness"),
        "champion":checked.champion.as_ref().map(|c|&c.candidate),"champion_matches":champion_matches,
        "candidates":candidates})
}

pub(crate) fn snapshot(root: &Path, output: &Path) -> Result<Value> {
    let snapshot = archive::verify_snapshot(root)?;
    let original = ace_runner::load_report(&root.join("run"))?;
    let sources = source::verify(&root.join("run"), &original)?;
    // An exclusive destination ensures a failed run cannot overwrite an old receipt.
    fs::create_dir(output)?;
    let input = output.join("input");
    fs::create_dir(&input)?;
    fs::create_dir(input.join("artifacts"))?;
    let mut config = original.config.clone();
    for (spec, result) in std::iter::once(&mut config.baseline)
        .chain(&mut config.candidates)
        .zip(&original.results)
    {
        let module = bounded_bytes(
            &root
                .join("run")
                .join(result.candidate.patch.location.as_str()),
            1_048_576,
        )?;
        if ContentHash::of_bytes(&module) != result.candidate.patch.hash {
            return Err("verification module changed".into());
        }
        let path = format!("artifacts/{}.wasm", result.candidate.patch.hash.as_str());
        if !input.join(&path).exists() {
            create_atomic(&input.join(&path), &module)?;
        }
        spec.module = path.into();
    }
    create_atomic(&input.join("experiment.json"), &json(&config)?)?;
    // A fresh experiment owns its actual environment, observations and policy.
    // Host timing is not compared across machines and no original seal is rewritten.
    let checked = ace_runner::run(&input, &output.join("run"), 1)?;
    ace_runner::load_report(&output.join("run"))?;
    let mut receipt = compare(&original, &checked);
    let fields = receipt.as_object_mut().expect("receipt object");
    fields.insert("schema_version".into(), value!(1));
    fields.insert("source_count".into(), value!(sources.sources.len()));
    fields.insert("snapshot_report_hash".into(), value!(snapshot.report_hash));
    fields.insert(
        "evaluator_binary_hash".into(),
        value!(ContentHash::of_bytes(&fs::read(std::env::current_exe()?)?)),
    );
    fields.insert("runtime".into(), value!(ace_runner::RUNTIME_VERSION));
    fields.insert("scope".into(), value!("This recorded GCD workload re-evaluated in the server environment. Original host timing, provenance and production fitness are not certified."));
    create_atomic(&output.join("receipt.json"), &json(&receipt)?)?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn forged_observation_and_incomplete_runs_cannot_be_reproduced() {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("input");
        crate::generate::population(&input, 1, 4).unwrap();
        let report = ace_runner::run(&input, &temp.path().join("run"), 1).unwrap();
        assert_eq!(compare(&report, &report)["status"], "reproduced");
        let mut changed = report.clone();
        changed.results[1].evaluation.mean_fuel = Some(FiniteNumber::new(0.0).unwrap());
        assert_eq!(compare(&changed, &report)["status"], "mismatch");
        changed = report.clone();
        changed.results[1].evaluation.outcome = CandidateOutcome::EvaluatorError;
        assert_eq!(compare(&changed, &report)["status"], "inconclusive");
    }
}
