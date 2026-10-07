//! Regenerate illustrative domain documents. Measurements are fixtures, not real evaluations.
use ace_core::*;
use ace_protocol::{Document, Envelope};
use serde_json::{Value, json};
use std::{error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "examples/domain-kernel".into());
    let out = Path::new(&out);
    fs::create_dir_all(out)?;
    let hash = ContentHash::of_bytes(b"illustrative-fixture");
    let artifact = json!({"location": "example://fixture", "hash": hash});
    let oracle = json!({"id": "OR-example", "version": 1});
    let eval_ref = json!({"id": "ES-example", "version": 1});
    let spec = json!({
        "id": "ES-example", "version": 1, "oracle": oracle,
        "hard_constraints": {"memory_mb": {"comparison": "at_most", "value": 256.0, "unit": "MB"}},
        "required_checks": ["contract", "isolation"],
        "objectives": {"p95_ms": {"direction": "minimize", "unit": "ms"}}
    });
    let environment: Environment = serde_json::from_value(json!({
        "id": "ENV-example", "runtime": "rust-1.99.0", "image": artifact,
        "architecture": "x86_64", "dependency_locks": {"Cargo.lock": hash},
        "database_version": null, "state_schema_version": null,
        "dataset_hash": hash, "traffic_profile_hash": null, "configuration_hash": hash,
        "feature_flags": {"deterministic": true}, "model_versions": {},
        "oracle": oracle, "evalspec": eval_ref
    }))?;
    let env_hash = environment.fingerprint()?;
    let evidence: Evidence = serde_json::from_value(json!({
        "id": "EV-example", "experiment": "EXP-example", "candidate": "C-example", "cell": "ExampleCell",
        "environment_hash": env_hash, "evalspec": eval_ref,
        "measurements": {"memory_mb": {"value": 64.0, "unit": "MB"}, "p95_ms": {"value": 12.5, "unit": "ms"}},
        "checks": {"contract": "passed", "isolation": "passed"},
        "oracle": {"oracle": oracle, "outcome": "passed", "output": artifact},
        "evaluator": {"stage": "l3", "outcome": "passed", "version": "fixture-v1", "output": artifact},
        "fast_judge": null, "created_at": 1
    }))?;
    let sealed = SealedEvidence::new(evidence.clone())?;
    let policy_input = json!({
        "cell": "ExampleCell", "candidate": "C-example", "experiment": "EXP-example",
        "environment_hash": env_hash, "evalspec": spec, "evidence": sealed, "decided_at": 2
    });
    let candidate = json!({
        "id": "C-example", "parent": "CH-base", "base": artifact, "cell": "ExampleCell", "hypothesis": "H-example",
        "patch": artifact, "environment_hash": env_hash,
        "provenance": {"generator": {"provider": "manual", "model": "fixture", "revision": null},
            "input_hash": hash, "tool_versions": {"ace": "0.1.0"}, "parent_candidates": [], "created_at": 1}
    });
    let mut documents: Vec<(&str, Value)> = vec![
        (
            "project",
            json!({"id": "PRJ-example", "name": "ACE domain example", "created_at": 1}),
        ),
        (
            "cell",
            json!({"id": "ExampleCell", "project": "PRJ-example", "version": 1,
            "contract": {"input_schema": artifact, "output_schema": artifact}, "implementation": artifact,
            "capabilities": {"read": [], "write": [], "network": "deny", "allowed_hosts": [], "secrets": []},
            "resources": {"memory_mb": 256, "cpu_ms": 1000}, "state": {"mode": "stateless", "schema_version": 1},
            "dependencies": [], "invariants": ["contract", "isolation"], "evalspec": eval_ref,
            "rollback_backward_compatible": true}),
        ),
        ("evalspec", spec.clone()),
        (
            "intent",
            json!({"id": "INT-example", "cell": "ExampleCell", "objective": "Reduce p95 without changing behavior",
            "evalspec": spec, "budget": {"max_candidates": 100, "max_wall_clock_seconds": 900, "max_compute_usd": 25.0},
            "stop": {"min_relative_improvement": 0.01, "generations_without_material_gain": 4}}),
        ),
        (
            "hypothesis",
            json!({"id": "H-example", "intent": "INT-example", "cell": "ExampleCell",
            "statement": "Cache parsing to reduce repeated work", "strategy": "local-cache", "parent_knowledge": null, "created_at": 1}),
        ),
        (
            "experiment",
            json!({"id": "EXP-example", "cell": "ExampleCell", "intent": "INT-example", "hypothesis": "H-example",
            "parent_knowledge": null, "candidates": ["C-example"], "environment_hash": env_hash,
            "evalspec": eval_ref, "oracle": oracle, "status": "completed", "evidence": ["EV-example"], "created_at": 1}),
        ),
        ("candidate", candidate),
        ("evidence", serde_json::to_value(&sealed)?),
        (
            "knowledge",
            json!({"id": "K-example", "cell": "ExampleCell", "version": 1, "parents": [],
            "claims": [{"id": "CL-example", "statement": "Illustrative claim backed by fixture evidence", "status": "proven",
                "supporting_evidence": ["EV-example"], "contradicting_evidence": [], "scope": "Example only",
                "confidence": 1.0, "environment_hash": env_hash, "created_at": 2, "superseded_by": null}],
            "agent_summary": "Illustrative data; no code experiment has run", "created_at": 2}),
        ),
        (
            "champion",
            json!({"id": "CH-example", "cell": "ExampleCell", "candidate": "C-example", "artifact": artifact,
            "environment_hash": env_hash, "evalspec": eval_ref, "oracle": oracle,
            "qualification_evidence": ["EV-example"], "policy_version": "fixture-v1", "qualified_at": 2}),
        ),
        (
            "composition",
            json!({"id": "COMP-example", "project": "PRJ-example", "version": 1,
            "champions": {"ExampleCell": "CH-example"}, "previous": null, "created_at": 2}),
        ),
        ("environment", serde_json::to_value(environment)?),
        ("oracle_result", serde_json::to_value(&evidence.oracle)?),
        ("policy_input", policy_input),
    ];
    let input = serde_json::from_value(
        documents
            .iter()
            .find(|(kind, _)| *kind == "policy_input")
            .unwrap()
            .1
            .clone(),
    )?;
    documents.push((
        "policy_decision",
        serde_json::to_value(ace_policy::evaluate(&input)?)?,
    ));
    for (kind, data) in documents {
        let document: Envelope = serde_json::from_value(
            json!({"schema_version": 1, "payload": {"kind": kind, "data": data}}),
        )?;
        document.validate()?;
        fs::write(
            out.join(format!("{}.json", kind.replace('_', "-"))),
            format!("{}\n", serde_json::to_string_pretty(&document)?),
        )?;
    }
    fs::write(
        out.join("evidence.seed.json"),
        format!("{}\n", serde_json::to_string_pretty(&evidence)?),
    )?;
    // Assert the protocol variant exists independently of fixture JSON construction.
    assert!(matches!(
        Envelope::new(Document::Evidence(sealed.into())).payload,
        Document::Evidence(_)
    ));
    Ok(())
}
