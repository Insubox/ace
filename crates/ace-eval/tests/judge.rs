use ace_core::*;
use ace_eval::*;
use serde_json::json;

fn context() -> JudgeContext {
    serde_json::from_value(json!({"schema_version":1,"experiment":"EXP-test","candidate":"C-test",
        "artifact_hash":ContentHash::of_bytes(b"module"),"contract_summary":"gcd(u32,u32) -> u32",
        "intent_summary":"Reduce fuel without behavior changes","candidate_summary":"Public source summary",
        "high_impact":false,"known_failures":[]})).unwrap()
}
fn result(context: &JudgeContext, risk: f64) -> JudgeResult {
    serde_json::from_value(json!({"schema_version":1,"provider":"fixture","adapter_version":"fixture-v1","model":"fixture-flash","revision":null,
        "stage":"l1a","question_schema_version":QUESTION_VERSION,
        "input_hash":ContentHash::of_bytes(&serde_json::to_vec(context).unwrap()),
        "request_hash":ContentHash::of_bytes(b"fixture-request"),"calibration_version":null,"latency_ms":17,
        "token_usage":null,"answers":{"behavior_change_risk":risk,"prior_failure_similarity":0.1,
        "architectural_fit":[0.9,0.05,0.05],"novelty":[0.1,0.2,0.6,0.1]}})).unwrap()
}
fn policy() -> RoutingPolicy {
    RoutingPolicy {
        audit_basis_points: 0,
        ..RoutingPolicy::default()
    }
}
fn row(label: CalibrationLabel, risk: f64, winner: bool) -> CalibrationRow {
    let c = context();
    let r = result(&c, risk);
    CalibrationRow {
        context_bytes: Text::new(serde_json::to_string(&c).unwrap()).unwrap(),
        context: c,
        input_hash: r.input_hash.clone(),
        evidence: FailureReference {
            experiment: ExperimentId::new("EXP-test").unwrap(),
            evidence: EvidenceId::new("EV-test").unwrap(),
            content_hash: ContentHash::of_bytes(b"sealed"),
        },
        label,
        winner,
        result: Some(r),
        fault: None,
    }
}
fn dataset(rows: Vec<CalibrationRow>) -> CalibrationDataset {
    CalibrationDataset {
        schema_version: 1,
        version: Text::new("fixture-v1").unwrap(),
        synthetic_predictions: true,
        rows,
    }
}

