import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import "./App.css";

// ===========================
// Типы — совпадают с Rust структурами
// ===========================

interface ModelInfo {
  name: string; // "ggml-medium"
  filename: string; // "ggml-medium.bin"
  size_bytes: number; // 1533000000
}

// Стиль обработки из библиотеки промтов
interface PromptStyle {
  id: string; // "summary"
  label: string; // "Выжимка"
  icon: string; // "📝"
  prompt: string; // системный промт для LLM
}

// Настройки LLM — совпадает с Rust структурой LlmSettings
interface LlmSettings {
  base_url: string; // "http://127.0.0.1:1234"
  model: string; // "gemma-3-12b-it"
}

// ===========================
// Вспомогательные функции
// ===========================

// Переводим байты в читаемый вид: 1533000000 → "1.43 GB"
function bytesToHuman(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

// Парсим строку с таймкодами в массив сегментов
// "[00:00:00.000 --> 00:00:07.740]   Текст" → [{time, text}]
function parseSegments(raw: string): { time: string; text: string }[] {
  const regex =
    /\[(\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3})\]\s+(.*)/g;
  const segments: { time: string; text: string }[] = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    segments.push({ time: match[1], text: match[2].trim() });
  }
  // Если таймкоды не найдены — весь текст как один сегмент
  if (segments.length === 0 && raw.trim()) {
    segments.push({ time: "", text: raw.trim() });
  }
  return segments;
}

