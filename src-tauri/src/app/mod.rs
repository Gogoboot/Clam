use crate::file_handler::traits::FileHandler;
use crate::model_manager::traits::ModelManager;
use crate::transcriber::traits::Transcriber;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Настройки LLM — хранятся в памяти и могут меняться через UI
/// RwLock позволяет читать одновременно но писать только одному
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct LlmSettings {
    /// URL сервера: "http://127.0.0.1:1234"
    pub base_url: String,
    /// Название модели: "gemma-3-12b-it"
    pub model: String,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:1234".into(),
            model: "gemma-3-12b-it".into(),
        }
    }
}

pub struct AppState {
    pub transcriber: Arc<dyn Transcriber>,
    pub model_manager: Arc<dyn ModelManager>,
    pub file_handler: Arc<dyn FileHandler>,
    /// Настройки LLM — обёрнуты в RwLock для безопасного изменения
    pub llm_settings: RwLock<LlmSettings>,
}

impl AppState {
    pub fn new(
        transcriber: Arc<dyn Transcriber>,
        model_manager: Arc<dyn ModelManager>,
        file_handler: Arc<dyn FileHandler>,
    ) -> Self {
        Self {
            transcriber,
            model_manager,
            file_handler,
            llm_settings: RwLock::new(LlmSettings::default()),
        }
    }
}