#[test]
fn extreme_risk_never_kills_and_uncertainty_requests_one_second_opinion() {
    let c = context();
    for risk in [0.0, 0.1, 0.9, 1.0] {
        let r = result(&c, risk);
        let d = route(&c, &r.input_hash, Some(&r), None, &policy()).unwrap();
        assert_eq!(d.route, JudgeRoute::RealExecution);
        assert_eq!(d.hypothetical_filter, risk >= 0.8);
    }
    for risk in [0.2, 0.5, 0.8] {
        let mut r = result(&c, risk);
        assert_eq!(
            route(&c, &r.input_hash, Some(&r), None, &policy())
                .unwrap()
                .route,
            JudgeRoute::Escalate
        );
        r.stage = JudgeStage::L1b;
        assert_eq!(
            route(&c, &r.input_hash, Some(&r), None, &policy())
                .unwrap()
                .route,
            JudgeRoute::RealExecution
        );
    }
}
#[test]
fn high_impact_escalates_and_faults_bypass_to_real_execution() {
    let mut c = context();
    c.high_impact = true;
    let r = result(&c, 0.01);
    assert_eq!(
        route(&c, &r.input_hash, Some(&r), None, &policy())
            .unwrap()
            .reason,
        RouteReason::HighImpact
    );
    for fault in [
        JudgeFault::Timeout,
        JudgeFault::Unavailable,
        JudgeFault::InvalidResponse,
        JudgeFault::BudgetExhausted,
    ] {
        let d = route(&c, &r.input_hash, None, Some(fault), &policy()).unwrap();
        assert_eq!(d.route, JudgeRoute::RealExecution);
        assert!(!d.hypothetical_filter);
    }
}
#[test]
fn audit_is_stable_for_clones_and_overrides_escalation() {
    let mut c = context();
    let mut p = policy();
    p.audit_basis_points = 10_000;
    c.high_impact = true;
    let r = result(&c, 0.5);
    let d = route(&c, &r.input_hash, Some(&r), None, &p).unwrap();
    assert_eq!(d.reason, RouteReason::AuditHoldout);
    assert_eq!(d.route, JudgeRoute::RealExecution);
    c.candidate = CandidateId::new("C-clone").unwrap();
    assert!(audit_holdout(&c, &p).unwrap());
    p.audit_basis_points = 1234;
    let first = audit_holdout(&c, &p).unwrap();
    c.candidate = CandidateId::new("C-another-clone").unwrap();
    assert_eq!(first, audit_holdout(&c, &p).unwrap());
}
#[test]
fn malformed_distributions_versions_and_fingerprints_fail_validation() {
    let c = context();
    let mut r = result(&c, 0.1);
    r.answers.architectural_fit = [Probability::new(0.1).unwrap(); 3];
    assert!(r.validate().is_err());
    r = result(&c, 0.1);
    r.question_schema_version = Text::new("unknown").unwrap();
    assert!(r.validate().is_err());
    r = result(&c, 0.1);
    assert!(
        route(
            &c,
            &ContentHash::of_bytes(b"changed"),
            Some(&r),
            None,
            &policy()
        )
        .is_err()
    );
    assert!(
        route(
            &c,
            &r.input_hash,
            Some(&r),
            Some(JudgeFault::Timeout),
            &policy()
        )
        .is_err()
    );
    let mut bad = serde_json::to_value(&r).unwrap();
    bad["answers"]["behavior_change_risk"] = json!(1.01);
    assert!(serde_json::from_value::<JudgeResult>(bad).is_err());
}
#[test]
fn calibration_exposes_false_eliminations_and_never_authorizes_filtering() {
    let d = dataset(vec![row(CalibrationLabel::Qualified, 0.99, true)]);
    let report = calibrate(&d, &policy()).unwrap();
    assert_eq!(report.hypothetical_filtered_winners, 1);
    assert_eq!(report.winner_recall.unwrap().get(), 0.0);
    assert_eq!(report.hypothetical_filtered_qualified, 1);
    assert!(report.synthetic_predictions);
    assert!(!report.production_filtering_authorized);
    assert_eq!(report.missing_usage_rows, 1);
    assert_eq!(report.inference_latency_p95_ms, Some(17));
}
#[test]
fn resource_and_infrastructure_faults_do_not_become_semantic_regression_labels() {
    for label in [
        CalibrationLabel::ResourceFailure,
        CalibrationLabel::InfrastructureFailure,
    ] {
        let report = calibrate(&dataset(vec![row(label, 0.99, false)]), &policy()).unwrap();
        assert_eq!(report.scored_correctness_rows, 0);
        assert_eq!(report.regression_brier_score, None);
        assert_eq!(report.winner_recall, None);
    }
}
#[test]
fn duplicate_artifacts_mixed_models_and_forged_contexts_are_not_calibration() {
    let first = row(CalibrationLabel::Qualified, 0.1, true);
    let mut second = first.clone();
    second.context.candidate = CandidateId::new("C-clone").unwrap();
    second.context_bytes = Text::new(serde_json::to_string(&second.context).unwrap()).unwrap();
    second.input_hash = ContentHash::of_bytes(second.context_bytes.as_str().as_bytes());
    second.result.as_mut().unwrap().input_hash = second.input_hash.clone();
    assert!(
        calibrate(&dataset(vec![first.clone(), second.clone()]), &policy())
            .unwrap_err()
            .0
            .contains("duplicate artifact")
    );
    second.context.artifact_hash = ContentHash::of_bytes(b"different-module");
    second.context_bytes = Text::new(serde_json::to_string(&second.context).unwrap()).unwrap();
    second.input_hash = ContentHash::of_bytes(second.context_bytes.as_str().as_bytes());
    let r = second.result.as_mut().unwrap();
    r.input_hash = second.input_hash.clone();
    r.model = Text::new("different-model").unwrap();
    assert!(
        calibrate(&dataset(vec![first, second]), &policy())
            .unwrap_err()
            .0
            .contains("mixed judge")
    );
    let mut forged = row(CalibrationLabel::Qualified, 0.1, true);
    forged.context.high_impact = true;
    assert!(
        calibrate(&dataset(vec![forged]), &policy())
            .unwrap_err()
            .0
            .contains("bytes mismatch")
    );
}

fn second(row: &CalibrationRow, risk: f64) -> JudgeAttempt {
    let mut r = result(&row.context, risk);
    r.stage = JudgeStage::L1b;
    r.model = Text::new("fixture-clef").unwrap();
    JudgeAttempt {
        schema_version: 1,
        input_hash: row.input_hash.clone(),
        result: Some(r),
        fault: None,
    }
}
fn comparison(first: Vec<CalibrationRow>, second_stage: Vec<JudgeAttempt>) -> ComparisonDataset {
    ComparisonDataset {
        schema_version: 1,
        first_stage: dataset(first),
        second_stage,
    }
}
fn distinct(mut row: CalibrationRow) -> CalibrationRow {
    row.context.candidate = CandidateId::new("C-second").unwrap();
    row.context.artifact_hash = ContentHash::of_bytes(b"second-module");
    row.context_bytes = Text::new(serde_json::to_string(&row.context).unwrap()).unwrap();
    row.input_hash = ContentHash::of_bytes(row.context_bytes.as_str().as_bytes());
    if let Some(r) = &mut row.result {
        r.input_hash = row.input_hash.clone();
    }
    row
}

