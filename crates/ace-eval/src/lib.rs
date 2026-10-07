//! Probabilistic advice never qualifies, kills or promotes a candidate.
//! Provider adapters live outside this portable, clock/network-free crate.
use ace_core::*;
use schemars::{JsonSchema, schema_for};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

mod calibration;
pub use calibration::*;
mod comparison;
pub use comparison::*;

pub const QUESTION_VERSION: &str = "gcd-triage-v1";
pub const ROUTING_VERSION: &str = "shadow-routing-v1";

fn require(ok: bool, message: &str) -> Result<(), ValidationError> {
    if ok {
        Ok(())
    } else {
        Err(ValidationError(message.into()))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FailureReference {
    pub experiment: ExperimentId,
    pub evidence: EvidenceId,
    pub content_hash: ContentHash,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct JudgeContext {
    pub schema_version: u32,
    pub experiment: ExperimentId,
    pub candidate: CandidateId,
    pub artifact_hash: ContentHash,
    pub contract_summary: Text,
    pub intent_summary: Text,
    /// Caller-supplied public text, not verified compilation provenance.
    pub candidate_summary: Text,
    pub high_impact: bool,
    pub known_failures: Vec<FailureReference>,
}
impl Validate for JudgeContext {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            self.schema_version == 1,
            "unsupported judge context version",
        )?;
        for s in [
            &self.contract_summary,
            &self.intent_summary,
            &self.candidate_summary,
        ] {
            require(
                s.as_str().len() <= 8192,
                "judge public summary exceeds 8 KiB",
            )?;
        }
        require(
            self.known_failures.len() <= 8,
            "too many known-failure references",
        )?;
        let unique: BTreeSet<_> = self
            .known_failures
            .iter()
            .map(|r| (&r.experiment, &r.evidence))
            .collect();
        require(
            unique.len() == self.known_failures.len(),
            "duplicate known-failure reference",
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JudgeStage {
    L1a,
    L1b,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct JudgeAnswers {
    pub behavior_change_risk: Probability,
    pub prior_failure_similarity: Probability,
    /// Ordered probabilities: good, uncertain, poor.
    pub architectural_fit: [Probability; 3],
    /// Ordered probabilities: duplicate, incremental, new, highly novel.
    pub novelty: [Probability; 4],
}
impl Validate for JudgeAnswers {
    fn validate(&self) -> Result<(), ValidationError> {
        for values in [self.architectural_fit.as_slice(), self.novelty.as_slice()] {
            let total: f64 = values.iter().map(|p| p.get()).sum();
            require(
                (total - 1.0).abs() <= 0.000_001,
                "judge distribution must sum to one",
            )?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct JudgeResult {
    pub schema_version: u32,
    pub provider: Text,
    pub adapter_version: Text,
    pub model: Text,
    pub revision: Option<Text>,
    pub stage: JudgeStage,
    pub question_schema_version: Text,
    /// Raw SHA-256 of the exact frozen public context bytes.
    pub input_hash: ContentHash,
    /// Raw SHA-256 of the actual provider request bytes retained by the adapter.
    pub request_hash: ContentHash,
    pub calibration_version: Option<Text>,
    pub latency_ms: u64,
    /// None means not reported, never zero-token inference.
    pub token_usage: Option<TokenUsage>,
    pub answers: JudgeAnswers,
}
impl Validate for JudgeResult {
    fn validate(&self) -> Result<(), ValidationError> {
        require(self.schema_version == 1, "unsupported judge result version")?;
        require(
            self.question_schema_version.as_str() == QUESTION_VERSION,
            "unsupported judge question schema",
        )?;
        self.answers.validate()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JudgeFault {
    Unavailable,
    Timeout,
    InvalidResponse,
    BudgetExhausted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct JudgeAttempt {
    pub schema_version: u32,
    pub input_hash: ContentHash,
    pub result: Option<JudgeResult>,
    pub fault: Option<JudgeFault>,
}
impl Validate for JudgeAttempt {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            self.schema_version == 1,
            "unsupported judge attempt version",
        )?;
        require(
            self.result.is_some() != self.fault.is_some(),
            "provide exactly one judge result or fault",
        )?;
        if let Some(result) = &self.result {
            result.validate()?;
            require(
                result.input_hash == self.input_hash,
                "judge attempt fingerprint mismatch",
            )?;
        }
        Ok(())
    }
}

/// The transport supplies the exact context-byte hash; it never supplies Oracles.
pub trait FastJudge {
    fn evaluate(
        &self,
        context: &JudgeContext,
        input_hash: &ContentHash,
    ) -> Result<JudgeResult, JudgeFault>;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RoutingPolicy {
    pub version: Text,
    pub uncertain_min: Probability,
    pub uncertain_max: Probability,
    pub hypothetical_filter_min: Probability,
    pub audit_basis_points: u32,
    pub audit_seed: Text,
}
impl Default for RoutingPolicy {
    fn default() -> Self {
        Self {
            version: Text::new(ROUTING_VERSION).unwrap(),
            uncertain_min: Probability::new(0.2).unwrap(),
            uncertain_max: Probability::new(0.8).unwrap(),
            hypothetical_filter_min: Probability::new(0.8).unwrap(),
            audit_basis_points: 1000,
            audit_seed: Text::new("ace-shadow-audit-v1").unwrap(),
        }
    }
}
impl Validate for RoutingPolicy {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            self.version.as_str() == ROUTING_VERSION,
            "unsupported routing policy",
        )?;
        require(
            self.uncertain_min.get() < self.uncertain_max.get(),
            "invalid uncertainty band",
        )?;
        require(self.audit_basis_points <= 10_000, "invalid audit rate")?;
        require(
            self.audit_seed.as_str().len() <= 128,
            "audit seed exceeds 128 bytes",
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JudgeRoute {
    RealExecution,
    Escalate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RouteReason {
    ProviderFault,
    AuditHoldout,
    HighImpact,
    Uncertain,
    AdvisoryOnly,
    SecondOpinionComplete,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RoutingDecision {
    pub policy_version: Text,
    pub route: JudgeRoute,
    pub reason: RouteReason,
    pub audit_holdout: bool,
    /// Recorded for calibration only; no candidate is actually filtered.
    pub hypothetical_filter: bool,
}

pub fn audit_holdout(
    context: &JudgeContext,
    policy: &RoutingPolicy,
) -> Result<bool, ValidationError> {
    context.validate()?;
    policy.validate()?;
    // Artifact identity, rather than candidate ID, keeps clones in one cohort.
    let digest =
        ContentHash::of_json(&(&context.artifact_hash, &policy.audit_seed, &policy.version))
            .map_err(|_| ValidationError("audit hash failed".into()))?;
    let bucket = u64::from_str_radix(&digest.as_str()[..16], 16).unwrap() % 10_000;
    Ok(bucket < u64::from(policy.audit_basis_points))
}

pub fn route(
    context: &JudgeContext,
    input_hash: &ContentHash,
    result: Option<&JudgeResult>,
    fault: Option<JudgeFault>,
    policy: &RoutingPolicy,
) -> Result<RoutingDecision, ValidationError> {
    context.validate()?;
    policy.validate()?;
    require(
        result.is_some() != fault.is_some(),
        "provide exactly one judge result or fault",
    )?;
    let audit = audit_holdout(context, policy)?;
    let mut decision = RoutingDecision {
        policy_version: policy.version.clone(),
        route: JudgeRoute::RealExecution,
        reason: RouteReason::ProviderFault,
        audit_holdout: audit,
        hypothetical_filter: false,
    };
    let Some(result) = result else {
        return Ok(decision);
    };
    result.validate()?;
    require(
        &result.input_hash == input_hash,
        "judge context fingerprint mismatch",
    )?;
    let risk = result.answers.behavior_change_risk.get();
    decision.hypothetical_filter = risk >= policy.hypothetical_filter_min.get()
        || result.answers.architectural_fit[2].get() >= policy.hypothetical_filter_min.get();
    decision.reason = if result.stage == JudgeStage::L1b {
        RouteReason::SecondOpinionComplete
    } else if audit {
        RouteReason::AuditHoldout
    } else if context.high_impact {
        decision.route = JudgeRoute::Escalate;
        RouteReason::HighImpact
    } else if (policy.uncertain_min.get()..=policy.uncertain_max.get()).contains(&risk)
        || result.answers.architectural_fit[1].get() >= 0.5
    {
        decision.route = JudgeRoute::Escalate;
        RouteReason::Uncertain
    } else {
        RouteReason::AdvisoryOnly
    };
    Ok(decision)
}

pub fn schemas() -> Result<BTreeMap<String, serde_json::Value>, serde_json::Error> {
    let mut out = BTreeMap::new();
    macro_rules! add {
        ($name:literal, $ty:ty) => {{
            let mut schema = serde_json::to_value(schema_for!($ty))?;
            schema["$id"] = format!("https://ace.org.ai/schemas/v1/{}.schema.json", $name).into();
            out.insert(format!("{}.schema.json", $name), schema);
        }};
    }
    add!("judge-context", JudgeContext);
    add!("judge-result", JudgeResult);
    add!("judge-attempt", JudgeAttempt);
    add!("judge-routing-policy", RoutingPolicy);
    add!("judge-routing-decision", RoutingDecision);
    add!("judge-calibration-dataset", CalibrationDataset);
    add!("judge-calibration-report", CalibrationReport);
    add!("judge-comparison-dataset", ComparisonDataset);
    add!("judge-comparison-report", ComparisonReport);
    Ok(out)
}
