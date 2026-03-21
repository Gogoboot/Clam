use async_trait::async_trait;
use crate::error::AppError;

/// Запрос к LLM — системный промт + сообщение пользователя
pub struct LlmRequest {
    /// Системный промт — задаёт роль и поведение модели
    pub system: String,
    /// Текст пользователя — транскрипция которую обрабатываем
    pub user: String,
}

/// Ответ от LLM
pub struct LlmResponse {
    /// Обработанный текст
    pub text: String,
    /// Название модели которая ответила
    pub model: String,
}

/// Трейт для любого LLM провайдера
/// Single Responsibility — каждая реализация отвечает за один провайдер
#[async_trait]
pub trait LlmClient: Send + Sync {
    /// Отправляем запрос и получаем ответ
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse, AppError>;

    /// Проверяем доступность сервера
    async fn is_available(&self) -> bool;

    /// Название провайдера для отображения в UI
    fn provider_name(&self) -> &str;
}