#[test]
fn comparison_exposes_a_second_opinion_losing_a_real_winner() {
    let first = row(CalibrationLabel::Qualified, 0.5, true);
    let report = compare(
        &comparison(vec![first.clone()], vec![second(&first, 0.99)]),
        &policy(),
    )
    .unwrap();
    assert_eq!(report.arms[0].included_attempts, 0);
    assert_eq!(report.arms[1].hypothetical_filtered_winners, 0);
    let combined = &report.arms[2];
    assert_eq!(combined.hypothetical_filtered_winners, 1);
    assert_eq!(combined.winner_recall.unwrap().get(), 0.0);
    assert_eq!(combined.included_attempts, 2);
    assert_eq!(combined.included_latency_sum_ms, 34);
    assert_eq!(combined.candidates[0].selected_stage, Some(JudgeStage::L1b));
    assert!(report.synthetic_predictions && report.advisory_only);
    assert!(
        !report.production_filtering_authorized
            && !report.execution_savings_measured
            && !report.time_to_champion_comparison_measured
    );
}

#[test]
fn missing_or_failed_second_opinions_retain_candidates_and_missing_telemetry() {
    let first = row(CalibrationLabel::Qualified, 0.5, true);
    let absent = compare(&comparison(vec![first.clone()], vec![]), &policy()).unwrap();
    assert_eq!(absent.arms[2].missing_second_opinions, 1);
    assert_eq!(absent.arms[2].hypothetical_filtered_winners, 0);
    let fault = JudgeAttempt {
        schema_version: 1,
        input_hash: first.input_hash.clone(),
        result: None,
        fault: Some(JudgeFault::Timeout),
    };
    let failed = compare(&comparison(vec![first], vec![fault]), &policy()).unwrap();
    let arm = &failed.arms[2];
    assert_eq!(arm.provider_faults, 1);
    assert_eq!(arm.missing_latency_attempts, 1);
    assert_eq!(arm.missing_usage_attempts, 2);
    assert_eq!(arm.winner_recall.unwrap().get(), 1.0);
}

#[test]
fn comparison_audits_override_filters_and_keep_unused_opinions_out_of_totals() {
    let first = row(CalibrationLabel::Qualified, 0.99, true);
    let mut p = policy();
    p.audit_basis_points = 10_000;
    let report = compare(
        &comparison(vec![first.clone()], vec![second(&first, 0.99)]),
        &p,
    )
    .unwrap();
    assert_eq!(report.available_second_opinions, 1);
    for arm in &report.arms[1..] {
        assert_eq!(arm.hypothetical_filtered_winners, 0);
        assert_eq!(arm.audit_count, 1);
        assert_eq!(arm.included_attempts, 1);
        assert_eq!(arm.escalation_count, 0);
    }
}

#[test]
fn comparison_rejects_wrong_stages_unmatched_inputs_and_mixed_second_cohorts() {
    let first = row(CalibrationLabel::Qualified, 0.5, true);
    let valid = second(&first, 0.1);
    let mut bad = valid.clone();
    bad.result.as_mut().unwrap().stage = JudgeStage::L1a;
    assert!(compare(&comparison(vec![first.clone()], vec![bad]), &policy()).is_err());
    assert!(
        compare(
            &comparison(vec![first.clone()], vec![valid.clone(), valid.clone()]),
            &policy()
        )
        .is_err()
    );
    let mut unmatched = valid.clone();
    unmatched.input_hash = ContentHash::of_bytes(b"wrong");
    unmatched.result.as_mut().unwrap().input_hash = unmatched.input_hash.clone();
    assert!(compare(&comparison(vec![first.clone()], vec![unmatched]), &policy()).is_err());
    let another = distinct(row(CalibrationLabel::CorrectnessFailure, 0.5, false));
    let mut changed = second(&another, 0.1);
    changed.result.as_mut().unwrap().model = Text::new("other-model").unwrap();
    assert!(
        compare(
            &comparison(vec![first, another], vec![valid, changed]),
            &policy()
        )
        .unwrap_err()
        .0
        .contains("mixed judge")
    );
}

#[test]
fn comparison_first_stage_faults_and_extreme_risk_remain_distinct() {
    let high = row(CalibrationLabel::Qualified, 0.99, true);
    let mut failed = distinct(row(CalibrationLabel::InfrastructureFailure, 0.5, false));
    failed.result = None;
    failed.fault = Some(JudgeFault::Unavailable);
    let report = compare(&comparison(vec![high, failed], vec![]), &policy()).unwrap();
    assert_eq!(report.arms[0].hypothetical_filtered, 0);
    assert_eq!(report.arms[1].hypothetical_filtered_winners, 1);
    assert_eq!(report.arms[1].provider_faults, 1);
    assert!(!report.arms[1].candidates[1].would_filter);
}

#[test]
fn comparison_telemetry_overflow_cannot_wrap_into_a_cheap_inference_claim() {
    let mut first = row(CalibrationLabel::Qualified, 0.1, true);
    first.result.as_mut().unwrap().latency_ms = u64::MAX;
    let another = distinct(row(CalibrationLabel::CorrectnessFailure, 0.1, false));
    assert!(
        compare(&comparison(vec![first, another], vec![]), &policy())
            .unwrap_err()
            .0
            .contains("overflow")
    );
}
