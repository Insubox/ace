//! Phase 1 runs precompiled, import-free WASM cells. It never compiles or launches
//! untrusted native source. Candidate memory has no reference to host oracle state.
mod config;
mod distributed;
pub use distributed::*;
mod experiment;
mod sandbox;
mod storage;

pub use config::*;
pub use experiment::*;
pub use sandbox::{CandidateOutcome, Evaluation, RUNTIME_VERSION};
pub use storage::{ReplayReport, load_report, replay, runner_schemas};

#[derive(Debug, thiserror::Error)]
pub enum RunnerError {
    #[error("{0}")]
    Validation(#[from] ace_core::ValidationError),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Protocol(#[from] ace_protocol::DecodeError),
    #[error("{0}")]
    Setup(String),
}
pub type Result<T> = std::result::Result<T, RunnerError>;
