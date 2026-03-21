use crate::app::AppState;
use crate::error::AppError;
use crate::model_manager::traits::ModelInfo;
use tauri::{AppHandle, State};

/// Возвращает список доступных моделей фронтенду.
///
/// `#[tauri::command]` — макрос который регистрирует функцию
/// как IPC-команду. Фронтенд вызывает её через invoke('list_models').
#[tauri::command]
pub async fn list_models(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ModelInfo>, AppError> {
    state.model_manager.list_models(&app).await
}

/// Транскрибирует аудио файл с выбранной моделью.
///
/// Теперь принимает `model_filename` — имя файла модели.
/// Например: "ggml-large-v3.bin" или "ggml-small.bin"
#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    model_filename: String,
) -> Result<String, AppError> {
    let path = std::path::PathBuf::from(&file_path);

    // 1. Валидация файла
    state.file_handler.validate(&path).await?;

    // 2. Подготовка файла (конвертация если нужно)
    let prepared = state.file_handler.prepare(&path).await?;

    // 3. Получаем путь к выбранной модели
    let model_path = state.model_manager.get_model(&app, &model_filename).await?;

    // 4. Транскрибируем
    let text = state.transcriber.transcribe(&prepared, &model_path).await?;

    Ok(text)
}
