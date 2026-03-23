use crate::app::{AppState, LlmSettings};
use crate::error::AppError;
use crate::llm::{LlmClient, LlmRequest, OpenAiClient};
use crate::model_manager::traits::ModelInfo;
use tauri::{AppHandle, State};

// ===========================
// Команды транскрипции
// ===========================

#[tauri::command]
pub async fn list_models(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ModelInfo>, AppError> {
    state.model_manager.list_models(&app).await
}

#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    model_filename: String,
) -> Result<String, AppError> {
    let path = std::path::PathBuf::from(&file_path);
    state.file_handler.validate(&path).await?;
    let prepared = state.file_handler.prepare(&path).await?;
    let model_path = state.model_manager.get_model(&app, &model_filename).await?;
    let text = state.transcriber.transcribe(&prepared, &model_path).await?;
    Ok(text)
}

// ===========================
// Библиотека промтов
// ===========================

#[derive(serde::Serialize, Clone)]
pub struct PromptStyle {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub prompt: String,
}

#[tauri::command]
pub fn list_prompt_styles() -> Vec<PromptStyle> {
    vec![
        PromptStyle {
            id: "summary".into(),
            label: "Выжимка".into(),
            icon: "📝".into(),
            prompt: "Сделай краткую выжимку текста. Выдели главные мысли и ключевые факты. Пиши на русском языке. Будь краток и конкретен.".into(),
        },
        PromptStyle {
            id: "bullets".into(),
            label: "Тезисы".into(),
            icon: "🎯".into(),
            prompt: "Преобразуй текст в список ключевых тезисов в формате Markdown. Используй - для каждого тезиса. Пиши на русском языке.".into(),
        },
        PromptStyle {
            id: "protocol".into(),
            label: "Протокол встречи".into(),
            icon: "📋".into(),
            prompt: "Оформи текст как протокол встречи. Структура: Участники, Обсуждаемые вопросы, Принятые решения, Задачи. Пиши на русском языке.".into(),
        },
        PromptStyle {
            id: "fix".into(),
            label: "Исправить текст".into(),
            icon: "✏️".into(),
            prompt: "Исправь орфографию, пунктуацию и грамматику текста. Убери слова-паразиты и повторы. Сохрани смысл и стиль. Пиши на русском языке.".into(),
        },
        PromptStyle {
            id: "translate_en".into(),
            label: "На английский".into(),
            icon: "🌍".into(),
            prompt: "Переведи текст на английский язык. Сохрани смысл и стиль оригинала.".into(),
        },
        PromptStyle {
            id: "translate_ru".into(),
            label: "На русский".into(),
            icon: "🇷🇺".into(),
            prompt: "Переведи текст на русский язык. Сохрани смысл и стиль оригинала.".into(),
        },
        PromptStyle {
            id: "custom".into(),
            label: "Свой промт".into(),
            icon: "⚙️".into(),
            prompt: "".into(),
        },
    ]
}

// ===========================
// Настройки LLM
// ===========================

/// Возвращает текущие настройки LLM на фронтенд
#[tauri::command]
pub async fn get_llm_settings(state: State<'_, AppState>) -> Result<LlmSettings, AppError> {
    let settings = state.llm_settings.read().await;
    Ok(settings.clone())
}

/// Сохраняем новые настройки LLM от фронтенда
#[tauri::command]
pub async fn set_llm_settings(
    state: State<'_, AppState>,
    base_url: String,
    model: String,
) -> Result<(), AppError> {
    eprintln!("Сохраняем настройки: {} / {}", base_url, model);
    let mut settings = state.llm_settings.write().await;
    settings.base_url = base_url;
    settings.model = model;
    eprintln!("Сохранено: {} / {}", settings.base_url, settings.model);
    Ok(())
}

/// Проверяем доступность LLM сервера
#[tauri::command]
pub async fn check_llm_connection(state: State<'_, AppState>) -> Result<bool, AppError> {
    let settings = state.llm_settings.read().await;
    let client = OpenAiClient::new(&settings.base_url, &settings.model);
    Ok(client.is_available().await)
}

// ===========================
// LLM обработка
// ===========================

/// Обрабатываем текст транскрипции через LLM
#[tauri::command]
pub async fn process_with_llm(
    state: State<'_, AppState>,
    text: String,
    prompt: String,
) -> Result<String, AppError> {
    // Читаем настройки и сразу освобождаем блокировку
    let settings = state.llm_settings.read().await;
    let client = OpenAiClient::new(&settings.base_url, &settings.model);
    drop(settings);

    // Отправляем запрос без проверки is_available
    let response = client
        .complete(LlmRequest {
            system: prompt,
            user: text,
        })
        .await?;

    Ok(response.text)
}
