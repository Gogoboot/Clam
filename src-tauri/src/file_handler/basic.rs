use super::traits::FileHandler;
use crate::error::AppError;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

pub struct BasicFileHandler;

#[async_trait]
impl FileHandler for BasicFileHandler {
    async fn validate(&self, path: &Path) -> Result<(), AppError> {
        if !path.exists() {
            return Err(AppError::File(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "File not found",
            )));
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let supported = ["mp3", "mp4", "wav", "m4a", "ogg", "flac", "webm"];
        if supported.contains(&ext.as_str()) {
            Ok(())
        } else {
            Err(AppError::UnsupportedFormat(ext))
        }
    }

    async fn prepare(&self, path: &Path) -> Result<PathBuf, AppError> {
        // Пока ничего не делаем
        Ok(path.to_path_buf())
    }
}
