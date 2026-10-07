use ace_core::*;
use serde_json::json;

fn data(name: &str) -> serde_json::Value {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/domain-kernel");
    let document: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join(format!("{name}.json"))).unwrap()).unwrap();
    document["payload"]["data"].clone()
}

#[test]
fn identifiers_are_typed_and_path_safe() {
    for invalid in ["", "../EV-1", "a/b", "a\\b", "_start", "a b", "á"] {
        assert!(EvidenceId::new(invalid).is_err(), "{invalid}");
        assert!(serde_json::from_value::<EvidenceId>(json!(invalid)).is_err());
    }
    assert!(CellId::new("SearchRanking:v1").is_ok());
    assert!(CandidateId::new("C".repeat(129)).is_err());
    assert!(CandidateId::new("C".repeat(128)).is_ok());
}

#[test]
fn nonfinite_and_invalid_probabilities_cannot_enter_domain() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(FiniteNumber::new(value).is_err());
        assert!(Probability::new(value).is_err());
    }
    for value in [-0.1, 1.1] {
        assert!(Probability::new(value).is_err());
    }
    assert!(Probability::new(0.0).is_ok());
    assert!(Probability::new(1.0).is_ok());
    assert_eq!(
        serde_json::to_string(&FiniteNumber::new(-0.0).unwrap()).unwrap(),
        "0.0"
    );
    assert!(Text::new("\n\t ").is_err());
    assert!(serde_json::from_value::<Text>(json!(" ")).is_err());
}

#[test]
fn raw_hash_matches_sha256_and_document_hash_is_domain_separated() {
    assert_eq!(
        ContentHash::of_bytes(b"abc").as_str(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert!(serde_json::from_value::<ContentHash>(json!("A".repeat(64))).is_err());
    assert!(serde_json::from_value::<ContentHash>(json!("f".repeat(63))).is_err());
    let value = json!({"a": 1});
    assert_ne!(
        ContentHash::of_json(&value).unwrap(),
        ContentHash::of_bytes(&canonical_json(&value).unwrap())
    );
}

#[test]
fn canonical_hash_ignores_object_order_but_preserves_array_order() {
    let first: serde_json::Value =
        serde_json::from_str(r#"{"b":{"z":2,"a":1},"a":[1,2]}"#).unwrap();
    let reordered: serde_json::Value =
        serde_json::from_str(r#"{"a":[1,2],"b":{"a":1,"z":2}}"#).unwrap();
    assert_eq!(
        ContentHash::of_json(&first).unwrap(),
        ContentHash::of_json(&reordered).unwrap()
    );
    assert_ne!(
        ContentHash::of_json(&first).unwrap(),
        ContentHash::of_json(&json!({"a":[2,1],"b":{"a":1,"z":2}})).unwrap()
    );
}

#[test]
fn environment_fingerprint_covers_execution_inputs_not_label() {
    let mut environment: Environment = serde_json::from_value(data("environment")).unwrap();
    let original = environment.fingerprint().unwrap();
    environment.id = EnvironmentId::new("ENV-other").unwrap();
    assert_eq!(original, environment.fingerprint().unwrap());
    environment.runtime = Text::new("different-runtime").unwrap();
    assert_ne!(original, environment.fingerprint().unwrap());
}

#[test]
fn evidence_tampering_breaks_seal() {
    let mut value = data("evidence");
    let seal: SealedEvidence = serde_json::from_value(value.clone()).unwrap();
    seal.validate().unwrap();
    value["evidence"]["measurements"]["memory_mb"]["value"] = json!(999.0);
    let tampered: SealedEvidence = serde_json::from_value(value).unwrap();
    assert!(tampered.validate().is_err());
}

#[test]
fn proven_knowledge_requires_noncontradictory_evidence() {
    let mut knowledge: Knowledge = serde_json::from_value(data("knowledge")).unwrap();
    knowledge.validate().unwrap();
    knowledge.claims[0].supporting_evidence.clear();
    assert!(knowledge.validate().is_err());
    knowledge.claims[0]
        .supporting_evidence
        .insert(EvidenceId::new("EV-example").unwrap());
    knowledge.claims[0].contradicting_evidence = knowledge.claims[0].supporting_evidence.clone();
    assert!(knowledge.validate().is_err());
}

#[test]
fn lineage_and_claim_ids_cannot_be_self_referential_or_duplicated() {
    let mut candidate: Candidate = serde_json::from_value(data("candidate")).unwrap();
    candidate
        .provenance
        .parent_candidates
        .insert(candidate.id.clone());
    assert!(candidate.validate().is_err());
    let mut knowledge: Knowledge = serde_json::from_value(data("knowledge")).unwrap();
    knowledge.parents.insert(knowledge.id.clone());
    assert!(knowledge.validate().is_err());
    knowledge.parents.clear();
    knowledge.claims.push(knowledge.claims[0].clone());
    assert!(knowledge.validate().is_err());
}

#[test]
fn superseded_claim_requires_a_different_successor() {
    let mut knowledge: Knowledge = serde_json::from_value(data("knowledge")).unwrap();
    let claim = &mut knowledge.claims[0];
    claim.status = ClaimStatus::Superseded;
    assert!(claim.validate().is_err());
    claim.superseded_by = Some(claim.id.clone());
    assert!(claim.validate().is_err());
    claim.superseded_by = Some(ClaimId::new("CL-new").unwrap());
    claim.validate().unwrap();
}

#[test]
fn champions_and_compositions_need_qualification_and_cells() {
    let mut champion: Champion = serde_json::from_value(data("champion")).unwrap();
    champion.qualification_evidence.clear();
    assert!(champion.validate().is_err());
    let mut composition: Composition = serde_json::from_value(data("composition")).unwrap();
    composition.champions.clear();
    assert!(composition.validate().is_err());
}

#[test]
fn invalid_capabilities_and_negative_budgets_are_rejected() {
    let mut cell: Cell = serde_json::from_value(data("cell")).unwrap();
    cell.capabilities
        .allowed_hosts
        .insert(Text::new("example.com").unwrap());
    assert!(cell.validate().is_err());
    cell.capabilities.allowed_hosts.clear();
    cell.dependencies.insert(cell.id.clone());
    assert!(cell.validate().is_err());
    let mut intent: Intent = serde_json::from_value(data("intent")).unwrap();
    intent.budget.max_compute_usd = FiniteNumber::new(-1.0).unwrap();
    assert!(intent.validate().is_err());
}
