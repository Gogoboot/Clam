use crate::error::AppError;
use async_trait::async_trait;
use std::path::Path;

#[async_trait]
pub trait Transcriber: Send + Sync {
    async fn transcribe(&self, audio_path: &Path, model_path: &Path) -> Result<String, AppError>;
}
