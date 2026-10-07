//! Evaluation gates only. Ranking, promotion and cloud inference are not Phase 0.
use ace_core::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const POLICY_VERSION: &str = "ace-policy-v0";

/// Construct in the trusted Policy Plane, never from candidate-provided policy.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PolicyInput {
    pub cell: CellId,
    pub candidate: CandidateId,
    pub experiment: ExperimentId,
    pub environment_hash: ContentHash,
    pub evalspec: EvalSpec,
    pub evidence: SealedEvidence,
    pub decided_at: Timestamp,
}

impl Validate for PolicyInput {
    fn validate(&self) -> Result<(), ValidationError> {
        self.evalspec.validate()?;
        self.evidence.validate()
    }
}

/// Ignores probabilistic judge scores. Errors and missing facts never prove failure.
pub fn evaluate(input: &PolicyInput) -> Result<PolicyDecision, ValidationError> {
    input.validate()?;
    let evidence = input.evidence.evidence();
    let (decision, reason) = gate(input);
    Ok(PolicyDecision {
        candidate: input.candidate.clone(),
        evidence: evidence.id.clone(),
        evidence_hash: input.evidence.content_hash().clone(),
        policy_version: Text::new(POLICY_VERSION)?,
        decision,
        reasons: vec![Text::new(reason)?],
        inputs_hash: ContentHash::of_json(input).map_err(|e| ValidationError(e.to_string()))?,
        decided_at: input.decided_at,
    })
}

fn gate(input: &PolicyInput) -> (Decision, &'static str) {
    let ev = input.evidence.evidence();
    let spec = &input.evalspec;
    let hold = |reason, message| (Decision::Hold { reason }, message);
    let kill = |reason, message| (Decision::Kill { reason }, message);
    if ev.cell != input.cell
        || ev.candidate != input.candidate
        || ev.experiment != input.experiment
        || ev.environment_hash != input.environment_hash
        || ev.evalspec.id != spec.id
        || ev.evalspec.version != spec.version
        || ev.oracle.oracle != spec.oracle
    {
        return hold(
            HoldReason::ContextMismatch,
            "evidence belongs to a different evaluation context",
        );
    }
    if ev.created_at > input.decided_at {
        return hold(
            HoldReason::FutureEvidence,
            "evidence timestamp is later than the policy decision",
        );
    }
    // An evaluator error makes its output untrustworthy, including alleged failures.
    if ev.evaluator.outcome == CheckOutcome::Error {
        return hold(
            HoldReason::EvaluationError,
            "evaluator error requires retry or investigation",
        );
    }
    if ev.oracle.outcome == CheckOutcome::Error {
        return hold(
            HoldReason::OracleError,
            "oracle error is not evidence of candidate failure",
        );
    }
    for check in &spec.required_checks {
        if ev.checks.get(check) == Some(&CheckOutcome::Failed) {
            return kill(
                KillReason::HardCheckFailed,
                "a required deterministic check failed",
            );
        }
    }
    if ev.oracle.outcome == CheckOutcome::Failed {
        return kill(
            KillReason::OracleFailed,
            "the independent oracle rejected the candidate",
        );
    }
    // L1 is probabilistic triage, even when an adapter labels its result as failed.
    if ev.evaluator.outcome == CheckOutcome::Failed && ev.evaluator.stage != EvaluationStage::L1 {
        return kill(
            KillReason::EvaluationFailed,
            "deterministic evaluation failed",
        );
    }
    if ev.evaluator.outcome == CheckOutcome::NotRun {
        return hold(
            HoldReason::IncompleteEvidence,
            "evaluation has not executed",
        );
    }
    for check in &spec.required_checks {
        if ev.checks.get(check) != Some(&CheckOutcome::Passed) {
            return hold(
                HoldReason::IncompleteEvidence,
                "a required deterministic check is missing or inconclusive",
            );
        }
    }
    // Performance measurements are mandatory only after real execution.
    if matches!(
        ev.evaluator.stage,
        EvaluationStage::L2 | EvaluationStage::L3
    ) {
        for (metric, constraint) in &spec.hard_constraints {
            let Some(measurement) = ev.measurements.get(metric) else {
                return hold(
                    HoldReason::IncompleteEvidence,
                    "a hard-constraint measurement is missing",
                );
            };
            if measurement.unit != constraint.unit {
                return hold(
                    HoldReason::ContextMismatch,
                    "measurement and constraint units disagree",
                );
            }
            let measured = measurement.value.get();
            let target = constraint.value.get();
            let passes = match constraint.comparison {
                Comparison::AtLeast => measured >= target,
                Comparison::AtMost => measured <= target,
                Comparison::Equal => measured == target,
            };
            if !passes {
                return kill(
                    KillReason::HardConstraintFailed,
                    "a measured hard constraint was violated",
                );
            }
        }
        for (metric, objective) in &spec.objectives {
            let Some(measurement) = ev.measurements.get(metric) else {
                return hold(
                    HoldReason::IncompleteEvidence,
                    "an optimization measurement is missing",
                );
            };
            if measurement.unit != objective.unit {
                return hold(
                    HoldReason::ContextMismatch,
                    "measurement and objective units disagree",
                );
            }
        }
    }
    match ev.evaluator.stage {
        EvaluationStage::L0 | EvaluationStage::L1 => (
            Decision::Advance {
                stage: EvaluationStage::L2,
            },
            "eligible for real execution; judge scores are not correctness proof",
        ),
        EvaluationStage::L2 => (
            Decision::Advance {
                stage: EvaluationStage::L3,
            },
            "targeted evaluation passed; independent deep evaluation remains required",
        ),
        EvaluationStage::L3 if ev.oracle.outcome == CheckOutcome::Passed => (
            Decision::Elite,
            "deep evaluation and oracle passed; promotion requires a separate decision",
        ),
        EvaluationStage::L3 => hold(
            HoldReason::IncompleteEvidence,
            "final oracle acceptance is missing",
        ),
    }
}
