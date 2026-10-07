use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::ValidationError;

#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(try_from = "String", into = "String")]
#[schemars(transparent, !try_from, !into)]
pub struct ContentHash(#[schemars(regex(pattern = r"^[0-9a-f]{64}$"))] String);

impl ContentHash {
    /// Hash raw artifacts (patches, datasets, locks), without a document prefix.
    pub fn of_bytes(bytes: &[u8]) -> Self {
        Self(format!("{:x}", Sha256::digest(bytes)))
    }

    /// ACE JSON v1: sorted object keys, compact JSON, domain-separated SHA-256.
    /// This is deliberately not advertised as RFC 8785/JCS.
    pub fn of_json(value: &impl Serialize) -> Result<Self, serde_json::Error> {
        let mut digest = Sha256::new();
        digest.update(b"ace:canonical-json:v1\0");
        digest.update(canonical_json(value)?);
        Ok(Self(format!("{:x}", digest.finalize())))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for ContentHash {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            Ok(Self(value))
        } else {
            Err(ValidationError(
                "hash must be 64 lowercase SHA-256 hex characters".into(),
            ))
        }
    }
}
impl From<ContentHash> for String {
    fn from(value: ContentHash) -> Self {
        value.0
    }
}

pub fn canonical_json(value: &impl Serialize) -> Result<Vec<u8>, serde_json::Error> {
    fn sort(value: serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => {
                let sorted: std::collections::BTreeMap<_, _> =
                    map.into_iter().map(|(k, v)| (k, sort(v))).collect();
                serde_json::Value::Object(sorted.into_iter().collect())
            }
            serde_json::Value::Array(values) => {
                serde_json::Value::Array(values.into_iter().map(sort).collect())
            }
            other => other,
        }
    }
    serde_json::to_vec(&sort(serde_json::to_value(value)?))
}
