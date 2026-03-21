// Экспортируем модули наружу
pub mod traits;
pub mod openai;

// Реэкспортируем часто используемые типы
pub use traits::{LlmClient, LlmRequest, LlmResponse};
pub use openai::OpenAiClient;
