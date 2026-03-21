use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("File error: {0}")]
    File(#[from] std::io::Error),

    #[error("Transcription failed: {0}")]
    Transcription(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Sidecar execution error: {0}")]
    Sidecar(String),

    #[error("JSON parsing error: {0}")]
    Json(#[from] serde_json::Error),

    // Общая внутренняя ошибка — для неожиданных ситуаций
    #[error("Internal error: {0}")]
    Internal(String),

    #[error("LLM error: {0}")]
    Llm(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
