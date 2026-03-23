// Экспортируем модули наружу
pub mod openai;
pub mod traits;

// Реэкспортируем часто используемые типы
pub use openai::OpenAiClient;
pub use traits::{LlmClient, LlmRequest, LlmResponse};
