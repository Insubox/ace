use ace_core::*;
use ace_policy::PolicyInput;
use schemars::{JsonSchema, Schema, SchemaGenerator, schema_for};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

mod decode;
pub use decode::{DecodeError, decode, parse_json};

/// Accept exactly the version implemented by this kernel.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u32", into = "u32")]
pub struct ProtocolVersion;
impl TryFrom<u32> for ProtocolVersion {
    type Error = ValidationError;
    fn try_from(version: u32) -> Result<Self, Self::Error> {
        if version == 1 {
            Ok(Self)
        } else {
            Err(ValidationError(format!(
                "unsupported schema version {version}"
            )))
        }
    }
}
impl From<ProtocolVersion> for u32 {
    fn from(_: ProtocolVersion) -> u32 {
        1
    }
}
impl JsonSchema for ProtocolVersion {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "ProtocolVersion".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        schemars::json_schema!({ "type": "integer", "const": 1 })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Document {
    Project(Project),
    Cell(Cell),
    Evalspec(EvalSpec),
    Intent(Intent),
    Hypothesis(Hypothesis),
    Experiment(Experiment),
    Candidate(Candidate),
    Evidence(Box<SealedEvidence>),
    Knowledge(Knowledge),
    Champion(Champion),
    Composition(Composition),
    Environment(Environment),
    OracleResult(OracleResult),
    PolicyInput(Box<PolicyInput>),
    PolicyDecision(PolicyDecision),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub schema_version: ProtocolVersion,
    pub payload: Document,
}
impl Envelope {
    pub fn new(payload: Document) -> Self {
        Self {
            schema_version: ProtocolVersion,
            payload,
        }
    }
    pub fn content_hash(&self) -> Result<ContentHash, serde_json::Error> {
        ContentHash::of_json(self)
    }
}
impl Validate for Envelope {
    fn validate(&self) -> Result<(), ValidationError> {
        match &self.payload {
            Document::Cell(value) => value.validate(),
            Document::Evalspec(value) => value.validate(),
            Document::Intent(value) => value.validate(),
            Document::Candidate(value) => value.validate(),
            Document::Evidence(value) => value.validate(),
            Document::Knowledge(value) => value.validate(),
            Document::Champion(value) => value.validate(),
            Document::Composition(value) => value.validate(),
            Document::PolicyInput(value) => value.validate(),
            _ => Ok(()),
        }
    }
}

/// Generated from Rust source. Check committed outputs with `ace schema --check`.
/// Schemas enforce shape; Rust Validate additionally enforces semantic invariants.
pub fn schemas() -> Result<BTreeMap<String, serde_json::Value>, serde_json::Error> {
    let mut result = BTreeMap::new();
    macro_rules! add {
        ($name:literal, $ty:ty) => {{
            let mut schema = serde_json::to_value(schema_for!($ty))?;
            schema["$id"] = format!("https://ace.org.ai/schemas/v1/{}.schema.json", $name).into();
            result.insert(format!("{}.schema.json", $name), schema);
        }};
    }
    add!("document", Envelope);
    add!("project", Project);
    add!("cell", Cell);
    add!("evalspec", EvalSpec);
    add!("intent", Intent);
    add!("hypothesis", Hypothesis);
    add!("experiment", Experiment);
    add!("candidate", Candidate);
    add!("evidence", Evidence);
    add!("sealed-evidence", SealedEvidence);
    add!("knowledge", Knowledge);
    add!("champion", Champion);
    add!("composition", Composition);
    add!("environment", Environment);
    add!("oracle-result", OracleResult);
    add!("policy-input", PolicyInput);
    add!("policy-decision", PolicyDecision);
    Ok(result)
}
