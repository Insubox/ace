use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroU32,
};

use crate::*;

macro_rules! record {
    ($(#[$meta:meta])* pub struct $name:ident { $($(#[$field_meta:meta])* $field:ident: $ty:ty),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
        #[serde(deny_unknown_fields)]
        pub struct $name { $($(#[$field_meta])* pub $field: $ty),* }
    };
}

record! { pub struct Project { id: ProjectId, name: Text, created_at: Timestamp } }

record! { pub struct VersionedEvalSpec { id: EvalSpecId, version: NonZeroU32 } }
record! { pub struct VersionedOracle { id: OracleId, version: NonZeroU32 } }
record! { pub struct ArtifactRef { location: Text, hash: ContentHash } }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NetworkAccess {
    Deny,
    AllowListed,
}

record! { pub struct Capabilities {
    read: BTreeSet<Text>, write: BTreeSet<Text>, network: NetworkAccess,
    allowed_hosts: BTreeSet<Text>, secrets: BTreeSet<Text>
} }
impl Validate for Capabilities {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            self.network != NetworkAccess::Deny || self.allowed_hosts.is_empty(),
            "network deny cannot include allowed hosts",
        )?;
        require(
            self.network != NetworkAccess::AllowListed || !self.allowed_hosts.is_empty(),
            "allow-listed network requires hosts",
        )
    }
}
record! { pub struct ResourceLimits { memory_mb: NonZeroU32, cpu_ms: NonZeroU32 } }
record! { pub struct Contract { input_schema: ArtifactRef, output_schema: ArtifactRef } }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StateMode {
    Stateless,
    ReadOnly,
    Isolated,
}
record! { pub struct StateContract { mode: StateMode, schema_version: NonZeroU32 } }

record! { pub struct Cell {
    id: CellId, project: ProjectId, version: NonZeroU32, contract: Contract,
    implementation: ArtifactRef, capabilities: Capabilities, resources: ResourceLimits,
    state: StateContract, dependencies: BTreeSet<CellId>, invariants: BTreeSet<CheckName>,
    evalspec: VersionedEvalSpec, rollback_backward_compatible: bool
} }
impl Validate for Cell {
    fn validate(&self) -> Result<(), ValidationError> {
        self.capabilities.validate()?;
        require(
            !self.dependencies.contains(&self.id),
            "cell cannot depend on itself",
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Minimize,
    Maximize,
}
record! { pub struct Objective { direction: Direction, unit: Text } }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Comparison {
    AtLeast,
    AtMost,
    Equal,
}
record! { pub struct MetricConstraint { comparison: Comparison, value: FiniteNumber, unit: Text } }
record! { pub struct EvalSpec {
    id: EvalSpecId, version: NonZeroU32, oracle: VersionedOracle,
    hard_constraints: BTreeMap<MetricName, MetricConstraint>, required_checks: BTreeSet<CheckName>,
    objectives: BTreeMap<MetricName, Objective>
} }
impl Validate for EvalSpec {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            !self.objectives.is_empty(),
            "evalspec needs an optimization objective",
        )?;
        for (metric, constraint) in &self.hard_constraints {
            if let Some(objective) = self.objectives.get(metric) {
                require(
                    objective.unit == constraint.unit,
                    "constraint and objective units disagree",
                )?;
            }
        }
        Ok(())
    }
}
record! { pub struct Budget {
    max_candidates: NonZeroU32, max_wall_clock_seconds: NonZeroU32, max_compute_usd: FiniteNumber
} }
record! { pub struct StopPolicy {
    min_relative_improvement: Probability, generations_without_material_gain: NonZeroU32
} }
record! { pub struct Intent {
    id: IntentId, cell: CellId, objective: Text, evalspec: EvalSpec, budget: Budget, stop: StopPolicy
} }
impl Validate for Intent {
    fn validate(&self) -> Result<(), ValidationError> {
        self.evalspec.validate()?;
        require(
            self.budget.max_compute_usd.get() >= 0.0,
            "compute budget cannot be negative",
        )
    }
}

record! { pub struct Hypothesis {
    id: HypothesisId, intent: IntentId, cell: CellId, statement: Text,
    strategy: Text, parent_knowledge: Option<KnowledgeId>, created_at: Timestamp
} }
record! { pub struct Generator { provider: Text, model: Text, revision: Option<Text> } }
record! { pub struct Provenance {
    generator: Generator, input_hash: ContentHash, tool_versions: BTreeMap<Text, Text>,
    parent_candidates: BTreeSet<CandidateId>, created_at: Timestamp
} }
record! { pub struct Candidate {
    id: CandidateId, parent: ChampionId, base: ArtifactRef, cell: CellId,
    hypothesis: HypothesisId, patch: ArtifactRef, environment_hash: ContentHash,
    provenance: Provenance
} }
impl Validate for Candidate {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            !self.provenance.parent_candidates.contains(&self.id),
            "candidate cannot be its own parent",
        )
    }
}

