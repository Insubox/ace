//! Portable deterministic domain kernel. No filesystem, network or clock access.
mod domain;
mod hash;
mod primitives;

pub use domain::*;
pub use hash::*;
pub use primitives::*;

/// Checks local invariants. Cross-document references require a trusted resolver.
pub trait Validate {
    fn validate(&self) -> Result<(), ValidationError>;
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("{0}")]
pub struct ValidationError(pub String);

pub(crate) fn require(condition: bool, message: &str) -> Result<(), ValidationError> {
    if condition {
        Ok(())
    } else {
        Err(ValidationError(message.into()))
    }
}
