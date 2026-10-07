use ace_core::*;
use ace_policy::*;
use serde_json::json;

fn input() -> PolicyInput {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/domain-kernel/policy-input.json");
    let document: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    serde_json::from_value(document["payload"]["data"].clone()).unwrap()
}
fn change(input: &mut PolicyInput, mutate: impl FnOnce(&mut Evidence)) {
    let mut evidence = input.evidence.evidence().clone();
    mutate(&mut evidence);
    input.evidence = SealedEvidence::new(evidence).unwrap();
}
fn decision(input: &PolicyInput) -> Decision {
    evaluate(input).unwrap().decision
}

#[test]
fn final_acceptance_qualifies_an_elite_but_never_promotes() {
    let input = input();
    assert_eq!(decision(&input), Decision::Elite);
    let first = evaluate(&input).unwrap();
    assert_eq!(first, evaluate(&input).unwrap());
    assert_eq!(first.evidence_hash, input.evidence.content_hash().clone());
    assert_eq!(first.policy_version.as_str(), POLICY_VERSION);
}

#[test]
fn stages_require_progressive_execution() {
    for (stage, next) in [
        (EvaluationStage::L0, EvaluationStage::L2),
        (EvaluationStage::L1, EvaluationStage::L2),
        (EvaluationStage::L2, EvaluationStage::L3),
    ] {
        let mut input = input();
        change(&mut input, |e| {
            e.evaluator.stage = stage;
            e.oracle.outcome = CheckOutcome::NotRun;
        });
        assert_eq!(decision(&input), Decision::Advance { stage: next });
    }
}

#[test]
fn judge_scores_and_l1_failure_labels_are_not_correctness_proof() {
    let mut input = input();
    change(&mut input, |e| {
        e.evaluator.stage = EvaluationStage::L1;
        e.evaluator.outcome = CheckOutcome::Failed;
        e.oracle.outcome = CheckOutcome::NotRun;
        e.fast_judge = Some(serde_json::from_value(json!({
            "provider": "cloudflare-workers-ai", "model": "@cf/cloudflare/clef-flash", "revision": null,
            "question_schema_version": "fixture-v1", "calibration_version": "fixture-v1", "threshold_policy_version": "fixture-v1",
            "input_hash": ContentHash::of_bytes(b"fixture"),
            "typed_answers": {"location": "example://answers", "hash": ContentHash::of_bytes(b"answers")},
            "semantic_equivalence_probability": 0.0, "regression_probability": 1.0
        })).unwrap());
    });
    assert_eq!(
        decision(&input),
        Decision::Advance {
            stage: EvaluationStage::L2
        }
    );
}

#[test]
fn infra_errors_never_turn_alleged_failures_into_kills() {
    let mut input = input();
    change(&mut input, |e| {
        e.evaluator.outcome = CheckOutcome::Error;
        e.oracle.outcome = CheckOutcome::Failed;
    });
    assert_eq!(
        decision(&input),
        Decision::Hold {
            reason: HoldReason::EvaluationError
        }
    );
    change(&mut input, |e| {
        e.evaluator.outcome = CheckOutcome::Passed;
        e.oracle.outcome = CheckOutcome::Error;
    });
    assert_eq!(
        decision(&input),
        Decision::Hold {
            reason: HoldReason::OracleError
        }
    );
}

#[test]
fn hard_checks_and_oracle_failures_reject_candidates() {
    let mut checked = input();
    change(&mut checked, |e| {
        e.checks
            .insert(CheckName::new("contract").unwrap(), CheckOutcome::Failed);
    });
    assert_eq!(
        decision(&checked),
        Decision::Kill {
            reason: KillReason::HardCheckFailed
        }
    );
    let mut oracle = input();
    change(&mut oracle, |e| {
        e.oracle.outcome = CheckOutcome::Failed;
    });
    assert_eq!(
        decision(&oracle),
        Decision::Kill {
            reason: KillReason::OracleFailed
        }
    );
}

#[test]
fn hard_constraint_boundary_is_inclusive() {
    let mut input = input();
    change(&mut input, |e| {
        e.measurements
            .get_mut(&MetricName::new("memory_mb").unwrap())
            .unwrap()
            .value = FiniteNumber::new(256.0).unwrap();
    });
    assert_eq!(decision(&input), Decision::Elite);
    change(&mut input, |e| {
        e.measurements
            .get_mut(&MetricName::new("memory_mb").unwrap())
            .unwrap()
            .value = FiniteNumber::new(256.01).unwrap();
    });
    assert_eq!(
        decision(&input),
        Decision::Kill {
            reason: KillReason::HardConstraintFailed
        }
    );
}