record! {
    /// Only reproducibility inputs belong here; do not insert raw secret values.
    pub struct Environment {
    id: EnvironmentId, runtime: Text, image: ArtifactRef, architecture: Text,
    dependency_locks: BTreeMap<Text, ContentHash>, database_version: Option<Text>,
    state_schema_version: Option<NonZeroU32>, dataset_hash: Option<ContentHash>,
    traffic_profile_hash: Option<ContentHash>, configuration_hash: ContentHash,
    feature_flags: BTreeMap<Text, bool>, model_versions: BTreeMap<Text, Text>,
    oracle: VersionedOracle, evalspec: VersionedEvalSpec
} }
impl Environment {
    pub fn fingerprint(&self) -> Result<ContentHash, serde_json::Error> {
        let mut inputs = serde_json::to_value(self)?;
        // An environment's label is not an execution input.
        inputs
            .as_object_mut()
            .expect("environment serializes as an object")
            .remove("id");
        ContentHash::of_json(&inputs)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentStatus {
    Created,
    Running,
    Stopped,
    Completed,
}
record! { pub struct Experiment {
    id: ExperimentId, cell: CellId, intent: IntentId, hypothesis: HypothesisId,
    parent_knowledge: Option<KnowledgeId>, candidates: BTreeSet<CandidateId>,
    environment_hash: ContentHash, evalspec: VersionedEvalSpec, oracle: VersionedOracle,
    status: ExperimentStatus, evidence: BTreeSet<EvidenceId>, created_at: Timestamp
} }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationStage {
    L0,
    L1,
    L2,
    L3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckOutcome {
    Passed,
    Failed,
    NotRun,
    Error,
}
record! { pub struct OracleResult {
    oracle: VersionedOracle, outcome: CheckOutcome, output: Option<ArtifactRef>
} }
record! { pub struct EvaluatorResult {
    stage: EvaluationStage, outcome: CheckOutcome, version: Text, output: Option<ArtifactRef>
} }
record! { pub struct Measurement { value: FiniteNumber, unit: Text } }
record! { pub struct FastJudgeObservation {
    provider: Text, model: Text, revision: Option<Text>, question_schema_version: Text,
    calibration_version: Text, threshold_policy_version: Text, input_hash: ContentHash,
    typed_answers: ArtifactRef, semantic_equivalence_probability: Probability,
    regression_probability: Probability
} }

record! { pub struct Evidence {
    id: EvidenceId, experiment: ExperimentId, candidate: CandidateId, cell: CellId,
    environment_hash: ContentHash, evalspec: VersionedEvalSpec,
    measurements: BTreeMap<MetricName, Measurement>, checks: BTreeMap<CheckName, CheckOutcome>,
    oracle: OracleResult, evaluator: EvaluatorResult, fast_judge: Option<FastJudgeObservation>,
    created_at: Timestamp
} }

/// A sealed observation exposes only shared access. Mutation produces a new seal.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SealedEvidence {
    evidence: Evidence,
    content_hash: ContentHash,
}
impl SealedEvidence {
    pub fn new(evidence: Evidence) -> Result<Self, serde_json::Error> {
        let content_hash = ContentHash::of_json(&evidence)?;
        Ok(Self {
            evidence,
            content_hash,
        })
    }
    pub fn evidence(&self) -> &Evidence {
        &self.evidence
    }
    pub fn content_hash(&self) -> &ContentHash {
        &self.content_hash
    }
}
impl Validate for SealedEvidence {
    fn validate(&self) -> Result<(), ValidationError> {
        let hash =
            ContentHash::of_json(&self.evidence).map_err(|e| ValidationError(e.to_string()))?;
        require(hash == self.content_hash, "evidence content hash mismatch")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Open,
    Proven,
    Rejected,
    Superseded,
}
record! { pub struct Claim {
    id: ClaimId, statement: Text, status: ClaimStatus,
    supporting_evidence: BTreeSet<EvidenceId>, contradicting_evidence: BTreeSet<EvidenceId>,
    scope: Text, confidence: Probability, environment_hash: ContentHash,
    created_at: Timestamp, superseded_by: Option<ClaimId>
} }
impl Validate for Claim {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            self.supporting_evidence
                .is_disjoint(&self.contradicting_evidence),
            "claim cannot cite evidence as both supporting and contradicting",
        )?;
        require(
            self.status != ClaimStatus::Proven || !self.supporting_evidence.is_empty(),
            "proven claim needs supporting evidence",
        )?;
        require(
            self.status != ClaimStatus::Rejected || !self.contradicting_evidence.is_empty(),
            "rejected claim needs contradicting evidence",
        )?;
        require(
            (self.status == ClaimStatus::Superseded) == self.superseded_by.is_some(),
            "superseded status needs exactly one successor",
        )?;
        require(
            self.superseded_by.as_ref() != Some(&self.id),
            "claim cannot supersede itself",
        )
    }
}
record! { pub struct Knowledge {
    id: KnowledgeId, cell: CellId, version: NonZeroU32, parents: BTreeSet<KnowledgeId>,
    claims: Vec<Claim>, agent_summary: Text, created_at: Timestamp
} }
impl Validate for Knowledge {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            !self.parents.contains(&self.id),
            "knowledge cannot inherit itself",
        )?;
        let mut ids = BTreeSet::new();
        for claim in &self.claims {
            claim.validate()?;
            require(ids.insert(&claim.id), "duplicate claim id")?;
        }
        Ok(())
    }
}

