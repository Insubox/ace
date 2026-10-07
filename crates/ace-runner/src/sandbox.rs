use crate::{Harness, oracle_cases};
use ace_core::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use wasmi::{
    Config, Engine, ExternType, Linker, Module, ResourceLimiter, Store, StoreLimits,
    StoreLimitsBuilder, ValType,
};
use wasmi::{
    TrapCode,
    errors::{ErrorKind, InstantiationError, MemoryError, TableError},
};
use wasmi_core::LimiterError;

pub const RUNTIME_VERSION: &str = "wasmi-2.0.0:deterministic:portable-dispatch:fuel:v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CandidateOutcome {
    Qualified,
    FailedCorrectness,
    FailedContract,
    FailedResourceLimit,
    InvalidModule,
    BudgetExhausted,
    EvaluatorError,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Evaluation {
    pub outcome: CandidateOutcome,
    pub stage: EvaluationStage,
    pub reason: Text,
    pub mean_fuel: Option<FiniteNumber>,
    pub median_call_ns: Option<FiniteNumber>,
    pub peak_linear_memory_bytes: u64,
    pub checked_calls: u64,
    pub output_hash: ContentHash,
}

struct Limits {
    limits: StoreLimits,
    peak: usize,
    system_oom: bool,
}
impl ResourceLimiter for Limits {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> std::result::Result<bool, LimiterError> {
        let allow = self.limits.memory_growing(current, desired, maximum)?;
        if allow {
            self.peak = self.peak.max(desired);
        }
        Ok(allow)
    }
    fn table_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> std::result::Result<bool, LimiterError> {
        self.limits.table_growing(current, desired, maximum)
    }
    fn instances(&self) -> usize {
        1
    }
    fn memories(&self) -> usize {
        1
    }
    fn tables(&self) -> usize {
        1
    }
    fn memory_grow_failed(&mut self, error: &MemoryError) -> std::result::Result<(), LimiterError> {
        if matches!(error, MemoryError::OutOfSystemMemory) {
            self.system_oom = true;
        }
        Ok(())
    }
    fn table_grow_failed(&mut self, error: &TableError) -> std::result::Result<(), LimiterError> {
        if matches!(error, TableError::OutOfSystemMemory) {
            self.system_oom = true;
        }
        Ok(())
    }
}

fn execution_error(error: &wasmi::Error) -> CandidateOutcome {
    match error.as_trap_code() {
        Some(TrapCode::OutOfSystemMemory) => CandidateOutcome::EvaluatorError,
        Some(TrapCode::OutOfFuel | TrapCode::GrowthOperationLimited | TrapCode::StackOverflow) => {
            CandidateOutcome::FailedResourceLimit
        }
        Some(_) => CandidateOutcome::FailedCorrectness,
        None => match error.kind() {
            ErrorKind::Memory(MemoryError::OutOfSystemMemory)
            | ErrorKind::Table(TableError::OutOfSystemMemory)
            | ErrorKind::Instantiation(
                InstantiationError::FailedToInstantiateMemory(MemoryError::OutOfSystemMemory)
                | InstantiationError::FailedToInstantiateTable(TableError::OutOfSystemMemory),
            ) => CandidateOutcome::EvaluatorError,
            ErrorKind::Memory(MemoryError::ResourceLimiterDeniedAllocation)
            | ErrorKind::Table(TableError::ResourceLimiterDeniedAllocation)
            | ErrorKind::Instantiation(
                InstantiationError::TooManyInstances
                | InstantiationError::TooManyTables
                | InstantiationError::TooManyMemories,
            )
            | ErrorKind::Instantiation(
                InstantiationError::FailedToInstantiateMemory(
                    MemoryError::ResourceLimiterDeniedAllocation,
                )
                | InstantiationError::FailedToInstantiateTable(
                    TableError::ResourceLimiterDeniedAllocation,
                ),
            ) => CandidateOutcome::FailedResourceLimit,
            _ => CandidateOutcome::EvaluatorError,
        },
    }
}

