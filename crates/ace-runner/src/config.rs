use crate::Result;
use ace_core::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModuleSpec {
    pub id: CandidateId,
    /// Relative path beneath the experiment input directory.
    pub module: PathBuf,
    pub strategy: Text,
    pub generator: Generator,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Harness {
    /// Absent in legacy GCD documents, preserving their canonical identities.
    #[serde(default, skip_serializing_if = "HostOracle::is_gcd")]
    pub oracle: HostOracle,
    /// WASM ABI: (i32, i32) -> i32, interpreted as unsigned 32-bit values.
    pub entrypoint: CheckName,
    pub public_cases: Vec<[u32; 2]>,
    pub oracle_seed: u64,
    pub hidden_cases: u32,
    pub hidden_max_input: u32,
    pub benchmark_samples: u32,
    pub benchmark_rounds: u32,
    pub fuel_per_call: u64,
    pub memory_pages: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HostOracle {
    #[default]
    Gcd,
    MaxU32,
    MinU32,
}
impl HostOracle {
    pub fn display(&self) -> &'static str {
        if self.is_gcd() { "GCD" } else { self.cell() }
    }
    pub fn is_gcd(&self) -> bool {
        *self == Self::Gcd
    }
    pub fn cell(&self) -> &'static str {
        match self {
            Self::Gcd => "Gcd",
            Self::MaxU32 => "MaxU32",
            Self::MinU32 => "MinU32",
        }
    }
    pub fn entrypoint(&self) -> &'static str {
        match self {
            Self::Gcd => "gcd",
            Self::MaxU32 => "max_u32",
            Self::MinU32 => "min_u32",
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            Self::Gcd => "gcd",
            Self::MaxU32 => "max-u32",
            Self::MinU32 => "min-u32",
        }
    }
    pub fn evaluate(&self, a: u32, b: u32) -> u32 {
        match self {
            Self::Gcd => oracle_gcd(a, b),
            Self::MaxU32 => a.max(b),
            Self::MinU32 => a.min(b),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunConfig {
    pub schema_version: ace_protocol::ProtocolVersion,
    pub project: ProjectId,
    pub experiment: ExperimentId,
    pub cell: CellId,
    pub intent: IntentId,
    pub hypothesis: HypothesisId,
    pub baseline: ModuleSpec,
    pub candidates: Vec<ModuleSpec>,
    pub harness: Harness,
    /// Mean WASMI instruction fuel is the deterministic objective; native timing
    /// is recorded separately and must not be mistaken for production latency.
    pub min_relative_improvement: Probability,
    pub max_wall_clock_seconds: u32,
}

impl Validate for RunConfig {
    fn validate(&self) -> std::result::Result<(), ValidationError> {
        let reject = |message: &str| Err(ValidationError(message.into()));
        if self.candidates.is_empty() || self.candidates.len() > 100 {
            return reject("register between 1 and 100 candidates");
        }
        let mut ids = BTreeSet::from([self.baseline.id.clone()]);
        for candidate in &self.candidates {
            if !ids.insert(candidate.id.clone()) {
                return reject("candidate IDs must be unique, including baseline");
            }
        }
        let h = &self.harness;
        if self.cell.as_str() != h.oracle.cell() || h.entrypoint.as_str() != h.oracle.entrypoint() {
            return reject("Cell, entrypoint and independent host oracle must agree");
        }
        if h.public_cases.is_empty() || h.public_cases.len() > 128 {
            return reject("public workload must contain 1–128 cases");
        }
        if !(1..=1024).contains(&h.hidden_cases) || !(1..=65535).contains(&h.hidden_max_input) {
            return reject(
                "hidden workload must contain 1–1024 cases with an input bound of 1–65535",
            );
        }
        if !(1..=31).contains(&h.benchmark_samples) || !(1..=32).contains(&h.benchmark_rounds) {
            return reject("benchmark samples or rounds exceed supported bounds");
        }
        if !(1..=1_000_000).contains(&h.fuel_per_call) || !(1..=64).contains(&h.memory_pages) {
            return reject("fuel or memory limit exceeds supported bounds");
        }
        if !(1..=300).contains(&self.max_wall_clock_seconds) {
            return reject("wall-clock budget must be between 1 and 300 seconds");
        }
        if self.min_relative_improvement.get() >= 1.0 {
            return reject("relative improvement must be less than 1");
        }
        for module in std::iter::once(&self.baseline).chain(&self.candidates) {
            if crate::files::validate_relative(&module.module).is_err() {
                return reject("module paths must contain only relative normal components");
            }
        }
        Ok(())
    }
}

pub fn load_config(directory: &Path) -> Result<RunConfig> {
    load_config_from(&crate::files::ReadDirectory::open(directory)?)
}

pub(crate) fn load_config_from(directory: &crate::files::ReadDirectory) -> Result<RunConfig> {
    let data = directory.read(Path::new("experiment.json"), 1_048_576)?;
    let config: RunConfig = serde_json::from_value(ace_protocol::parse_json(&data)?)?;
    config.validate()?;
    Ok(config)
}

pub(crate) fn read_module(directory: &Path, path: &Path) -> Result<Vec<u8>> {
    Ok(crate::files::read_beneath(directory, path, 1_048_576)?)
}

/// Independent host-side oracle: mathematical Euclidean GCD, never a candidate export.
pub fn oracle_gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    a
}

pub fn oracle_cases(harness: &Harness) -> Vec<[u32; 2]> {
    let mut seed = harness.oracle_seed;
    let mut next = || {
        seed = seed.wrapping_add(0x9e3779b97f4a7c15);
        let mut value = seed;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((value ^ (value >> 31)) % (u64::from(harness.hidden_max_input) + 1)) as u32
    };
    (0..harness.hidden_cases)
        .map(|_| [next(), next()])
        .collect()
}
