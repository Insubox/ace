//! A bounded, deterministic GCD grammar: no generated host code is compiled
//! or executed. Only reviewed WAT templates and bounded integer parameters
//! reach the embedded assembler; their WASM is evaluated by the usual runner.
use crate::{Result, create_atomic, json};
use ace_core::*;
use ace_runner::{Harness, ModuleSpec, RunConfig, RunReport};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::Path,
};

const VERSION: &str = "gcd-grammar-v1";
const STEP: &str = "local.get $a local.get $b i32.rem_u local.set $r local.get $b local.set $a local.get $r local.set $b";
const REMAINDER: &str =
    "(block $end (loop $again local.get $b i32.eqz br_if $end STEP br $again)) local.get $a";
const ZERO_GUARDS: &str = "local.get $a i32.eqz (if (then local.get $b return)) local.get $b i32.eqz (if (then local.get $a return))";
const SUBTRACT: &str = "(block $done (loop $subtract local.get $a local.get $b i32.eq br_if $done local.get $a local.get $b i32.gt_u (if (then local.get $a local.get $b i32.sub local.set $a) (else local.get $b local.get $a i32.sub local.set $b)) br $subtract)) local.get $a";

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct GeneratedArtifact {
    candidate: CandidateId,
    strategy: String,
    diagnostic_control: bool,
    source_hash: ContentHash,
    artifact_hash: ContentHash,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Generation {
    schema_version: ace_protocol::ProtocolVersion,
    generator_version: String,
    seed: u64,
    requested_candidates: u32,
    config_hash: ContentHash,
    artifacts: Vec<GeneratedArtifact>,
    parent_experiment: Option<ExperimentId>,
    parent_evidence_hash: Option<ContentHash>,
}

pub(crate) struct Base {
    pub bytes: Vec<u8>,
    pub source: String,
    pub strategy: String,
    pub generator: Generator,
    pub parent_experiment: ExperimentId,
    pub evidence_hash: ContentHash,
}

fn program(body: &str) -> String {
    format!(
        "(module (memory (export \"memory\") 1)\n (func (export \"gcd\") (param $a i32) (param $b i32) (result i32) (local $r i32) (local $s i32) (local $d i32)\n {}))\n",
        body.replace("STEP", STEP)
    )
}

fn baseline() -> String {
    program(&format!(
        "{ZERO_GUARDS} local.get $a local.get $b i32.lt_u (if (result i32) (then local.get $a) (else local.get $b)) local.set $s\n local.get $s i32.const 1024 i32.le_u (if (then i32.const 1 local.set $d i32.const 1 local.set $r\n (block $end (loop $scan local.get $d local.get $s i32.gt_u br_if $end local.get $a local.get $d i32.rem_u i32.eqz local.get $b local.get $d i32.rem_u i32.eqz i32.and (if (then local.get $d local.set $r)) local.get $d i32.const 1 i32.add local.set $d br $scan)) local.get $r return))\n{REMAINDER}"
    ))
}

fn pool() -> Vec<(String, String)> {
    let mut pool = Vec::new();
    for unroll in 1..=8 {
        for equal in [false, true] {
            let guard = if equal {
                "local.get $a local.get $b i32.eq (if (then local.get $a return))"
            } else {
                ""
            };
            let steps = "local.get $b i32.eqz br_if $end STEP ".repeat(unroll);
            pool.push((
                format!("remainder-unroll-{unroll}-equal-{equal}"),
                program(&format!(
                    "{guard} (block $end (loop $again {steps} br $again)) local.get $a"
                )),
            ));
        }
    }
    for cutoff in 1..=80 {
        pool.push((
            format!("remainder-subtraction-tail-{cutoff}"),
            program(&format!(
                "{ZERO_GUARDS} (block $small (loop $reduce local.get $b i32.const {cutoff} i32.le_u br_if $small STEP br $reduce)) local.get $b i32.eqz (if (then local.get $a return)) local.get $a local.get $b i32.rem_u local.set $a local.get $a i32.eqz (if (then local.get $b return)) {SUBTRACT}"
            )),
        ));
    }
    pool.push((
        "symmetric-remainder".into(),
        program("(block $end (loop $again local.get $a i32.eqz br_if $end local.get $b i32.eqz br_if $end local.get $a local.get $b i32.gt_u (if (then local.get $a local.get $b i32.rem_u local.set $a) (else local.get $b local.get $a i32.rem_u local.set $b)) br $again)) local.get $a local.get $b i32.or"),
    ));
    pool.push((
        "binary-shifts".into(),
        program(&format!(
            "{ZERO_GUARDS} local.get $a local.get $b i32.or i32.ctz local.set $s local.get $a local.get $a i32.ctz i32.shr_u local.set $a\n (block $end (loop $again local.get $b local.get $b i32.ctz i32.shr_u local.set $b local.get $a local.get $b i32.gt_u (if (then local.get $a local.set $r local.get $b local.set $a local.get $r local.set $b)) local.get $b local.get $a i32.sub local.tee $b i32.eqz br_if $end br $again)) local.get $a local.get $s i32.shl"
        )),
    ));
    pool
}

fn next(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_add(0x9e3779b97f4a7c15);
    let mut value = *seed;
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

pub(crate) fn population(directory: &Path, seed: u64, candidates: u32) -> Result<Generation> {
    population_with_base(directory, seed, candidates, None)
}

pub(crate) fn population_with_base(
    directory: &Path,
    seed: u64,
    candidates: u32,
    inherited: Option<&Base>,
) -> Result<Generation> {
    if !(4..=100).contains(&candidates) {
        return Err("candidate count must be between 4 and 100".into());
    }
    let mut variants = pool();
    let mut state = seed;
    for index in (1..variants.len()).rev() {
        let other = (next(&mut state) % (index as u64 + 1)) as usize;
        variants.swap(index, other);
    }
    let base_source = inherited.map_or_else(baseline, |b| b.source.clone());
    let base_bytes = wat::parse_str(&base_source)?;
    if inherited.is_some_and(|b| b.bytes != base_bytes) {
        return Err("inherited Champion source does not match its verified WASM".into());
    }
    let base_hash = ContentHash::of_bytes(&base_bytes);
    let mut selected = vec![(
        "C-baseline".into(),
        inherited.map_or_else(|| "bounded-divisor-scan".into(), |b| b.strategy.clone()),
        base_source,
        false,
    )];
    for (strategy, source) in variants {
        if ContentHash::of_bytes(&wat::parse_str(&source)?) == base_hash {
            continue;
        }
        let index = selected.len();
        selected.push((format!("C-generated-{index:03}"), strategy, source, false));
        if selected.len() == candidates as usize - 2 {
            break;
        }
    }
    if selected.len() != candidates as usize - 2 {
        return Err("candidate grammar exhausted".into());
    }
    selected.extend([
        (
            "C-control-add".into(),
            "diagnostic-addition".into(),
            program("local.get $a local.get $b i32.add"),
            true,
        ),
        (
            "C-control-spin".into(),
            "diagnostic-fuel-limit".into(),
            program("(loop $spin br $spin) i32.const 0"),
            true,
        ),
        (
            "C-control-grow".into(),
            "diagnostic-memory-limit".into(),
            program(&format!("i32.const 100 memory.grow drop {REMAINDER}")),
            true,
        ),
    ]);
    let mut artifacts = Vec::new();
    let mut modules = Vec::new();
    let mut files = Vec::new();
    let mut hashes = BTreeSet::new();
    for (id, strategy, source, control) in selected {
        let bytes = wat::parse_str(&source)?;
        let artifact_hash = ContentHash::of_bytes(&bytes);
        if !hashes.insert(artifact_hash.clone()) {
            return Err("generated candidate artifacts must be distinct".into());
        }
        let id = CandidateId::new(id)?;
        let module = format!("artifacts/{id}.wasm");
        let generator = if id.as_str() == "C-baseline" {
            inherited.map(|b| b.generator.clone())
        } else {
            None
        }
        .unwrap_or(Generator {
            provider: Text::new("ace-local")?,
            model: Text::new(VERSION)?,
            revision: Some(Text::new(env!("CARGO_PKG_VERSION"))?),
        });
        modules.push(ModuleSpec {
            id: id.clone(),
            module: module.clone().into(),
            strategy: Text::new(&strategy)?,
            generator,
        });
        artifacts.push(GeneratedArtifact {
            candidate: id.clone(),
            strategy,
            diagnostic_control: control,
            source_hash: ContentHash::of_bytes(source.as_bytes()),
            artifact_hash,
        });
        files.push((format!("sources/{id}.wat"), source.into_bytes()));
        files.push((module, bytes));
    }
    let config = RunConfig {
        schema_version: ace_protocol::ProtocolVersion,
        project: ProjectId::new("PRJ-generated-gcd")?,
        experiment: ExperimentId::new("EXP-generated-gcd")?,
        cell: CellId::new("Gcd")?,
        intent: IntentId::new("INT-reduce-gcd-work")?,
        hypothesis: HypothesisId::new("H-bounded-gcd-search")?,
        baseline: modules.remove(0),
        candidates: modules,
        harness: Harness {
            entrypoint: CheckName::new("gcd")?,
            public_cases: vec![
                [0, 0],
                [0, 15],
                [15, 0],
                [15, 21],
                [1000, 600],
                [7, 13],
                [128, 64],
                [u32::MAX, u32::MAX],
                [u32::MAX, 1],
                [1, u32::MAX],
                [1 << 31, (1 << 31) - 1],
                [65536, 131072],
            ],
            // Oracle randomness is separate from proposal selection.
            oracle_seed: 92137,
            hidden_cases: 128,
            hidden_max_input: 4096,
            benchmark_samples: 5,
            benchmark_rounds: 3,
            fuel_per_call: 50000,
            memory_pages: 16,
        },
        min_relative_improvement: Probability::new(0.01)?,
        max_wall_clock_seconds: 60,
    };
    config.validate()?;
    let generation = Generation {
        schema_version: ace_protocol::ProtocolVersion,
        generator_version: VERSION.into(),
        seed,
        requested_candidates: candidates,
        config_hash: ContentHash::of_json(&config)?,
        artifacts,
        parent_experiment: inherited.map(|b| b.parent_experiment.clone()),
        parent_evidence_hash: inherited.map(|b| b.evidence_hash.clone()),
    };
    // Assemble everything before touching the user's filesystem; reject any
    // existing destination, including symlinks, and never replace user files.
    if let Some(parent) = directory.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    fs::create_dir(directory)?;
    for (path, bytes) in files {
        create_atomic(&directory.join(path), &bytes)?;
    }
    create_atomic(&directory.join("generation.json"), &json(&generation)?)?;
    create_atomic(&directory.join("experiment.json"), &json(&config)?)?;
    Ok(generation)
}

pub(crate) fn print_demo(path: &Path, report: &RunReport) -> Result<()> {
    let champion = report
        .champion
        .as_ref()
        .ok_or("no qualified Champion in demo")?;
    let chosen = report
        .results
        .iter()
        .find(|r| r.candidate.id == champion.candidate)
        .ok_or("Champion not in report")?;
    let baseline = report
        .results
        .iter()
        .find(|r| r.is_baseline)
        .ok_or("missing demo baseline")?;
    let qualified = report
        .results
        .iter()
        .filter(|r| r.evaluation.outcome == ace_runner::CandidateOutcome::Qualified)
        .count();
    let baseline_fuel = baseline
        .evaluation
        .mean_fuel
        .ok_or("baseline has no fuel measurement")?
        .get();
    let fuel = chosen
        .evaluation
        .mean_fuel
        .ok_or("Champion has no fuel measurement")?
        .get();
    let mut out = std::io::stdout().lock();
    writeln!(
        out,
        "ACE demo completed: {} programs evaluated, {qualified} qualified.",
        report.results.len()
    )?;
    writeln!(out, "Champion: {}", champion.candidate)?;
    writeln!(
        out,
        "Mean WASM fuel: {baseline_fuel:.2} baseline -> {fuel:.2} Champion ({:.1}% less on this workload).",
        100.0 * (1.0 - fuel / baseline_fuel)
    )?;
    writeln!(
        out,
        "Three diagnostic controls tested correctness, fuel and memory limits."
    )?;
    writeln!(out, "Evidence and Champion saved in: {}", path.display())?;
    writeln!(out, "Inspect: ace status \"{}\"", path.display())?;
    writeln!(out, "Learn:   ace knowledge \"{}\"", path.display())?;
    writeln!(
        out,
        "Replay:  ace replay \"{}\" {}",
        path.display(),
        champion.candidate
    )?;
    Ok(())
}

pub(crate) fn verify_controls(report: &RunReport) -> Result<()> {
    use ace_runner::CandidateOutcome;
    for (id, expected) in [
        ("C-control-add", CandidateOutcome::FailedCorrectness),
        ("C-control-spin", CandidateOutcome::FailedResourceLimit),
        ("C-control-grow", CandidateOutcome::FailedResourceLimit),
    ] {
        if report
            .results
            .iter()
            .find(|r| r.candidate.id.as_str() == id)
            .is_none_or(|r| r.evaluation.outcome != expected)
        {
            return Err(
                "diagnostic controls did not reproduce the expected evaluation gates".into(),
            );
        }
    }
    Ok(())
}

pub(crate) fn verify_sources(directory: &Path, generation: &Generation) -> Result<()> {
    for artifact in &generation.artifacts {
        let mut source = Vec::new();
        fs::File::open(directory.join(format!("sources/{}.wat", artifact.candidate)))?
            .take(8193)
            .read_to_end(&mut source)?;
        let mut module = Vec::new();
        fs::File::open(directory.join(format!("artifacts/{}.wasm", artifact.candidate)))?
            .take(1_048_577)
            .read_to_end(&mut module)?;
        if source.len() > 8192
            || module.len() > 1_048_576
            || ContentHash::of_bytes(&source) != artifact.source_hash
            || ContentHash::of_bytes(&module) != artifact.artifact_hash
            || wat::parse_bytes(&source)?.as_ref() != module
        {
            return Err("generated source or artifact does not match its provenance".into());
        }
    }
    Ok(())
}