// Конвертируем в формат SRT субтитров
// "00:00:07.740" → "00:00:07,740" (точка → запятая)
function toSrt(segments: { time: string; text: string }[]): string {
  return segments
    .map((seg, i) => {
      const [start, end] = seg.time
        .split(" --> ")
        .map((t) => t.replace(".", ","));
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join("\n");
}

// Чистый текст без таймкодов
function toPlainText(segments: { time: string; text: string }[]): string {
  return segments.map((s) => s.text).join(" ");
}

// ===========================
// Компонент
// ===========================
function App() {
  // ===========================
  // Состояния — транскрипция
  // ===========================

  // Путь к выбранному файлу
  const [filePath, setFilePath] = useState<string | null>(null);
  // Список доступных моделей whisper
  const [models, setModels] = useState<ModelInfo[]>([]);
  // Имя файла выбранной модели
  const [selectedModel, setSelectedModel] = useState<string>("");
  // Сырой результат транскрипции с таймкодами
  const [rawResult, setRawResult] = useState<string>("");
  // Флаг загрузки — блокирует UI во время транскрипции
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // Строки прогресса из stderr whisper
  const [progress, setProgress] = useState<string[]>([]);
  // Текст ошибки
  const [error, setError] = useState<string | null>(null);
  // Режим отображения: true = с таймкодами, false = чистый текст
  const [showTimecodes, setShowTimecodes] = useState<boolean>(true);
  // Флаг анимации кнопки "Скопировано"
  const [copied, setCopied] = useState<boolean>(false);
  // Время транскрипции в миллисекундах
  const [elapsed, setElapsed] = useState<number | null>(null);
  // Текущая тема
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Добавь рядом с другими useState — время обработки LLM
  const [llmElapsed, setLlmElapsed] = useState<number | null>(null);

  // ===========================
  // Состояния — LLM
  // ===========================

  // Библиотека стилей обработки
  const [promptStyles, setPromptStyles] = useState<PromptStyle[]>([]);
  // ID выбранного стиля
  const [selectedStyleId, setSelectedStyleId] = useState<string>("summary");
  // Текст своего промта
  const [customPrompt, setCustomPrompt] = useState<string>("");
  // Результат обработки LLM
  const [llmResult, setLlmResult] = useState<string>("");
  // Флаг загрузки LLM
  const [isLlmLoading, setIsLlmLoading] = useState<boolean>(false);
  // Ошибка LLM
  const [llmError, setLlmError] = useState<string | null>(null);
  // Флаг анимации кнопки копирования результата LLM
  const [llmCopied, setLlmCopied] = useState<boolean>(false);

  // ===========================
  // Состояния — настройки LLM
  // ===========================

  // Показывать ли панель настроек
  const [showSettings, setShowSettings] = useState<boolean>(false);
  // URL сервера LM Studio
  const [llmUrl, setLlmUrl] = useState<string>("http://127.0.0.1:1234");
  // Название модели LLM
  const [llmModel, setLlmModel] = useState<string>("gemma-3-12b-it");
  // Статус соединения: null = не проверялось, true = ок, false = ошибка
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  // Флаг сохранения настроек
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);

  // Вычисляем сегменты из сырого результата
  const segments = parseSegments(rawResult);

  // Текущий выбранный стиль из библиотеки
  const selectedStyle = promptStyles.find((s) => s.id === selectedStyleId);

  // Финальный промт — свой или из библиотеки
  const finalPrompt =
    selectedStyleId === "custom" ? customPrompt : (selectedStyle?.prompt ?? "");

  // ===========================
  // Эффекты
  // ===========================

  // Применяем тему через data-атрибут на <html>
  // CSS читает [data-theme="dark"] и переключает переменные
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Загружаем данные при старте приложения
  useEffect(() => {
    // Список моделей whisper
    invoke<ModelInfo[]>("list_models")
      .then((list) => {
        setModels(list);
        if (list.length > 0) setSelectedModel(list[0].filename);
      })
      .catch((e) => setError(`Ошибка загрузки моделей: ${e}`));

    // Библиотека промтов
    invoke<PromptStyle[]>("list_prompt_styles")
      .then((styles) => setPromptStyles(styles))
      .catch((e) => console.error("Ошибка загрузки стилей:", e));

    // Настройки LLM сохранённые в AppState
    invoke<LlmSettings>("get_llm_settings")
      .then((s) => {
        setLlmUrl(s.base_url);
        setLlmModel(s.model);
      })
      .catch(console.error);
  }, []);

  // Подписываемся на события прогресса от Rust
  // Rust делает app.emit("transcribe-progress", line) → получаем здесь
  useEffect(() => {
    const unlisten = listen<string>("transcribe-progress", (event) => {
      // Храним последние 50 строк
      setProgress((prev) => [...prev.slice(-50), event.payload]);
    });
    // Отписываемся при размонтировании
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // ===========================
  // Обработчики — транскрипция
  // ===========================

  // Открываем диалог выбора файла через Tauri
  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Audio/Video",
          extensions: ["mp3", "wav", "mp4", "ogg", "m4a", "flac", "mkv", "avi"],
        },
      ],
    });
    if (typeof selected === "string") {
      setFilePath(selected);
      // Сбрасываем предыдущие результаты
      setRawResult("");
      setProgress([]);
      setError(null);
      setLlmResult("");
    }
  };

  // Запускаем транскрипцию через IPC команду
  // invoke('transcribe') → Rust commands::transcribe()
  const handleTranscribe = async () => {
    if (!filePath || !selectedModel) return;
    setIsLoading(true);
    setRawResult("");
    setProgress([]);
    setError(null);
    setElapsed(null);
    setLlmResult("");

    const startTime = Date.now();
    try {
      const text = await invoke<string>("transcribe", {
        filePath,
        modelFilename: selectedModel, // camelCase → snake_case в Rust
      });
      setRawResult(text);
      setElapsed(Date.now() - startTime);
    } catch (e) {
      setError(`Ошибка: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Копируем текст транскрипции в буфер обмена
  const handleCopy = async () => {
    const text = showTimecodes ? rawResult : toPlainText(segments);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Сохраняем чистый текст в .txt
  const handleExportTxt = async () => {
    const savePath = await save({
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: "transcription.txt",
    });
    if (savePath) await writeTextFile(savePath, toPlainText(segments));
  };

  // Сохраняем субтитры в .srt
  const handleExportSrt = async () => {
    const savePath = await save({
      filters: [{ name: "Subtitles", extensions: ["srt"] }],
      defaultPath: "transcription.srt",
    });
    if (savePath) await writeTextFile(savePath, toSrt(segments));
  };

  // ===========================
  // Обработчики — настройки LLM
  // ===========================

  // Сохраняем настройки в Rust AppState и проверяем соединение
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setLlmConnected(null);
    try {
      // Сохраняем в AppState (для истории, может пригодится позже)
      await invoke("set_llm_settings", {
        baseUrl: llmUrl,
        model: llmModel,
      });

      // Проверяем соединение напрямую через fetch
      const response = await fetch(`${llmUrl}/v1/models`);
      setLlmConnected(response.ok);
    } catch (e) {
      setLlmConnected(false);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ===========================
  // Обработчики — LLM
  // ===========================

  // Отправляем текст на обработку LLM
  // Отправляем текст на обработку LLM напрямую из фронтенда
  // Frontend → LM Studio (без Rust посредника)
  // Отправляем текст на обработку LLM со стримингом
  // Текст появляется постепенно пока модель генерирует
  const handleLlmProcess = async () => {
    if (!rawResult || !finalPrompt) return;
    setIsLlmLoading(true);
    setLlmResult("");
    setLlmError(null);
    setLlmElapsed(null); // ← сбрасываем время

    const startTime = Date.now(); // ← засекаем

    try {
      const response = await fetch(`${llmUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llmModel,
          messages: [
            { role: "system", content: finalPrompt },
            { role: "user", content: toPlainText(segments) },
          ],
          temperature: 0.3,
          max_tokens: 2048,
          stream: true,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Стриминг не поддерживается");

      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "));
        for (const line of lines) {
          const jsonStr = line.replace("data: ", "").trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              accumulated += delta;
              setLlmResult(accumulated);
            }
          } catch {}
        }
      }
      setLlmElapsed(Date.now() - startTime); // ← фиксируем время
    } catch (e) {
      setLlmError(`Ошибка LLM: ${e}`);
    } finally {
      setIsLlmLoading(false);
    }
  };
  // Копируем результат LLM
  const handleLlmCopy = async () => {
    await navigator.clipboard.writeText(llmResult);
    setLlmCopied(true);
    setTimeout(() => setLlmCopied(false), 2000);
  };

  // Сохраняем результат LLM в .txt
  const handleLlmExport = async () => {
    const savePath = await save({
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: "llm-result.txt",
    });
    if (savePath) await writeTextFile(savePath, llmResult);
  };

  // Переключаем тему light ↔ dark
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  // ===========================
  // Рендер
  // ===========================
  return (
    <div className="container">
      {/* Шапка с кнопками настроек и темы */}
      <div className="header">
        <h1>Офлайн-транскрибатор</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className="theme-toggle"
            onClick={() => setShowSettings((s) => !s)}
            title="Настройки LLM"
          >
            ⚙️
          </button>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? "🌙" : "☀️"}
          </button>
        </div>
      </div>

      {/* Панель настроек LLM — показывается по кнопке ⚙️ */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-title">⚙️ Настройки LLM</div>

          <div className="settings-row">
            <label>URL сервера:</label>
            <input
              type="text"
              value={llmUrl}
              onChange={(e) => setLlmUrl(e.target.value)}
              placeholder="http://127.0.0.1:1234"
              className="settings-input"
            />
          </div>

          <div className="settings-row">
            <label>Модель:</label>
            <input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="gemma-3-12b-it"
              className="settings-input"
            />
          </div>

          <div className="settings-footer">
            {/* Индикатор статуса соединения */}
            {llmConnected !== null && (
              <span className={llmConnected ? "status-ok" : "status-err"}>
                {llmConnected ? "🟢 Подключено" : "🔴 Нет соединения"}
              </span>
            )}
            <button
              className="primary"
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              style={{ marginTop: 0 }}
            >
              {isSavingSettings ? "⏳ Проверка..." : "Сохранить и проверить"}
            </button>
          </div>
        </div>
      )}

      {/* Выбор модели whisper */}
      <div className="card">
        <div className="section">
          <label>Модель:</label>
          {models.length === 0 ? (
            <p className="warning">⚠️ Модели не найдены</p>
          ) : (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isLoading}
            >
              {models.map((m) => (
                <option key={m.filename} value={m.filename}>
                  {m.name} ({bytesToHuman(m.size_bytes)})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Кнопка выбора файла */}
      <button
        onClick={handleSelectFile}
        disabled={isLoading}
        className="file-btn"
      >
        {filePath ? `📁 ${filePath.split("\\").pop()}` : "📂 Выбрать файл"}
      </button>

      {/* Главная кнопка транскрипции */}
      <button
        onClick={handleTranscribe}
        disabled={!filePath || !selectedModel || isLoading}
        className="primary"
      >
        {isLoading ? "⏳ Расшифровка..." : "Расшифровать"}
      </button>

      {/* Время транскрипции */}
      {elapsed !== null && (
        <div className="elapsed">
          ⏱ Время:{" "}
          {elapsed > 60000
            ? `${Math.floor(elapsed / 60000)} мин ${Math.floor((elapsed % 60000) / 1000)} сек`
            : `${(elapsed / 1000).toFixed(1)} сек`}
        </div>
      )}

      {/* Лог прогресса — последние 5 строк из stderr whisper */}
      {isLoading && progress.length > 0 && (
        <div className="progress-log">
          {progress.slice(-5).map((line, i) => (
            <div key={i} className="progress-line">
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Ошибка транскрипции */}
      {error && <div className="error">{error}</div>}

      {/* Блок результата транскрипции */}
      {rawResult && (
        <div className="result-section">
          <div className="result-toolbar">
            {/* Переключатель режима отображения */}
            <div className="toggle-group">
              <button
                className={showTimecodes ? "toggle active" : "toggle"}
                onClick={() => setShowTimecodes(true)}
              >
                🕐 С таймкодами
              </button>
              <button
                className={!showTimecodes ? "toggle active" : "toggle"}
                onClick={() => setShowTimecodes(false)}
              >
                📄 Чистый текст
              </button>
            </div>

            {/* Кнопки экспорта */}
            <div className="action-group">
              <button className="action-btn" onClick={handleCopy}>
                {copied ? "✅ Скопировано" : "📋 Копировать"}
              </button>
              <button className="action-btn" onClick={handleExportTxt}>
                💾 TXT
              </button>
              <button className="action-btn" onClick={handleExportSrt}>
                🎬 SRT
              </button>
            </div>
          </div>

          {/* Текст результата */}
          <div className="result">
            {showTimecodes ? (
              // Режим с таймкодами — каждый сегмент отдельно
              segments.map((seg, i) => (
                <div key={i} className="segment">
                  {seg.time && <span className="timecode">[{seg.time}]</span>}
                  <span className="segment-text">{seg.text}</span>
                </div>
              ))
            ) : (
              // Чистый текст — все сегменты слитно
              <p>{toPlainText(segments)}</p>
            )}
          </div>
        </div>
      )}

      {/* Блок LLM постобработки — появляется после транскрипции */}
      {rawResult && (
        <div className="llm-section">
          <div className="llm-header">
            <span className="llm-title">🤖 Обработка текста</span>
          </div>

          {/* Сетка стилей обработки */}
          <div className="style-grid">
            {promptStyles.map((style) => (
              <button
                key={style.id}
                className={
                  selectedStyleId === style.id
                    ? "style-btn active"
                    : "style-btn"
                }
                onClick={() => setSelectedStyleId(style.id)}
                disabled={isLlmLoading}
              >
                <span className="style-icon">{style.icon}</span>
                <span className="style-label">{style.label}</span>
              </button>
            ))}
          </div>

          {/* Поле своего промта — только для стиля "custom" */}
          {selectedStyleId === "custom" && (
            <textarea
              className="custom-prompt"
              placeholder="Введите инструкцию для LLM..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
              disabled={isLlmLoading}
            />
          )}

          {/* Кнопка запуска LLM */}
          <button
            className="primary"
            onClick={handleLlmProcess}
            disabled={!finalPrompt || isLlmLoading}
          >
            {isLlmLoading ? "⏳ Обработка..." : "🤖 Обработать через LLM"}
          </button>

          {/* Ошибка LLM */}
          {llmError && <div className="error">{llmError}</div>}

          {/* Результат LLM */}
          {llmResult && (
            <div className="result-section">
              <div className="result-toolbar">
                <span className="llm-result-label">
                  {selectedStyle?.icon} {selectedStyle?.label}
                </span>
                <div className="action-group">
                  <button className="action-btn" onClick={handleLlmCopy}>
                    {llmCopied ? "✅ Скопировано" : "📋 Копировать"}
                  </button>
                  <button className="action-btn" onClick={handleLlmExport}>
                    💾 TXT
                  </button>
                </div>
              </div>
              <div className="result">
                <ReactMarkdown>{llmResult}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Статусная строка — фиксирована внизу окна */}
      {/* Статусная строка — фиксирована внизу окна */}
      <div className="statusbar">
        <div className="statusbar-left">
          {/* Индикатор текущей операции */}
          <div
            className={`status-dot ${
              isLoading || isLlmLoading
                ? "loading"
                : error || llmError
                  ? "error"
                  : rawResult
                    ? "active"
                    : ""
            }`}
          />
          <span>
            {isLoading
              ? "Транскрипция..."
              : isLlmLoading
                ? "LLM обрабатывает..."
                : error
                  ? "Ошибка транскрипции"
                  : llmError
                    ? "Ошибка LLM"
                    : rawResult
                      ? "Готово"
                      : "Ожидание"}
          </span>

          {/* Время транскрипции */}
          {elapsed !== null && !isLoading && (
            <span className="statusbar-time">
              🎙️{" "}
              {elapsed > 60000
                ? `${Math.floor(elapsed / 60000)}м ${Math.floor((elapsed % 60000) / 1000)}с`
                : `${(elapsed / 1000).toFixed(1)}с`}
            </span>
          )}

          {/* Время LLM */}
          {/* {llmElapsed !== null && !isLlmLoading && (
            <span className="statusbar-time">
              🤖{" "}
              {llmElapsed > 60000
                ? `${Math.floor(llmElapsed / 60000)}м ${Math.floor((llmElapsed % 60000) / 1000)}с`
                : `${(llmElapsed / 1000).toFixed(1)}с`}
            </span>
          )} */}
        </div>

        <div className="statusbar-right">
          {/* Модель whisper — с иконкой микрофона */}
          {selectedModel && (
            <div className="statusbar-item" title="Модель транскрипции">
              <span>🎙️</span>
              <span className="statusbar-badge whisper-badge">
                {selectedModel.replace("ggml-", "").replace(".bin", "")}
              </span>
            </div>
          )}

          {/* Разделитель */}
          <div className="statusbar-divider" />

          {/* Модель LLM — с индикатором подключения */}
          {llmModel && (
            <div className="statusbar-item" title="Модель LLM">
              <div
                className={`status-dot ${
                  llmConnected === true
                    ? "active"
                    : llmConnected === false
                      ? "error"
                      : ""
                }`}
              />
              <span>🤖</span>
              <span className="statusbar-badge llm-badge">{llmModel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
