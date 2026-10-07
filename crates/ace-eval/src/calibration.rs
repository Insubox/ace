use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationLabel {
    Qualified,
    CorrectnessFailure,
    ContractFailure,
    ResourceFailure,
    InfrastructureFailure,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationRow {
    pub context: JudgeContext,
    /// Exact UTF-8 request bytes, retained so context/hash linkage is checkable.
    pub context_bytes: Text,
    pub input_hash: ContentHash,
    pub evidence: FailureReference,
    pub label: CalibrationLabel,
    pub winner: bool,
    pub result: Option<JudgeResult>,
    pub fault: Option<JudgeFault>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationDataset {
    pub schema_version: u32,
    pub version: Text,
    /// Explicit fixture provenance; synthetic scores cannot become live calibration.
    pub synthetic_predictions: bool,
    pub rows: Vec<CalibrationRow>,
}
impl Validate for CalibrationDataset {
    fn validate(&self) -> Result<(), ValidationError> {
        require(
            self.schema_version == 1,
            "unsupported calibration dataset version",
        )?;
        require(
            !self.rows.is_empty() && self.rows.len() <= 10_000,
            "invalid calibration population",
        )?;
        let mut identities = BTreeSet::new();
        let mut cohort = None;
        for row in &self.rows {
            row.context.validate()?;
            require(
                row.context_bytes.as_str().len() <= 32_768,
                "calibration context exceeds byte budget",
            )?;
            let parsed = ace_protocol::parse_json(row.context_bytes.as_str().as_bytes())
                .map_err(|_| ValidationError("invalid frozen calibration context".into()))?;
            let context: JudgeContext = serde_json::from_value(parsed)
                .map_err(|_| ValidationError("invalid calibration context contract".into()))?;
            require(
                context == row.context
                    && ContentHash::of_bytes(row.context_bytes.as_str().as_bytes())
                        == row.input_hash,
                "calibration context bytes mismatch",
            )?;
            require(
                identities.insert(&row.context.artifact_hash),
                "duplicate artifact would inflate calibration",
            )?;
            require(
                row.evidence.experiment == row.context.experiment,
                "calibration evidence experiment mismatch",
            )?;
            require(
                !row.winner || row.label == CalibrationLabel::Qualified,
                "winner must qualify through real execution",
            )?;
            require(
                row.result.is_some() != row.fault.is_some(),
                "provide exactly one calibration result or fault",
            )?;
            if let Some(result) = &row.result {
                result.validate()?;
                require(
                    result.input_hash == row.input_hash,
                    "calibration context fingerprint mismatch",
                )?;
                let key = (
                    &result.provider,
                    &result.adapter_version,
                    &result.model,
                    &result.revision,
                    result.stage,
                    &result.question_schema_version,
                );
                if let Some(previous) = cohort {
                    require(
                        previous == key,
                        "mixed judge cohorts require separate calibration",
                    )?;
                } else {
                    cohort = Some(key);
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CalibrationReport {
    pub dataset_hash: ContentHash,
    pub dataset_version: Text,
    pub policy_hash: ContentHash,
    pub synthetic_predictions: bool,
    pub rows: u64,
    pub provider_faults: u64,
    pub scored_correctness_rows: u64,
    pub regression_brier_score: Option<FiniteNumber>,
    pub qualified_count: u64,
    pub hypothetical_filtered_qualified: u64,
    pub qualified_recall: Option<Probability>,
    pub winner_count: u64,
    pub hypothetical_filtered_winners: u64,
    pub winner_recall: Option<Probability>,
    pub audited_count: u64,
    pub inference_latency_p50_ms: Option<u64>,
    pub inference_latency_p95_ms: Option<u64>,
    pub inference_input_tokens: u64,
    pub inference_output_tokens: u64,
    pub missing_usage_rows: u64,
    /// Always false in shadow mode, regardless of favorable fixture metrics.
    pub production_filtering_authorized: bool,
}

pub fn calibrate(
    dataset: &CalibrationDataset,
    policy: &RoutingPolicy,
) -> Result<CalibrationReport, ValidationError> {
    dataset.validate()?;
    policy.validate()?;
    let hash =
        |v| ContentHash::of_json(v).map_err(|_| ValidationError("calibration hash failed".into()));
    let mut out = CalibrationReport {
        dataset_hash: hash(dataset)?,
        dataset_version: dataset.version.clone(),
        policy_hash: ContentHash::of_json(policy)
            .map_err(|_| ValidationError("policy hash failed".into()))?,
        synthetic_predictions: dataset.synthetic_predictions,
        rows: dataset.rows.len() as u64,
        provider_faults: 0,
        scored_correctness_rows: 0,
        regression_brier_score: None,
        qualified_count: 0,
        hypothetical_filtered_qualified: 0,
        qualified_recall: None,
        winner_count: 0,
        hypothetical_filtered_winners: 0,
        winner_recall: None,
        audited_count: 0,
        inference_latency_p50_ms: None,
        inference_latency_p95_ms: None,
        inference_input_tokens: 0,
        inference_output_tokens: 0,
        missing_usage_rows: 0,
        production_filtering_authorized: false,
    };
    let mut squared_error = 0.0;
    let mut latencies = vec![];
    for row in &dataset.rows {
        let decision = route(
            &row.context,
            &row.input_hash,
            row.result.as_ref(),
            row.fault,
            policy,
        )?;
        out.audited_count += u64::from(decision.audit_holdout);
        out.provider_faults += u64::from(row.fault.is_some());
        if row.label == CalibrationLabel::Qualified {
            out.qualified_count += 1;
            out.hypothetical_filtered_qualified += u64::from(decision.hypothetical_filter);
        }
        if row.winner {
            out.winner_count += 1;
            out.hypothetical_filtered_winners += u64::from(decision.hypothetical_filter);
        }
        if let Some(result) = &row.result {
            latencies.push(result.latency_ms);
            match &result.token_usage {
                Some(usage) => {
                    out.inference_input_tokens = out
                        .inference_input_tokens
                        .checked_add(usage.input_tokens)
                        .ok_or_else(|| ValidationError("input token total overflow".into()))?;
                    out.inference_output_tokens = out
                        .inference_output_tokens
                        .checked_add(usage.output_tokens)
                        .ok_or_else(|| ValidationError("output token total overflow".into()))?;
                }
                None => out.missing_usage_rows += 1,
            }
            // Resource/infrastructure faults do not label semantic regression.
            if matches!(
                row.label,
                CalibrationLabel::Qualified | CalibrationLabel::CorrectnessFailure
            ) {
                let actual = f64::from(row.label == CalibrationLabel::CorrectnessFailure);
                squared_error += (result.answers.behavior_change_risk.get() - actual).powi(2);
                out.scored_correctness_rows += 1;
            }
        }
    }
    if out.scored_correctness_rows > 0 {
        out.regression_brier_score = Some(FiniteNumber::new(
            squared_error / out.scored_correctness_rows as f64,
        )?);
    }
    if out.qualified_count > 0 {
        out.qualified_recall = Some(Probability::new(
            1.0 - out.hypothetical_filtered_qualified as f64 / out.qualified_count as f64,
        )?);
    }
    if out.winner_count > 0 {
        out.winner_recall = Some(Probability::new(
            1.0 - out.hypothetical_filtered_winners as f64 / out.winner_count as f64,
        )?);
    }
    latencies.sort_unstable();
    let percentile = |percent: usize| {
        (!latencies.is_empty()).then(|| latencies[(latencies.len() * percent).div_ceil(100) - 1])
    };
    out.inference_latency_p50_ms = percentile(50);
    out.inference_latency_p95_ms = percentile(95);
    Ok(out)
}