pub(crate) fn evaluate_module(bytes: &[u8], harness: &Harness, deadline: Instant) -> Evaluation {
    let mut result = Evaluation {
        outcome: CandidateOutcome::InvalidModule,
        stage: EvaluationStage::L0,
        reason: Text::new("module validation failed").expect("literal text"),
        mean_fuel: None,
        median_call_ns: None,
        peak_linear_memory_bytes: 0,
        checked_calls: 0,
        output_hash: ContentHash::of_bytes(b""),
    };
    if Instant::now() >= deadline {
        result.outcome = CandidateOutcome::BudgetExhausted;
        result.reason = Text::new("wall-clock budget exhausted before module evaluation").unwrap();
        return result;
    }
    let mut config = Config::default();
    config.consume_fuel(true);
    let engine = Engine::new(&config);
    let module = match Module::new(&engine, bytes) {
        Ok(module) => module,
        Err(error) => {
            result.reason = Text::new(format!("invalid WASM: {error}")).unwrap();
            return result;
        }
    };
    if module.imports().next().is_some() {
        result.outcome = CandidateOutcome::FailedContract;
        result.reason = Text::new("host/WASI imports are forbidden").unwrap();
        return result;
    }
    let valid_abi = module.exports().any(|export| {
        export.name() == harness.entrypoint.as_str()
            && matches!(export.ty(), ExternType::Func(ty)
            if ty.params() == [ValType::I32, ValType::I32] && ty.results() == [ValType::I32])
    });
    if !valid_abi {
        result.outcome = CandidateOutcome::FailedContract;
        result.reason = Text::new("entrypoint must have ABI (i32, i32) -> i32").unwrap();
        return result;
    }
    result.stage = EvaluationStage::L3;
    let memory_limit = harness.memory_pages as usize * 65536;
    let limits = StoreLimitsBuilder::new()
        .memory_size(memory_limit)
        .table_elements(1024)
        .memories(1)
        .tables(1)
        .instances(1)
        .trap_on_grow_failure(true)
        .build();
    let mut store = Store::new(
        &engine,
        Limits {
            limits,
            peak: 0,
            system_oom: false,
        },
    );
    store.limiter(|limits| limits);
    store
        .set_fuel(harness.fuel_per_call)
        .expect("fuel metering enabled");
    let instance = match Linker::new(&engine).instantiate_and_start(&mut store, &module) {
        Ok(instance) => instance,
        Err(error) => {
            result.outcome = execution_error(&error);
            result.reason = Text::new(format!("bounded instantiation failed: {error}")).unwrap();
            return result;
        }
    };
    let function = instance
        .get_typed_func::<(i32, i32), i32>(&store, harness.entrypoint.as_str())
        .expect("ABI checked");
    let hidden = oracle_cases(harness);
    let mut outputs = Vec::new();
    let mut fuel_sum = 0u64;
    let mut benchmark_calls = 0u64;
    let mut times = Vec::new();
    let validation = harness
        .public_cases
        .iter()
        .chain(&hidden)
        .copied()
        .map(|case| (case, false));
    let benchmarks = (0..harness.benchmark_samples).flat_map(|_| {
        (0..harness.benchmark_rounds).flat_map(|_| {
            harness
                .public_cases
                .iter()
                .copied()
                .map(|case| (case, true))
        })
    });
    for ([a, b], timed) in validation.chain(benchmarks) {
        if Instant::now() >= deadline {
            result.outcome = CandidateOutcome::BudgetExhausted;
            result.reason =
                Text::new("wall-clock budget exhausted; remaining checks did not run").unwrap();
            result.output_hash = ContentHash::of_bytes(&outputs);
            result.peak_linear_memory_bytes = store.data().peak as u64;
            return result;
        }
        store
            .set_fuel(harness.fuel_per_call)
            .expect("fuel metering enabled");
        let start = Instant::now();
        let returned = function.call(&mut store, (a as i32, b as i32));
        let elapsed = start.elapsed();
        let output = match returned {
            Ok(output) => output as u32,
            Err(error) => {
                result.outcome = execution_error(&error);
                result.reason =
                    Text::new(format!("bounded WASM execution trapped: {error}")).unwrap();
                result.output_hash = ContentHash::of_bytes(&outputs);
                result.peak_linear_memory_bytes = store.data().peak as u64;
                return result;
            }
        };
        if store.data().system_oom {
            result.outcome = CandidateOutcome::EvaluatorError;
            result.reason =
                Text::new("host memory allocation failed; no candidate correctness conclusion")
                    .unwrap();
            return result;
        }
        result.checked_calls += 1;
        outputs.extend_from_slice(&a.to_le_bytes());
        outputs.extend_from_slice(&b.to_le_bytes());
        outputs.extend_from_slice(&output.to_le_bytes());
        if output != harness.oracle.evaluate(a, b) {
            result.outcome = CandidateOutcome::FailedCorrectness;
            result.reason = Text::new(format!(
                "independent oracle rejected output on call {}",
                result.checked_calls
            ))
            .unwrap();
            result.output_hash = ContentHash::of_bytes(&outputs);
            result.peak_linear_memory_bytes = store.data().peak as u64;
            return result;
        }
        if timed {
            fuel_sum += harness.fuel_per_call - store.get_fuel().expect("fuel metering enabled");
            benchmark_calls += 1;
            times.push(elapsed);
        }
    }
    times.sort();
    result.outcome = CandidateOutcome::Qualified;
    result.reason =
        Text::new("public workload, independent oracle and repeated benchmark calls passed")
            .unwrap();
    result.mean_fuel = Some(FiniteNumber::new(fuel_sum as f64 / benchmark_calls as f64).unwrap());
    result.median_call_ns =
        Some(FiniteNumber::new(times[times.len() / 2].as_nanos() as f64).unwrap());
    result.peak_linear_memory_bytes = store.data().peak as u64;
    result.output_hash = ContentHash::of_bytes(&outputs);
    result
}

pub(crate) fn deadline(seconds: u32) -> Instant {
    Instant::now() + Duration::from_secs(u64::from(seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_allocation_failure_is_not_a_candidate_failure() {
        let error = wasmi::Error::from(MemoryError::OutOfSystemMemory);
        assert_eq!(execution_error(&error), CandidateOutcome::EvaluatorError);
        let nested = wasmi::Error::from(InstantiationError::FailedToInstantiateMemory(
            MemoryError::OutOfSystemMemory,
        ));
        assert_eq!(execution_error(&nested), CandidateOutcome::EvaluatorError);
        let limits = StoreLimitsBuilder::new().memory_size(65536).build();
        let mut limits = Limits {
            limits,
            peak: 0,
            system_oom: false,
        };
        limits
            .memory_grow_failed(&MemoryError::OutOfSystemMemory)
            .unwrap();
        assert!(limits.system_oom);
    }

    #[test]
    fn expired_budget_leaves_evaluation_unrun() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/function-optimization");
        let config = crate::load_config(&root).unwrap();
        let result = evaluate_module(
            b"not a module",
            &config.harness,
            Instant::now() - Duration::from_secs(1),
        );
        assert_eq!(result.outcome, CandidateOutcome::BudgetExhausted);
        assert_eq!(result.checked_calls, 0);
    }
}
