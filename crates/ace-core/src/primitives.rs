use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};

use crate::ValidationError;

macro_rules! identifier {
    ($($name:ident),+ $(,)?) => {$(
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema)]
        #[serde(try_from = "String", into = "String")]
        #[schemars(transparent, !try_from, !into)]
        pub struct $name(
            #[schemars(length(min = 1, max = 128), regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"))]
            String
        );

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, ValidationError> {
                let value = value.into();
                let valid = !value.is_empty() && value.len() <= 128
                    && value.as_bytes()[0].is_ascii_alphanumeric()
                    && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b));
                if valid { Ok(Self(value)) } else {
                    Err(ValidationError(format!("invalid {}: expected 1–128 ASCII identifier characters", stringify!($name))))
                }
            }
            pub fn as_str(&self) -> &str { &self.0 }
        }
        impl TryFrom<String> for $name {
            type Error = ValidationError;
            fn try_from(value: String) -> Result<Self, Self::Error> { Self::new(value) }
        }
        impl From<$name> for String { fn from(value: $name) -> Self { value.0 } }
        impl FromStr for $name {
            type Err = ValidationError;
            fn from_str(value: &str) -> Result<Self, Self::Err> { Self::new(value) }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { self.0.fmt(f) }
        }
    )+};
}

identifier!(
    ProjectId,
    CellId,
    IntentId,
    HypothesisId,
    ExperimentId,
    CandidateId,
    EvidenceId,
    KnowledgeId,
    ChampionId,
    CompositionId,
    EnvironmentId,
    ClaimId,
    EvalSpecId,
    OracleId,
    MetricName,
    CheckName
);

/// Nonempty text; unlike identifiers this may contain spaces and Unicode.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[serde(try_from = "String", into = "String")]
#[schemars(transparent, !try_from, !into)]
pub struct Text(#[schemars(length(min = 1), regex(pattern = r"\S"))] String);

impl Text {
    pub fn new(value: impl Into<String>) -> Result<Self, ValidationError> {
        let value = value.into();
        if value.trim().is_empty() {
            Err(ValidationError("text must not be blank".into()))
        } else {
            Ok(Self(value))
        }
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for Text {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}
impl From<Text> for String {
    fn from(value: Text) -> Self {
        value.0
    }
}

/// Finite numeric measurements only: NaN/Infinity must never become JSON null.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(try_from = "f64", into = "f64")]
#[schemars(transparent, !try_from, !into)]
pub struct FiniteNumber(f64);

impl FiniteNumber {
    pub fn new(value: f64) -> Result<Self, ValidationError> {
        if value.is_finite() {
            Ok(Self(if value == 0.0 { 0.0 } else { value }))
        } else {
            Err(ValidationError("number must be finite".into()))
        }
    }
    pub fn get(self) -> f64 {
        self.0
    }
}
impl TryFrom<f64> for FiniteNumber {
    type Error = ValidationError;
    fn try_from(value: f64) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}
impl From<FiniteNumber> for f64 {
    fn from(value: FiniteNumber) -> Self {
        value.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(try_from = "f64", into = "f64")]
#[schemars(transparent, !try_from, !into)]
pub struct Probability(#[schemars(range(min = 0.0, max = 1.0))] f64);

impl Probability {
    pub fn new(value: f64) -> Result<Self, ValidationError> {
        if value.is_finite() && (0.0..=1.0).contains(&value) {
            Ok(Self(if value == 0.0 { 0.0 } else { value }))
        } else {
            Err(ValidationError(
                "probability must be between 0 and 1".into(),
            ))
        }
    }
    pub fn get(self) -> f64 {
        self.0
    }
}
impl TryFrom<f64> for Probability {
    type Error = ValidationError;
    fn try_from(value: f64) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}
impl From<Probability> for f64 {
    fn from(value: Probability) -> Self {
        value.0
    }
}

/// UTC Unix seconds. The caller supplies time; the kernel has no ambient clock.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(transparent)]
pub struct Timestamp(pub u64);
