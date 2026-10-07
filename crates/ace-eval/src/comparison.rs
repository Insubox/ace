use super::*;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComparisonDataset {
    pub schema_version: u32,
    pub first_stage: CalibrationDataset,
    /// At most one L1b attempt for the exact same public input bytes.
    pub second_stage: Vec<JudgeAttempt>,
}

impl Validate for ComparisonDataset {
    fn validate(&self) -> Result<(), ValidationError> {
        require(self.schema_version == 1, "unsupported comparison version")?;
        self.first_stage.validate()?;
        require(
            self.second_stage.len() <= self.first_stage.rows.len(),
            "too many second opinions",
        )?;
        for row in &self.first_stage.rows {
            if let Some(result) = &row.result {
                require(
                    result.stage == JudgeStage::L1a,
                    "comparison first stage must be L1a",
                )?;
            }
        }
        let mut seen = BTreeSet::new();
        let mut second_rows = vec![];
        let first_rows: BTreeMap<_, _> = self
            .first_stage
            .rows
            .iter()
            .map(|r| (&r.input_hash, r))
            .collect();
        for attempt in &self.second_stage {
            attempt.validate()?;
            require(seen.insert(&attempt.input_hash), "duplicate second opinion")?;
            let original = first_rows
                .get(&attempt.input_hash)
                .copied()
                .ok_or_else(|| {
                    ValidationError("second opinion has no matching frozen context".into())
                })?;
            if let Some(result) = &attempt.result {
                require(
                    result.stage == JudgeStage::L1b,
                    "comparison second stage must be L1b",
                )?;
            }
            let mut row = original.clone();
            row.result = attempt.result.clone();
            row.fault = attempt.fault;
            second_rows.push(row);
        }
        // Reuse the cohort, context, identity and distribution checks for L1b.
        if !second_rows.is_empty() {
            CalibrationDataset {
                rows: second_rows,
                schema_version: self.first_stage.schema_version,
                version: self.first_stage.version.clone(),
                synthetic_predictions: self.first_stage.synthetic_predictions,
            }
            .validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonMode {
    Bypass,
    FlashOnly,
    FlashThenClef,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComparisonCandidate {
    pub candidate: CandidateId,
    pub artifact_hash: ContentHash,
    pub evidence: FailureReference,
    pub label: CalibrationLabel,
    pub winner: bool,
    pub audit_holdout: bool,
    pub second_opinion_requested: bool,
    pub second_opinion_missing: bool,
    pub selected_stage: Option<JudgeStage>,
    pub would_filter: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComparisonArm {
    pub mode: ComparisonMode,
    pub rows: u64,
    pub hypothetical_filtered: u64,
    pub qualified_count: u64,
    pub hypothetical_filtered_qualified: u64,
    pub qualified_recall: Option<Probability>,
    pub winner_count: u64,
    pub hypothetical_filtered_winners: u64,
    pub winner_recall: Option<Probability>,
    pub audit_count: u64,
    pub escalation_count: u64,
    pub missing_second_opinions: u64,
    /// Included retained records, not a claim of separately measured billing.
    pub included_attempts: u64,
    pub provider_faults: u64,
    pub included_latency_sum_ms: u64,
    pub missing_latency_attempts: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub missing_usage_attempts: u64,
    pub candidates: Vec<ComparisonCandidate>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ComparisonReport {
    pub schema_version: u32,
    pub dataset_hash: ContentHash,
    pub policy_hash: ContentHash,
    pub policy_version: Text,
    pub synthetic_predictions: bool,
    pub advisory_only: bool,
    pub available_second_opinions: u64,
    pub production_filtering_authorized: bool,
    pub execution_savings_measured: bool,
    pub time_to_champion_comparison_measured: bool,
    pub arms: Vec<ComparisonArm>,
}

fn checked_add(total: &mut u64, value: u64) -> Result<(), ValidationError> {
    *total = total
        .checked_add(value)
        .ok_or_else(|| ValidationError("comparison telemetry total overflow".into()))?;
    Ok(())
}

fn include_attempt(
    arm: &mut ComparisonArm,
    result: Option<&JudgeResult>,
    fault: Option<JudgeFault>,
) -> Result<(), ValidationError> {
    arm.included_attempts += 1;
    arm.provider_faults += u64::from(fault.is_some());
    if let Some(result) = result {
        checked_add(&mut arm.included_latency_sum_ms, result.latency_ms)?;
        if let Some(usage) = &result.token_usage {
            checked_add(&mut arm.input_tokens, usage.input_tokens)?;
            checked_add(&mut arm.output_tokens, usage.output_tokens)?;
        } else {
            arm.missing_usage_attempts += 1;
        }
    } else {
        arm.missing_latency_attempts += 1;
        arm.missing_usage_attempts += 1;
    }
    Ok(())
}

pub fn compare(
    dataset: &ComparisonDataset,
    policy: &RoutingPolicy,
) -> Result<ComparisonReport, ValidationError> {
    dataset.validate()?;
    policy.validate()?;
    let mut report = ComparisonReport {
        schema_version: 1,
        dataset_hash: ContentHash::of_json(dataset)
            .map_err(|_| ValidationError("comparison hash failed".into()))?,
        policy_hash: ContentHash::of_json(policy)
            .map_err(|_| ValidationError("policy hash failed".into()))?,
        policy_version: policy.version.clone(),
        synthetic_predictions: dataset.first_stage.synthetic_predictions,
        advisory_only: true,
        available_second_opinions: dataset.second_stage.len() as u64,
        production_filtering_authorized: false,
        execution_savings_measured: false,
        time_to_champion_comparison_measured: false,
        arms: vec![],
    };
    let seconds: BTreeMap<_, _> = dataset
        .second_stage
        .iter()
        .map(|a| (&a.input_hash, a))
        .collect();
    for mode in [
        ComparisonMode::Bypass,
        ComparisonMode::FlashOnly,
        ComparisonMode::FlashThenClef,
    ] {
        let mut arm = ComparisonArm {
            mode,
            rows: dataset.first_stage.rows.len() as u64,
            hypothetical_filtered: 0,
            qualified_count: 0,
            hypothetical_filtered_qualified: 0,
            qualified_recall: None,
            winner_count: 0,
            hypothetical_filtered_winners: 0,
            winner_recall: None,
            audit_count: 0,
            escalation_count: 0,
            missing_second_opinions: 0,
            included_attempts: 0,
            provider_faults: 0,
            included_latency_sum_ms: 0,
            missing_latency_attempts: 0,
            input_tokens: 0,
            output_tokens: 0,
            missing_usage_attempts: 0,
            candidates: vec![],
        };
        for row in &dataset.first_stage.rows {
            let mut candidate = ComparisonCandidate {
                candidate: row.context.candidate.clone(),
                artifact_hash: row.context.artifact_hash.clone(),
                evidence: row.evidence.clone(),
                label: row.label,
                winner: row.winner,
                audit_holdout: false,
                second_opinion_requested: false,
                second_opinion_missing: false,
                selected_stage: None,
                would_filter: false,
            };
            if mode != ComparisonMode::Bypass {
                include_attempt(&mut arm, row.result.as_ref(), row.fault)?;
                let first = route(
                    &row.context,
                    &row.input_hash,
                    row.result.as_ref(),
                    row.fault,
                    policy,
                )?;
                candidate.audit_holdout = first.audit_holdout;
                candidate.selected_stage = row.result.as_ref().map(|r| r.stage);
                let mut selected = first.clone();
                // Uncertain/high-impact cases continue to execution if a second
                // stage is disabled or unavailable. No inferred missing score.
                if first.route == JudgeRoute::Escalate {
                    candidate.would_filter = false;
                    if mode == ComparisonMode::FlashThenClef {
                        candidate.second_opinion_requested = true;
                        arm.escalation_count += 1;
                        if let Some(attempt) = seconds.get(&row.input_hash) {
                            include_attempt(&mut arm, attempt.result.as_ref(), attempt.fault)?;
                            selected = route(
                                &row.context,
                                &row.input_hash,
                                attempt.result.as_ref(),
                                attempt.fault,
                                policy,
                            )?;
                            candidate.selected_stage = attempt.result.as_ref().map(|r| r.stage);
                            candidate.would_filter =
                                selected.hypothetical_filter && !selected.audit_holdout;
                        } else {
                            candidate.second_opinion_missing = true;
                            arm.missing_second_opinions += 1;
                        }
                    }
                } else {
                    candidate.would_filter =
                        selected.hypothetical_filter && !selected.audit_holdout;
                }
                arm.audit_count += u64::from(candidate.audit_holdout);
            }
            arm.hypothetical_filtered += u64::from(candidate.would_filter);
            if row.label == CalibrationLabel::Qualified {
                arm.qualified_count += 1;
                arm.hypothetical_filtered_qualified += u64::from(candidate.would_filter);
            }
            if row.winner {
                arm.winner_count += 1;
                arm.hypothetical_filtered_winners += u64::from(candidate.would_filter);
            }
            arm.candidates.push(candidate);
        }
        let recall = |count, lost| {
            if count == 0 {
                Ok(None)
            } else {
                Probability::new(1.0 - lost as f64 / count as f64).map(Some)
            }
        };
        arm.qualified_recall = recall(arm.qualified_count, arm.hypothetical_filtered_qualified)?;
        arm.winner_recall = recall(arm.winner_count, arm.hypothetical_filtered_winners)?;
        report.arms.push(arm);
    }
    Ok(report)
}
