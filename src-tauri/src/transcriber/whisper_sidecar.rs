use super::traits::Transcriber;
use crate::error::AppError;
use async_trait::async_trait;
use std::path::Path;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub struct WhisperSidecar {
    app: AppHandle,
}

impl WhisperSidecar {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait]
impl Transcriber for WhisperSidecar {
    async fn transcribe(&self, audio_path: &Path, model_path: &Path) -> Result<String, AppError> {
        let (mut rx, _child) = self
            .app
            .shell()
            .sidecar("whisper-cli")
            .map_err(|e| AppError::Sidecar(e.to_string()))?
            .args([
                "-l",
                "ru",
                "-f",
                audio_path.to_str().unwrap(),
                "-m",
                model_path.to_str().unwrap(),
                "-ojf",
                "-of",
                audio_path.to_str().unwrap(),
            ])
            .spawn()
            .map_err(|e| AppError::Sidecar(e.to_string()))?;

        let mut stdout_buf = Vec::new();
        let mut exit_code: Option<i32> = None;

        // Читаем события построчно
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    stdout_buf.extend_from_slice(&line);
                    stdout_buf.push(b'\n');
                }
                CommandEvent::Stderr(line) => {
                    // Шлём прогресс на фронтенд
                    let msg = String::from_utf8_lossy(&line).to_string();
                    let _ = self.app.emit("transcribe-progress", msg);
                }
                CommandEvent::Error(e) => {
                    return Err(AppError::Sidecar(e));
                }
                CommandEvent::Terminated(status) => {
                    exit_code = status.code;
                    break;
                }
                _ => {}
            }
        }

        // Проверяем код выхода
        if exit_code.unwrap_or(-1) != 0 {
            return Err(AppError::Transcription(format!(
                "whisper-cli exited with code {:?}",
                exit_code
            )));
        }

        // Парсим результат из stdout
        if !stdout_buf.is_empty() {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&stdout_buf) {
                if let Some(text) = json["text"].as_str() {
                    return Ok(text.trim().to_string());
                }
            }
        }

        // Fallback — читаем json файл
        let json_path = audio_path.with_extension("wav.json");
        if json_path.exists() {
            let data = tokio::fs::read_to_string(&json_path).await?;
            let json: serde_json::Value = serde_json::from_str(&data)?;
            if let Some(text) = json["text"].as_str() {
                return Ok(text.trim().to_string());
            }
        }

        Ok(String::from_utf8_lossy(&stdout_buf).to_string())
    }
}
