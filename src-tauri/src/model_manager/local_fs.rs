use super::traits::{ModelInfo, ModelManager};
use crate::error::AppError;
use async_trait::async_trait;
use std::path::PathBuf;
use tauri::AppHandle;

pub struct LocalFsModelManager;

impl LocalFsModelManager {
    pub fn new() -> Self {
        Self
    }

    fn models_dir(&self, _app: &AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
                .map_err(|e| AppError::Internal(format!("CARGO_MANIFEST_DIR не задан: {e}")))?;
            Ok(PathBuf::from(manifest_dir).join("resources").join("models"))
        }

        #[cfg(not(debug_assertions))]
        {
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| AppError::Internal(format!("resource_dir недоступен: {e}")))?;
            Ok(resource_dir.join("models"))
        }
    }
}

impl Default for LocalFsModelManager {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ModelManager for LocalFsModelManager {
    async fn list_models(&self, app: &AppHandle) -> Result<Vec<ModelInfo>, AppError> {
        let dir = self.models_dir(app)?;

        if !dir.exists() {
            return Ok(vec![]);
        }

        let mut read_dir = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| AppError::Internal(format!("Не могу читать папку моделей: {e}")))?;

        let mut models = Vec::new();

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            // Явно указываем тип через переменную — решает E0282
            let path: PathBuf = entry.path();

            // Фильтруем только .bin файлы
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "bin" {
                continue;
            }

            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Явно указываем тип метаданных
            let size_bytes: u64 = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);

            models.push(ModelInfo {
                name,
                filename,
                size_bytes,
            });
        }

        Ok(models)
    }

    async fn get_model(&self, app: &AppHandle, model_filename: &str) -> Result<PathBuf, AppError> {
        let path = self.models_dir(app)?.join(model_filename);

        if path.exists() {
            Ok(path)
        } else {
            Err(AppError::ModelNotFound(format!(
                "Модель не найдена: {:?}",
                path
            )))
        }
    }
}
