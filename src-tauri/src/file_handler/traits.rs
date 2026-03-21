use crate::error::AppError;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

#[async_trait]
pub trait FileHandler: Send + Sync {
    async fn validate(&self, path: &Path) -> Result<(), AppError>;
    async fn prepare(&self, path: &Path) -> Result<PathBuf, AppError>;
}