#[test]
fn known_hard_failure_is_enforced_before_soft_objective_completeness() {
    let mut input = input();
    change(&mut input, |e| {
        e.measurements.remove(&MetricName::new("p95_ms").unwrap());
        e.measurements
            .get_mut(&MetricName::new("memory_mb").unwrap())
            .unwrap()
            .value = FiniteNumber::new(999.0).unwrap();
    });
    assert_eq!(
        decision(&input),
        Decision::Kill {
            reason: KillReason::HardConstraintFailed
        }
    );
}

#[test]
fn all_constraint_comparisons_have_the_expected_direction() {
    for (comparison, target, expected) in [
        (Comparison::AtLeast, 63.0, Decision::Elite),
        (
            Comparison::AtLeast,
            65.0,
            Decision::Kill {
                reason: KillReason::HardConstraintFailed,
            },
        ),
        (Comparison::Equal, 64.0, Decision::Elite),
        (
            Comparison::Equal,
            63.0,
            Decision::Kill {
                reason: KillReason::HardConstraintFailed,
            },
        ),
    ] {
        let mut input = input();
        let constraint = input
            .evalspec
            .hard_constraints
            .get_mut(&MetricName::new("memory_mb").unwrap())
            .unwrap();
        constraint.comparison = comparison;
        constraint.value = FiniteNumber::new(target).unwrap();
        assert_eq!(decision(&input), expected);
    }
}

#[test]
fn incomplete_measurements_checks_or_final_oracle_hold() {
    let mutations: [fn(&mut Evidence); 4] = [
        |e| {
            e.measurements
                .remove(&MetricName::new("memory_mb").unwrap());
        },
        |e| {
            e.measurements.remove(&MetricName::new("p95_ms").unwrap());
        },
        |e| {
            e.checks.clear();
        },
        |e| {
            e.oracle.outcome = CheckOutcome::NotRun;
        },
    ];
    for mutate in mutations {
        let mut input = input();
        change(&mut input, mutate);
        assert_eq!(
            decision(&input),
            Decision::Hold {
                reason: HoldReason::IncompleteEvidence
            }
        );
    }
}

#[test]
fn mismatched_context_cannot_qualify_or_kill_a_candidate() {
    let mutations: [fn(&mut PolicyInput); 7] = [
        |i| i.cell = CellId::new("OtherCell").unwrap(),
        |i| i.candidate = CandidateId::new("C-other").unwrap(),
        |i| i.experiment = ExperimentId::new("EXP-other").unwrap(),
        |i| i.environment_hash = ContentHash::of_bytes(b"other"),
        |i| i.evalspec.version = std::num::NonZeroU32::new(2).unwrap(),
        |i| i.evalspec.oracle.version = std::num::NonZeroU32::new(2).unwrap(),
        |i| i.evalspec.oracle.id = OracleId::new("OR-other").unwrap(),
    ];
    for mutate in mutations {
        let mut input = input();
        mutate(&mut input);
        assert_eq!(
            decision(&input),
            Decision::Hold {
                reason: HoldReason::ContextMismatch
            }
        );
    }
}

#[test]
fn unit_mismatch_and_future_evidence_hold() {
    let mut unit = input();
    change(&mut unit, |e| {
        e.measurements
            .get_mut(&MetricName::new("memory_mb").unwrap())
            .unwrap()
            .unit = Text::new("GB").unwrap()
    });
    assert_eq!(
        decision(&unit),
        Decision::Hold {
            reason: HoldReason::ContextMismatch
        }
    );
    let mut future = input();
    future.decided_at = Timestamp(0);
    assert_eq!(
        decision(&future),
        Decision::Hold {
            reason: HoldReason::FutureEvidence
        }
    );
}

#[test]
fn deterministic_failure_and_unrun_evaluation_remain_distinct() {
    let mut input = input();
    change(&mut input, |e| e.evaluator.outcome = CheckOutcome::Failed);
    assert_eq!(
        decision(&input),
        Decision::Kill {
            reason: KillReason::EvaluationFailed
        }
    );
    change(&mut input, |e| e.evaluator.outcome = CheckOutcome::NotRun);
    assert_eq!(
        decision(&input),
        Decision::Hold {
            reason: HoldReason::IncompleteEvidence
        }
    );
}

#[test]
fn invalid_seal_is_an_error_before_evaluation() {
    let mut value = serde_json::to_value(input()).unwrap();
    value["evidence"]["evidence"]["candidate"] = json!("C-forged");
    let tampered: PolicyInput = serde_json::from_value(value).unwrap();
    assert!(evaluate(&tampered).is_err());
}
