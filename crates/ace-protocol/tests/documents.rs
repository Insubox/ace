use ace_core::*;
use ace_protocol::*;
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn example(name: &str) -> Value {
    serde_json::from_slice(
        &fs::read(root().join(format!("examples/domain-kernel/{name}.json"))).unwrap(),
    )
    .unwrap()
}

#[test]
fn every_document_variant_roundtrips_and_matches_independent_json_schema_validation() {
    let all_schemas = schemas().unwrap();
    let validator = jsonschema::validator_for(&all_schemas["document.schema.json"]).unwrap();
    let names = [
        "project",
        "cell",
        "evalspec",
        "intent",
        "hypothesis",
        "experiment",
        "candidate",
        "evidence",
        "knowledge",
        "champion",
        "composition",
        "environment",
        "oracle-result",
        "policy-input",
        "policy-decision",
    ];
    for name in names {
        let value = example(name);
        let doc = decode(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            validator.is_valid(&value),
            "{name}: {:?}",
            validator
                .iter_errors(&value)
                .map(|e| e.to_string())
                .collect::<Vec<_>>()
        );
        let serialized = serde_json::to_value(&doc).unwrap();
        assert_eq!(value, serialized, "{name}");
        let schema_name = if name == "evidence" {
            "sealed-evidence"
        } else {
            name
        };
        let data_validator =
            jsonschema::validator_for(&all_schemas[&format!("{schema_name}.schema.json")]).unwrap();
        assert!(data_validator.is_valid(&value["payload"]["data"]), "{name}");
    }
}

#[test]
fn committed_schemas_match_rust_types_and_all_compile() {
    for (name, generated) in schemas().unwrap() {
        let actual: Value =
            serde_json::from_slice(&fs::read(root().join("schemas").join(&name)).unwrap()).unwrap();
        assert_eq!(generated, actual, "regenerate {name}");
        jsonschema::validator_for(&generated).unwrap();
    }
}

#[test]
fn unknown_fields_and_protocol_versions_are_rejected_by_schema_and_decoder() {
    let schema = schemas().unwrap().remove("document.schema.json").unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let mutations: [fn(&mut Value); 4] = [
        |v| v["schema_version"] = json!(2),
        |v| v["unexpected"] = json!(true),
        |v| v["payload"]["extra"] = json!(true),
        |v| v["payload"]["data"]["extra"] = json!(true),
    ];
    for mutate in mutations {
        let mut value = example("project");
        mutate(&mut value);
        assert!(!validator.is_valid(&value));
        assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
    }
}

#[test]
fn primitive_constraints_agree_with_schemas() {
    let schema = schemas().unwrap().remove("document.schema.json").unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    for (pointer, invalid) in [
        ("/payload/data/id", json!("../EV-1")),
        ("/payload/data/name", json!("  ")),
    ] {
        let mut value = example("project");
        *value.pointer_mut(pointer).unwrap() = invalid;
        assert!(!validator.is_valid(&value), "{pointer}");
        assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    let mut knowledge = example("knowledge");
    knowledge["payload"]["data"]["claims"][0]["confidence"] = json!(1.01);
    assert!(!validator.is_valid(&knowledge));
    assert!(decode(&serde_json::to_vec(&knowledge).unwrap()).is_err());
    let mut cell = example("cell");
    cell["payload"]["data"]["version"] = json!(0);
    assert!(!validator.is_valid(&cell));
    assert!(decode(&serde_json::to_vec(&cell).unwrap()).is_err());
}

#[test]
fn duplicate_keys_and_trailing_documents_are_rejected() {
    let raw = serde_json::to_string(&example("project")).unwrap();
    assert!(decode(format!("{raw}{raw}").as_bytes()).is_err());
    assert!(
        decode(br#"{"schema_version":1,"schema_version":1,"payload":{}}"#)
            .unwrap_err()
            .to_string()
            .contains("duplicate JSON key")
    );
    assert!(decode(br#"{"schema_version":1,"payload":{"kind":"project","data":{"id":"A","id":"B","name":"Name","created_at":1}}}"#).unwrap_err().to_string().contains("duplicate JSON key"));
}

#[test]
fn decoding_evidence_verifies_content_hash() {
    let mut value = example("evidence");
    value["payload"]["data"]["evidence"]["created_at"] = json!(99);
    assert!(
        decode(&serde_json::to_vec(&value).unwrap())
            .unwrap_err()
            .to_string()
            .contains("hash mismatch")
    );
}

#[test]
fn protocol_version_participates_in_document_hash() {
    let document = decode(&serde_json::to_vec(&example("project")).unwrap()).unwrap();
    assert_ne!(
        document.content_hash().unwrap(),
        ContentHash::of_json(&document.payload).unwrap()
    );
}
