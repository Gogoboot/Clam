#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::Manager;

mod app;
mod commands;
mod error;
mod file_handler;
mod llm;
mod model_manager;
mod transcriber;

use app::AppState;
use file_handler::basic::BasicFileHandler;
use model_manager::local_fs::LocalFsModelManager;
use transcriber::whisper_sidecar::WhisperSidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let model_manager = Arc::new(LocalFsModelManager::new());
    let file_handler = Arc::new(BasicFileHandler);

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let transcriber = Arc::new(WhisperSidecar::new(app.handle().clone()));
            let state = AppState::new(transcriber, model_manager, file_handler);
            app.manage(state);
            Ok(())
        })
        // Добавили list_models в обработчик команд
        .invoke_handler(tauri::generate_handler![
            commands::transcribe,
            commands::list_models,
            commands::process_with_llm,
            commands::list_prompt_styles,
            commands::get_llm_settings,
            commands::set_llm_settings,
            commands::check_llm_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
