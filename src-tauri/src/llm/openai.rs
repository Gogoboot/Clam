use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use super::traits::{LlmClient, LlmRequest, LlmResponse};

/// Клиент для OpenAI-совместимых API
/// Работает с: LM Studio, Ollama, OpenAI, любой совместимый сервер
pub struct OpenAiClient {
    /// Базовый URL сервера: "http://localhost:1234"
    base_url: String,
    /// Название модели: "gemma-3-12b-it"
    model: String,
    /// HTTP клиент — переиспользуем для всех запросов
    client: reqwest::Client,
}

impl OpenAiClient {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            model: model.into(),
            // Таймаут 120 сек — LLM может думать долго
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(600))
                .pool_idle_timeout(std::time::Duration::from_secs(300))
                .http1_only() // ← добавь это
                .build()
                .unwrap(),
        }
    }
}

// ===========================
// Структуры для JSON запроса/ответа
// OpenAI Chat Completions API формат
// ===========================

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    /// Температура — от 0 (детерминированно) до 1 (творчески)
    temperature: f32,
    max_tokens: i32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,   // "system" | "user" | "assistant"
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    model: String,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

#[async_trait]
impl LlmClient for OpenAiClient {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse, AppError> {
        let url = format!("{}/v1/chat/completions", self.base_url);

        // Формируем запрос в формате OpenAI Chat Completions
        let body = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage { role: "system".into(), content: request.system },
                ChatMessage { role: "user".into(), content: request.user },
            ],
            temperature: 0.3, // низкая температура для точной обработки текста
            max_tokens: 1096,
        };

        // Логируем что отправляем
        eprintln!("Отправляем запрос: {}", serde_json::to_string(&body).unwrap_or_default());

        // Отправляем POST запрос
        let response = self.client
            .post(&url)
            .header("User-Agent", "Mozilla/5.0")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Llm(format!("Ошибка запроса к LLM: {e:#?}")))?;

        // Проверяем HTTP статус
        let status = response.status();
        eprintln!("HTTP статус: {}", status);

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            eprintln!("Тело ошибки: {}", body);
            return Err(AppError::Llm(format!(
                "LLM сервер вернул ошибку: {} — {}", status, body
            )));
        }
        // Парсим ответ
        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| AppError::Llm(format!("Ошибка парсинга ответа LLM: {e}")))?;

        // Извлекаем текст из первого выбора
        let text = chat_response.choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();

        Ok(LlmResponse {
            text,
            model: chat_response.model,
        })
    }

    async fn is_available(&self) -> bool {
        let url = format!("{}/v1/models", self.base_url);
        eprintln!("Проверка доступности: {}", url);
        let result = self.client.get(&url).send().await;
        eprintln!("Результат is_ok: {:?}", result.is_ok());
        result.is_ok()
    }

    fn provider_name(&self) -> &str {
        "LM Studio"
    }
}