record! { pub struct Champion {
    id: ChampionId, cell: CellId, candidate: CandidateId, artifact: ArtifactRef,
    environment_hash: ContentHash, evalspec: VersionedEvalSpec, oracle: VersionedOracle,
    qualification_evidence: BTreeSet<EvidenceId>, policy_version: Text, qualified_at: Timestamp
} }
impl Validate for Champion {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            !self.qualification_evidence.is_empty(),
            "champion must reference qualification evidence",
        )
    }
}
record! { pub struct Composition {
    id: CompositionId, project: ProjectId, version: NonZeroU32,
    champions: BTreeMap<CellId, ChampionId>, previous: Option<CompositionId>, created_at: Timestamp
} }
impl Validate for Composition {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            !self.champions.is_empty(),
            "composition needs at least one cell champion",
        )?;
        require(
            self.previous.as_ref() != Some(&self.id),
            "composition cannot replace itself",
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Decision {
    Kill {
        reason: KillReason,
    },
    Advance {
        stage: EvaluationStage,
    },
    Hold {
        reason: HoldReason,
    },
    Elite,
    /// Reserved for a separate privileged promotion decision.
    Champion,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum KillReason {
    HardCheckFailed,
    HardConstraintFailed,
    OracleFailed,
    EvaluationFailed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HoldReason {
    ContextMismatch,
    IncompleteEvidence,
    EvaluationError,
    OracleError,
    FutureEvidence,
}
record! { pub struct PolicyDecision {
    candidate: CandidateId, evidence: EvidenceId, evidence_hash: ContentHash,
    policy_version: Text, decision: Decision, reasons: Vec<Text>,
    inputs_hash: ContentHash, decided_at: Timestamp
} }
