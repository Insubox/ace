use ace_core::*;
use ace_runner::*;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
};

const GCD: &str = r#"
  (func (export "gcd") (param $a i32) (param $b i32) (result i32) (local $r i32)
    (block $end (loop $again
      local.get $b i32.eqz br_if $end
      local.get $a local.get $b i32.rem_u local.set $r
      local.get $b local.set $a local.get $r local.set $b br $again))
    local.get $a)
"#;

fn good() -> Vec<u8> {
    wat::parse_str(format!("(module {GCD})")).unwrap()
}

#[test]
fn distributed_tasks_aggregate_in_registration_order_and_replay() {
    let f = Fixture::new(&good());
    let bundle = f.temp.path().join("bundle");
    let plan = prepare_cloud(&f.input, &bundle).unwrap();
    let mut observations = plan
        .module_hashes
        .iter()
        .enumerate()
        .map(|(i, hash)| {
            evaluate_cloud(
                &plan,
                i as u32,
                &fs::read(
                    bundle
                        .join("artifacts")
                        .join(format!("{}.wasm", hash.as_str())),
                )
                .unwrap(),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    observations.reverse();
    let report = finish_cloud(&plan, &observations, &bundle.join("artifacts"), &f.output).unwrap();
    assert_eq!(
        report.champion.as_ref().unwrap().candidate.as_str(),
        "C-fast"
    );
    assert_eq!(load_report(&f.output).unwrap(), report);
    assert!(
        replay(&f.output, &CandidateId::new("C-fast").unwrap())
            .unwrap()
            .matched
    );
    assert!(prepare_cloud(&f.input, &bundle).is_err());
}

#[test]
fn distributed_aggregation_rejects_missing_duplicate_corrupt_and_incomparable_observations() {
    let f = Fixture::new(&good());
    let bundle = f.temp.path().join("bundle");
    let plan = prepare_cloud(&f.input, &bundle).unwrap();
    let observations = plan
        .module_hashes
        .iter()
        .enumerate()
        .map(|(i, hash)| {
            evaluate_cloud(
                &plan,
                i as u32,
                &fs::read(
                    bundle
                        .join("artifacts")
                        .join(format!("{}.wasm", hash.as_str())),
                )
                .unwrap(),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let reject = |obs: &[SealedObservation]| {
        assert!(finish_cloud(&plan, obs, &bundle.join("artifacts"), &f.output).is_err());
        assert!(!f.output.exists());
    };
    reject(&observations[..1]);
    reject(&[observations[0].clone(), observations[0].clone()]);
    let mut changed = observations.clone();
    changed[1].observation.index = 0;
    reject(&changed);
    changed = observations.clone();
    changed[1].observation.environment.image.hash = ContentHash::of_bytes(b"another host");
    changed[1].content_hash = ContentHash::of_json(&changed[1].observation).unwrap();
    reject(&changed);
    changed = observations.clone();
    changed[1].observation.evaluation.mean_fuel = None;
    changed[1].content_hash = ContentHash::of_json(&changed[1].observation).unwrap();
    reject(&changed);
    assert!(evaluate_cloud(&plan, 2, &good()).is_err());
    assert!(evaluate_cloud(&plan, 1, b"different bytes").is_err());
    let mut unsafe_seed = plan;
    unsafe_seed.config.harness.oracle_seed = u64::MAX;
    assert!(unsafe_seed.validate().is_err());
}

#[test]
fn distributed_population_of_one_hundred_candidates_produces_verified_evidence() {
    let f = Fixture::new(&good());
    f.configure(|c| {
        let original = c.candidates[0].clone();
        c.candidates = (0..100)
            .map(|i| {
                let mut m = original.clone();
                m.id = CandidateId::new(format!("C-{i:03}")).unwrap();
                m
            })
            .collect();
    });
    let bundle = f.temp.path().join("bundle");
    let plan = prepare_cloud(&f.input, &bundle).unwrap();
    let observations = plan
        .module_hashes
        .iter()
        .enumerate()
        .map(|(i, hash)| {
            evaluate_cloud(
                &plan,
                i as u32,
                &fs::read(
                    bundle
                        .join("artifacts")
                        .join(format!("{}.wasm", hash.as_str())),
                )
                .unwrap(),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let report = finish_cloud(&plan, &observations, &bundle.join("artifacts"), &f.output).unwrap();
    assert_eq!(report.results.len(), 101);
    assert!(
        report
            .results
            .iter()
            .all(|r| r.decision.decision == Decision::Elite)
    );
    assert_eq!(
        report.champion.as_ref().unwrap().candidate.as_str(),
        "C-000"
    );
    assert_eq!(report, load_report(&f.output).unwrap());
}

#[test]
fn distributed_oracle_failures_are_rejected_and_evaluator_errors_are_held() {
    let incorrect = wat::parse_str("(module (func (export \"gcd\") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))").unwrap();
    let f = Fixture::new(&incorrect);
    let bundle = f.temp.path().join("bundle");
    let plan = prepare_cloud(&f.input, &bundle).unwrap();
    let mut observations = plan
        .module_hashes
        .iter()
        .enumerate()
        .map(|(i, hash)| {
            evaluate_cloud(
                &plan,
                i as u32,
                &fs::read(
                    bundle
                        .join("artifacts")
                        .join(format!("{}.wasm", hash.as_str())),
                )
                .unwrap(),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let report = finish_cloud(&plan, &observations, &bundle.join("artifacts"), &f.output).unwrap();
    assert!(matches!(
        report.results[1].decision.decision,
        Decision::Kill {
            reason: KillReason::OracleFailed
        }
    ));
    observations[1].observation.evaluation.outcome = CandidateOutcome::EvaluatorError;
    observations[1].content_hash = ContentHash::of_json(&observations[1].observation).unwrap();
    let held = finish_cloud(
        &plan,
        &observations,
        &bundle.join("artifacts"),
        &f.temp.path().join("held"),
    )
    .unwrap();
    assert!(matches!(
        held.results[1].decision.decision,
        Decision::Hold {
            reason: HoldReason::EvaluationError
        }
    ));
    assert_eq!(held.experiment.status, ExperimentStatus::Stopped);
}
fn baseline() -> Vec<u8> {
    let slower = GCD.replace(
        "(local $r i32)",
        r#"(local $r i32) (local $noise i32)
        i32.const 128 local.set $noise
        (loop $waste local.get $noise i32.const 1 i32.sub local.tee $noise br_if $waste)"#,
    );
    wat::parse_str(format!("(module {slower})")).unwrap()
}
fn config() -> RunConfig {
    serde_json::from_value(json!({
        "schema_version":1, "project":"PRJ-test", "experiment":"EXP-test", "cell":"Gcd", "intent":"INT-test", "hypothesis":"H-test",
        "baseline":{"id":"C-base", "module":"baseline.wasm", "strategy":"baseline", "generator":{"provider":"manual","model":"fixture","revision":null}},
        "candidates":[{"id":"C-fast", "module":"fast.wasm", "strategy":"euclid", "generator":{"provider":"manual","model":"fixture","revision":null}}],
        "harness":{"entrypoint":"gcd", "public_cases":[[0,0],[0,15],[15,0],[15,21],[1000,600],[7,13],[u32::MAX,u32::MAX]],
            "oracle_seed":19,"hidden_cases":16,"hidden_max_input":1024,"benchmark_samples":3,"benchmark_rounds":2,"fuel_per_call":50000,"memory_pages":32},
        "min_relative_improvement":0.01,"max_wall_clock_seconds":60
    })).unwrap()
}
struct Fixture {
    temp: tempfile::TempDir,
    input: PathBuf,
    output: PathBuf,
}
impl Fixture {
    fn new(candidate: &[u8]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("input");
        fs::create_dir(&input).unwrap();
        fs::write(input.join("baseline.wasm"), baseline()).unwrap();
        fs::write(input.join("fast.wasm"), candidate).unwrap();
        fs::write(
            input.join("experiment.json"),
            serde_json::to_vec(&config()).unwrap(),
        )
        .unwrap();
        let output = temp.path().join("run");
        Self {
            temp,
            input,
            output,
        }
    }
    fn configure(&self, mutate: impl FnOnce(&mut RunConfig)) {
        let mut config = load_config(&self.input).unwrap();
        mutate(&mut config);
        fs::write(
            self.input.join("experiment.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
    }
    fn run(&self) -> RunReport {
        run(&self.input, &self.output, 2).unwrap()
    }
}

#[test]
fn functional_run_preserves_sources_and_materializes_a_reproducible_champion() {
    let fixture = Fixture::new(&good());
    let source_before = fs::read(fixture.input.join("fast.wasm")).unwrap();
    let report = fixture.run();
    assert_eq!(
        report.champion.as_ref().unwrap().candidate.as_str(),
        "C-fast"
    );
    assert_eq!(report.results.len(), 2);
    assert!(
        report
            .results
            .iter()
            .all(|r| r.evaluation.outcome == CandidateOutcome::Qualified)
    );
    assert!(report.results[1].evaluation.checked_calls > 20);
    assert!(report.results[1].evaluation.median_call_ns.unwrap().get() >= 0.0);
    assert_eq!(
        source_before,
        fs::read(fixture.input.join("fast.wasm")).unwrap()
    );
    assert_eq!(
        source_before,
        fs::read(fixture.output.join("champion.wasm")).unwrap()
    );
    assert_eq!(load_report(&fixture.output).unwrap(), report);
    let original_manifest = fs::read(fixture.output.join("run.json")).unwrap();
    fs::write(fixture.input.join("fast.wasm"), b"source no longer exists").unwrap();
    let replay = replay(&fixture.output, &CandidateId::new("C-fast").unwrap()).unwrap();
    assert!(replay.matched);
    assert_eq!(
        replay.observed.output_hash,
        report.results[1].evaluation.output_hash
    );
    assert_eq!(
        original_manifest,
        fs::read(fixture.output.join("run.json")).unwrap()
    );
    assert!(!report.knowledge.claims[1].supporting_evidence.is_empty());
    assert_eq!(report.knowledge.claims[1].status, ClaimStatus::Proven);
}

#[test]
fn oracle_rejects_wrong_outputs_and_preserves_learning_from_losing_code() {
    let wrong =
        wat::parse_str("(module (func (export \"gcd\") (param i32 i32) (result i32) i32.const 0))")
            .unwrap();
    let fixture = Fixture::new(&wrong);
    let report = fixture.run();
    assert_eq!(
        report.results[1].evaluation.outcome,
        CandidateOutcome::FailedCorrectness
    );
    assert_eq!(
        report.results[1].evidence.evidence().oracle.outcome,
        CheckOutcome::Failed
    );
    assert_eq!(
        report.results[1].decision.decision,
        Decision::Kill {
            reason: KillReason::OracleFailed
        }
    );
    assert_eq!(report.champion.unwrap().candidate.as_str(), "C-base");
    assert_eq!(report.knowledge.claims[1].status, ClaimStatus::Rejected);
    assert_eq!(report.knowledge.claims[1].contradicting_evidence.len(), 1);
}

#[test]
fn candidates_cannot_import_host_functions_or_wasi() {
    let imports = wat::parse_str(format!(
        "(module (import \"wasi_snapshot_preview1\" \"fd_write\" (func)) {GCD})"
    ))
    .unwrap();
    let fixture = Fixture::new(&imports);
    let report = fixture.run();
    assert_eq!(
        report.results[1].evaluation.outcome,
        CandidateOutcome::FailedContract
    );
    assert_eq!(report.results[1].evaluation.stage, EvaluationStage::L0);
    assert_eq!(report.results[1].evaluation.checked_calls, 0);
}

#[test]
fn invalid_binary_and_wrong_abi_fail_without_execution() {
    for bytes in [
        b"not WASM".to_vec(),
        wat::parse_str("(module (func (export \"gcd\") (result i64) i64.const 1))").unwrap(),
    ] {
        let fixture = Fixture::new(&bytes);
        let report = fixture.run();
        assert!(matches!(
            report.results[1].evaluation.outcome,
            CandidateOutcome::InvalidModule | CandidateOutcome::FailedContract
        ));
        assert_eq!(report.results[1].evaluation.checked_calls, 0);
        assert_eq!(
            report.results[1].evidence.evidence().oracle.outcome,
            CheckOutcome::NotRun
        );
    }
}

#[test]
fn infinite_loops_and_start_functions_are_bounded_by_fuel() {
    for source in [
        "(module (func (export \"gcd\") (param i32 i32) (result i32) (loop $forever br $forever) unreachable))".into(),
        format!("(module (func $start (loop $forever br $forever)) (start $start) {GCD})"),
    ] {
        let fixture=Fixture::new(&wat::parse_str(source).unwrap()); let report=fixture.run();
        assert_eq!(report.results[1].evaluation.outcome,CandidateOutcome::FailedResourceLimit);
        assert!(report.results[1].evaluation.reason.as_str().contains("fuel"));
        assert!(matches!(report.results[1].decision.decision,Decision::Kill{..}));
    }
}

#[test]
fn linear_memory_and_table_growth_cannot_exceed_limits() {
    let candidates=[
        format!("(module (memory 65) {GCD})"),
        "(module (memory 1) (func (export \"gcd\") (param i32 i32) (result i32) i32.const 100 memory.grow drop i32.const 0))".into(),
        format!("(module (table 1025 funcref) {GCD})"),
    ];
    for source in candidates {
        let fixture = Fixture::new(&wat::parse_str(source).unwrap());
        let report = fixture.run();
        assert_eq!(
            report.results[1].evaluation.outcome,
            CandidateOutcome::FailedResourceLimit
        );
        assert_ne!(report.results[1].decision.decision, Decision::Elite);
    }
}

#[test]
fn runtime_arithmetic_traps_are_correctness_failures_not_infrastructure_errors() {
    let trapped=wat::parse_str("(module (func (export \"gcd\") (param i32 i32) (result i32) i32.const 1 i32.const 0 i32.div_u))").unwrap();
    let fixture = Fixture::new(&trapped);
    let report = fixture.run();
    assert_eq!(
        report.results[1].evaluation.outcome,
        CandidateOutcome::FailedCorrectness
    );
    assert_eq!(
        report.results[1].evidence.evidence().oracle.outcome,
        CheckOutcome::Failed
    );
}

#[test]
fn baseline_must_qualify_before_any_local_champion_is_selected() {
    let fixture = Fixture::new(&good());
    fs::write(fixture.input.join("baseline.wasm"), b"invalid").unwrap();
    let report = fixture.run();
    assert!(report.champion.is_none());
    assert_eq!(
        report.results[1].evaluation.outcome,
        CandidateOutcome::Qualified
    );
    assert!(!fixture.output.join("champion.wasm").exists());
}

#[test]
fn min_gain_threshold_retains_baseline_and_pareto_frontier_is_stable() {
    let fixture = Fixture::new(&good());
    let report = fixture.run();
    let mut results = report.results.clone();
    results[0].evaluation.mean_fuel = Some(FiniteNumber::new(100.0).unwrap());
    results[1].evaluation.mean_fuel = Some(FiniteNumber::new(99.0).unwrap());
    let (elites, champion) = select(&results, Probability::new(0.02).unwrap());
    assert_eq!(champion.unwrap().as_str(), "C-base");
    assert!(elites.contains(&CandidateId::new("C-fast").unwrap()));
    results[1].evaluation.peak_linear_memory_bytes = 1;
    let (elites, champion) = select(&results, Probability::new(0.0).unwrap());
    assert_eq!(champion.unwrap().as_str(), "C-base");
    assert_eq!(elites.len(), 2);
    results[1].evaluation.mean_fuel = None;
    assert_eq!(
        select(&results, Probability::new(0.0).unwrap())
            .1
            .unwrap()
            .as_str(),
        "C-base"
    );
}

#[test]
fn population_of_100_registered_candidates_runs_with_bounded_parallelism() {
    let fixture = Fixture::new(&good());
    fixture.configure(|config| {
        let template = config.candidates[0].clone();
        config.candidates = (0..100)
            .map(|n| {
                let mut candidate = template.clone();
                candidate.id = CandidateId::new(format!("C-{n:03}")).unwrap();
                candidate
            })
            .collect();
    });
    let report = fixture.run();
    assert_eq!(report.results.len(), 101);
    assert!(
        report
            .results
            .iter()
            .all(|r| r.evaluation.outcome == CandidateOutcome::Qualified)
    );
    assert_eq!(report.champion.unwrap().candidate.as_str(), "C-000");
    load_report(&fixture.output).unwrap();
}

#[test]
fn corrupt_artifacts_manifests_and_evidence_cannot_be_loaded_or_replayed() {
    for target in ["module", "manifest", "evidence", "evaluation", "champion"] {
        let fixture = Fixture::new(&good());
        let report = fixture.run();
        let path = match target {
            "module" => fixture
                .output
                .join(report.results[1].candidate.patch.location.as_str()),
            "manifest" => fixture.output.join("run.json"),
            "evidence" => fixture.output.join("candidates/C-fast/evidence.json"),
            "evaluation" => fixture.output.join("candidates/C-fast/evaluation.json"),
            _ => fixture.output.join("champion.wasm"),
        };
        fs::write(path, b"corruption").unwrap();
        assert!(load_report(&fixture.output).is_err());
        assert!(replay(&fixture.output, &CandidateId::new("C-fast").unwrap()).is_err());
    }
}

#[test]
fn preexisting_output_incomplete_runs_and_unknown_candidates_are_rejected() {
    let fixture = Fixture::new(&good());
    fixture.run();
    let before = fs::read(fixture.output.join("run.json")).unwrap();
    assert!(run(&fixture.input, &fixture.output, 1).is_err());
    assert_eq!(before, fs::read(fixture.output.join("run.json")).unwrap());
    assert!(replay(&fixture.output, &CandidateId::new("C-unknown").unwrap()).is_err());
    fs::remove_file(fixture.output.join("run.json")).unwrap();
    assert!(load_report(&fixture.output).is_err());
}

#[test]
fn repeated_plans_create_distinct_experiment_and_observation_identities() {
    let first = Fixture::new(&good());
    let second = Fixture::new(&good());
    let a = first.run();
    let b = second.run();
    assert_eq!(a.requested_experiment, b.requested_experiment);
    assert_ne!(a.experiment.id, b.experiment.id);
    assert_ne!(
        a.results[0].evidence.evidence().id,
        b.results[0].evidence.evidence().id
    );
    assert_ne!(a.champion.unwrap().id, b.champion.unwrap().id);
    // Scope identities must not invalidate an otherwise identical execution environment.
    assert_eq!(a.environment_hash, b.environment_hash);
}

#[test]
fn paths_escaping_the_input_directory_are_rejected_before_execution() {
    let fixture = Fixture::new(&good());
    fs::write(fixture.temp.path().join("outside.wasm"), good()).unwrap();
    fixture.configure(|config| config.candidates[0].module = "../outside.wasm".into());
    assert!(run(&fixture.input, &fixture.output, 1).is_err());
    assert!(!fixture.output.exists());
}

#[cfg(unix)]
#[test]
fn symlinks_to_external_artifacts_are_rejected() {
    let fixture = Fixture::new(&good());
    let outside = fixture.temp.path().join("outside.wasm");
    fs::write(&outside, good()).unwrap();
    fs::remove_file(fixture.input.join("fast.wasm")).unwrap();
    std::os::unix::fs::symlink(outside, fixture.input.join("fast.wasm")).unwrap();
    assert!(run(&fixture.input, &fixture.output, 1).is_err());
}

#[test]
fn invalid_limits_population_and_job_counts_are_rejected() {
    let fixture = Fixture::new(&good());
    assert!(run(&fixture.input, &fixture.output, 0).is_err());
    assert!(run(&fixture.input, &fixture.output, 9).is_err());
    let mutations: [fn(&mut RunConfig); 6] = [
        |c| c.harness.fuel_per_call = 0,
        |c| c.harness.memory_pages = 65,
        |c| c.harness.benchmark_rounds = 0,
        |c| c.harness.public_cases.clear(),
        |c| c.candidates[0].id = c.baseline.id.clone(),
        |c| c.max_wall_clock_seconds = 0,
    ];
    for mutate in mutations {
        let mut config = config();
        mutate(&mut config);
        assert!(config.validate().is_err());
    }
}

#[test]
fn independent_oracle_and_hidden_workload_are_deterministic() {
    assert_eq!(oracle_gcd(0, 0), 0);
    assert_eq!(oracle_gcd(u32::MAX, u32::MAX), u32::MAX);
    assert_eq!(oracle_gcd(1000, 600), 200);
    assert_eq!(oracle_gcd(15, 21), 3);
    let mut harness = config().harness;
    let original = oracle_cases(&harness);
    assert_eq!(original, oracle_cases(&harness));
    harness.oracle_seed += 1;
    assert_ne!(original, oracle_cases(&harness));
}

#[test]
fn runner_schemas_compile_and_match_the_example_plan() {
    let schemas = runner_schemas().unwrap();
    for schema in schemas.values() {
        jsonschema::validator_for(schema).unwrap();
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/function-optimization/experiment.json");
    let plan: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert!(
        jsonschema::validator_for(&schemas["local-experiment.schema.json"])
            .unwrap()
            .is_valid(&plan)
    );
    let fixture = Fixture::new(&good());
    fixture.run();
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.output.join("run.json")).unwrap()).unwrap();
    assert!(
        jsonschema::validator_for(&schemas["local-run.schema.json"])
            .unwrap()
            .is_valid(&manifest)
    );
}
