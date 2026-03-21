use async_trait::async_trait;
use std::path::PathBuf;
use tauri::AppHandle;
use crate::error::AppError;

/// Информация о модели — передаётся на фронтенд
/// 
/// `serde` — библиотека сериализации. Derive-макрос автоматически
/// генерирует код для конвертации структуры в JSON и обратно.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    /// Имя файла без расширения: "ggml-large-v3"
    pub name: String,
    /// Полное имя файла: "ggml-large-v3.bin"
    pub filename: String,
    /// Размер файла в байтах
    pub size_bytes: u64,
}

#[async_trait]
pub trait ModelManager: Send + Sync {
    /// Возвращает список всех доступных моделей
    async fn list_models(&self, app: &AppHandle) -> Result<Vec<ModelInfo>, AppError>;

    /// Возвращает путь к конкретной модели по имени файла
    /// Например: get_model(app, "ggml-large-v3.bin")
    async fn get_model(&self, app: &AppHandle, model_filename: &str) -> Result<PathBuf, AppError>;
}