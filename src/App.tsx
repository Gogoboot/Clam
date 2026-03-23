import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import { load } from '@tauri-apps/plugin-store';
import "./App.css";

// ===========================
// Типы — совпадают с Rust структурами
// ===========================

interface ModelInfo {
  name: string;       // "ggml-medium"
  filename: string;   // "ggml-medium.bin"
  size_bytes: number; // 1533000000
}

interface PromptStyle {
  id: string;     // "summary"
  label: string;  // "Выжимка"
  icon: string;   // "📝"
  prompt: string; // системный промт для LLM
}

interface LlmSettings {
  base_url: string; // "http://127.0.0.1:1234"
  model: string;    // "gemma-3-12b-it"
}

// ===========================
// Вспомогательные функции
// ===========================

// Байты → читаемый вид: 1533000000 → "1.43 GB"
function bytesToHuman(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

// "[00:00:00.000 --> 00:00:07.740]   Текст" → [{time, text}]
function parseSegments(raw: string): { time: string; text: string }[] {
  const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3})\]\s+(.*)/g;
  const segments: { time: string; text: string }[] = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    segments.push({ time: match[1], text: match[2].trim() });
  }
  if (segments.length === 0 && raw.trim()) {
    segments.push({ time: "", text: raw.trim() });
  }
  return segments;
}

// "00:00:07.740" → "00:00:07,740" для формата SRT
function toSrt(segments: { time: string; text: string }[]): string {
  return segments.map((seg, i) => {
    const [start, end] = seg.time.split(" --> ").map(t => t.replace(".", ","));
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join("\n");
}

// Все сегменты → чистый текст без таймкодов
function toPlainText(segments: { time: string; text: string }[]): string {
  return segments.map(s => s.text).join(" ");
}

// ===========================
// Компонент
// ===========================
function App() {

  // ===========================
  // Состояния — транскрипция
  // ===========================
  const [filePath, setFilePath] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [rawResult, setRawResult] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showTimecodes, setShowTimecodes] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // ===========================
  // Состояния — LLM
  // ===========================
  const [promptStyles, setPromptStyles] = useState<PromptStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>("summary");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [llmResult, setLlmResult] = useState<string>("");
  const [isLlmLoading, setIsLlmLoading] = useState<boolean>(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmCopied, setLlmCopied] = useState<boolean>(false);
  const [llmElapsed, setLlmElapsed] = useState<number | null>(null);

  // ===========================
  // Состояния — настройки LLM
  // ===========================
  const [llmUrl, setLlmUrl] = useState<string>("http://127.0.0.1:1234");
  const [llmModel, setLlmModel] = useState<string>("gemma-3-12b-it");
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);

  // ===========================
  // Состояния — layout
  // ===========================
  // Левая колонка (стили промтов) — свёрнута или нет
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  // Правая колонка (настройки) — свёрнута или нет
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  // Активная вкладка в центре: "transcription" или "llm"
  const [activeTab, setActiveTab] = useState<"transcription" | "llm">("transcription");

  // Вычисляем сегменты из сырого результата
  const segments = parseSegments(rawResult);

  // Текущий выбранный стиль
  const selectedStyle = promptStyles.find(s => s.id === selectedStyleId);

  // Финальный промт — свой или из библиотеки
  const finalPrompt = selectedStyleId === "custom"
    ? customPrompt
    : (selectedStyle?.prompt ?? "");

  // Сохраняем настройки в store при каждом изменении
  // autoSave: true — автоматически записывает на диск
  const saveSettings = async (updates: Record<string, unknown>) => {
    try {
      const store = await load('settings.json');
      for (const [key, value] of Object.entries(updates)) {
        await store.set(key, value);
      }
    } catch (e) {
      console.error('Ошибка сохранения настроек:', e);
    }
  };

    
  // ===========================
  // Эффекты
  // ===========================

  // Применяем тему через data-атрибут на <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Загружаем данные при старте — с сохранением между сессиями
  useEffect(() => {
    // Список моделей whisper
    invoke<ModelInfo[]>("list_models")
      .then(list => {
        setModels(list);
        if (list.length > 0) setSelectedModel(list[0].filename);
      })
      .catch(e => setError(`Ошибка загрузки моделей: ${e}`));

    // Библиотека промтов
    invoke<PromptStyle[]>("list_prompt_styles")
      .then(styles => setPromptStyles(styles))
      .catch(e => console.error("Ошибка загрузки стилей:", e));

    // invoke<LlmSettings>("get_llm_settings")
    //   .then(s => {
    //     setLlmUrl(s.base_url);
    //     setLlmModel(s.model);
        // Загружаем сохранённые настройки из store
        // store — это JSON файл на диске в папке приложения
        load('settings.json').then(async store => {
          // Тема
          const savedTheme = await store.get<'light' | 'dark'>('theme');
          if (savedTheme) setTheme(savedTheme);

          // URL LLM сервера
          const savedUrl = await store.get<string>('llmUrl');
          if (savedUrl) setLlmUrl(savedUrl);

          // Модель LLM
          const savedModel = await store.get<string>('llmModel');
          if (savedModel) setLlmModel(savedModel);

          // Выбранная модель whisper
          const savedWhisper = await store.get<string>('selectedModel');
          if (savedWhisper) setSelectedModel(savedWhisper);

          // Состояние колонок
          const savedLeftCollapsed = await store.get<boolean>('leftCollapsed');
          if (savedLeftCollapsed !== null && savedLeftCollapsed !== undefined) {
            setLeftCollapsed(savedLeftCollapsed);
          }
          const savedRightCollapsed = await store.get<boolean>('rightCollapsed');
          if (savedRightCollapsed !== null && savedRightCollapsed !== undefined) {
            setRightCollapsed(savedRightCollapsed);
          }
      
      })
      .catch(console.error);
  }, []);

  // Подписка на прогресс транскрипции от Rust
  useEffect(() => {
    const unlisten = listen<string>("transcribe-progress", event => {
      setProgress(prev => [...prev.slice(-50), event.payload]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Отменяем запрос при размонтировании компонента
  useEffect(() => {
    return () => {
      if (llmAbortController.current) {
        llmAbortController.current.abort();
      }
    };
  }, []);

  // ===========================
  // Обработчики — транскрипция
  // ===========================

  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "Audio/Video",
        extensions: ["mp3", "wav", "mp4", "ogg", "m4a", "flac", "mkv", "avi"],
      }],
    });
    if (typeof selected === "string") {
      setFilePath(selected);
      setRawResult("");
      setProgress([]);
      setError(null);
      setLlmResult("");
    }
  };

  // invoke('transcribe') → Rust commands::transcribe()
  const handleTranscribe = async () => {
    if (!filePath || !selectedModel) return;
    setIsLoading(true);
    setRawResult("");
    setProgress([]);
    setError(null);
    setElapsed(null);
    setLlmResult("");
    setActiveTab("transcription"); // переключаемся на вкладку транскрипции

    const startTime = Date.now();
    try {
      const text = await invoke<string>("transcribe", {
        filePath,
        modelFilename: selectedModel,
      });
      setRawResult(text);
      setElapsed(Date.now() - startTime);
    } catch (e) {
      setError(`Ошибка: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    const text = showTimecodes ? rawResult : toPlainText(segments);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportTxt = async () => {
    const savePath = await save({
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: "transcription.txt",
    });
    if (savePath) await writeTextFile(savePath, toPlainText(segments));
  };

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

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setLlmConnected(null);
    try {
      await invoke("set_llm_settings", { baseUrl: llmUrl, model: llmModel });
      const response = await fetch(`${llmUrl}/v1/models`);
      setLlmConnected(response.ok);
  // Сохраняем в store
    await saveSettings({ llmUrl, llmModel });
    } catch {
      setLlmConnected(false);
    } finally {
      setIsSavingSettings(false);
    }
    };

  // ===========================
  // Обработчики — LLM
  // ===========================

  // Храним контроллер отмены между вызовами
// useRef — не вызывает перерендер при изменении
const llmAbortController = useRef<AbortController | null>(null);

// Стриминг ответа LLM с поддержкой отмены через AbortController
const handleLlmProcess = async () => {
  if (!rawResult || !finalPrompt) return;

  // Отменяем предыдущий запрос если он ещё идёт
  if (llmAbortController.current) {
    llmAbortController.current.abort();
  }

  // Создаём новый контроллер для этого запроса
  const controller = new AbortController();
  llmAbortController.current = controller;

  setIsLlmLoading(true);
  setLlmResult("");
  setLlmError(null);
  setLlmElapsed(null);
  setActiveTab("llm");

  const startTime = Date.now();
  try {
    const response = await fetch(`${llmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Передаём signal — fetch автоматически прервётся при abort()
      signal: controller.signal,
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
      const lines = chunk.split("\n").filter(line => line.startsWith("data: "));
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
        } catch { }
      }
    }
    setLlmElapsed(Date.now() - startTime);
  } catch (e: unknown) {
    // Игнорируем ошибку отмены — это нормальное поведение
    if (e instanceof Error && e.name === "AbortError") {
      console.log("LLM запрос отменён");
      return;
    }
    setLlmError(`Ошибка LLM: ${e}`);
  } finally {
    setIsLlmLoading(false);
    // Очищаем контроллер после завершения
    llmAbortController.current = null;
  }
};

// Отменяем запрос LLM — кнопка "Стоп"
const handleLlmAbort = () => {
  if (llmAbortController.current) {
    llmAbortController.current.abort();
    llmAbortController.current = null;
    setIsLlmLoading(false);
    setLlmError(null);
  }
};

  //* ********************* */
  const handleLlmCopy = async () => {
    await navigator.clipboard.writeText(llmResult);
    setLlmCopied(true);
    setTimeout(() => setLlmCopied(false), 2000);
  };

  const handleLlmExport = async () => {
    const savePath = await save({
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: "llm-result.txt",
    });
    if (savePath) await writeTextFile(savePath, llmResult);
  };

// Переключаем тему и сохраняем
const toggleTheme = () => {
  const newTheme = theme === "light" ? "dark" : "light";
  setTheme(newTheme);
  saveSettings({ theme: newTheme });
};

// Сворачиваем левую колонку и сохраняем
const toggleLeftPanel = () => {
  const newVal = !leftCollapsed;
  setLeftCollapsed(newVal);
  saveSettings({ leftCollapsed: newVal });
};

// Сворачиваем правую колонку и сохраняем
const toggleRightPanel = () => {
  const newVal = !rightCollapsed;
  setRightCollapsed(newVal);
  saveSettings({ rightCollapsed: newVal });
};

  // ===========================
  // Рендер
  // ===========================
  return (
    <div className="app-layout">

      {/* ===========================
          ШАПКА — на всю ширину
          =========================== */}
      <div className="app-header">

        {/* Левая часть шапки — название */}
        <div className="app-header-left">
          {/* Кнопка свернуть/развернуть левую колонку */}
          <button
            className="collapse-btn"
            onClick={toggleLeftPanel}
            title={leftCollapsed ? "Развернуть панель промтов" : "Свернуть панель промтов"}
          >
            {leftCollapsed ? "▶" : "◀"}
          </button>
          <h1>Офлайн-транскрибатор</h1>
        </div>

        {/* Центральная часть шапки — выбор файла и кнопка */}
        <div className="app-header-center">
          <button
            onClick={handleSelectFile}
            disabled={isLoading}
            className="file-btn-header"
          >
            {filePath ? `📁 ${filePath.split("\\").pop()}` : "📂 Выбрать файл"}
          </button>
          <button
            onClick={handleTranscribe}
            disabled={!filePath || !selectedModel || isLoading}
            className="primary-header"
          >
            {isLoading ? "⏳ Расшифровка..." : "Расшифровать"}
          </button>
        </div>

        {/* Правая часть шапки — кнопки */}
        <div className="app-header-right">
          <button className="icon-btn" onClick={toggleTheme} title="Сменить тему">
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          {/* Кнопка свернуть/развернуть правую колонку */}
          <button
            className="collapse-btn"
            onClick={toggleRightPanel}
            title={rightCollapsed ? "Развернуть настройки" : "Свернуть настройки"}
          >
            {rightCollapsed ? "◀" : "▶"}
          </button>
        </div>
      </div>

      {/* ===========================
          ОСНОВНОЙ КОНТЕНТ — три колонки
          =========================== */}
      <div className="app-body">

        {/* ===========================
            ЛЕВАЯ КОЛОНКА — стили промтов
            =========================== */}
        {!leftCollapsed && (
          <div className="left-panel">
            <div className="panel-title">🤖 Обработка текста</div>

            {/* Сетка стилей */}
            <div className="style-list">
              {promptStyles.map(style => (
                <button
                  key={style.id}
                  className={selectedStyleId === style.id ? "style-item active" : "style-item"}
                  onClick={() => setSelectedStyleId(style.id)}
                  disabled={isLlmLoading}
                >
                  <span className="style-icon">{style.icon}</span>
                  <span className="style-label">{style.label}</span>
                </button>
              ))}
            </div>

            {/* Поле своего промта */}
            {selectedStyleId === "custom" && (
              <textarea
                className="custom-prompt"
                placeholder="Введите инструкцию для LLM..."
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                rows={4}
                disabled={isLlmLoading}
              />
            )}

            {/* Кнопка запуска LLM */}
            <button
              className="primary"
              onClick={handleLlmProcess}
              disabled={!rawResult || !finalPrompt || isLlmLoading}
            >
              {isLlmLoading ? "⏳ Обработка..." : "🤖 Обработать"}
            </button>

            {/* Кнопка отмены — появляется только во время обработки */}    
            {isLlmLoading && (
            <button
              className="stop-btn"
              onClick={handleLlmAbort}
            >
              ⏹ Остановить
            </button>
            )}

            {/* Ошибка LLM */}
            {llmError && <div className="error">{llmError}</div>}
          </div>
        )}

        {/* ===========================
            ЦЕНТРАЛЬНАЯ ОБЛАСТЬ — вкладки
            =========================== */}
        <div className="center-panel">

          {/* Вкладки в стиле браузера */}
          <div className="tabs-bar">
            <button
              className={activeTab === "transcription" ? "tab active" : "tab"}
              onClick={() => setActiveTab("transcription")}
            >
              📄 Транскрипция
              {/* Индикатор загрузки на вкладке */}
              {isLoading && <span className="tab-dot loading" />}
              {rawResult && !isLoading && <span className="tab-dot active" />}
            </button>
            <button
              className={activeTab === "llm" ? "tab active" : "tab"}
              onClick={() => setActiveTab("llm")}
            >
              🤖 LLM результат
              {isLlmLoading && <span className="tab-dot loading" />}
              {llmResult && !isLlmLoading && <span className="tab-dot active" />}
            </button>
          </div>

          {/* ===========================
              ВКЛАДКА — Транскрипция
              =========================== */}
          {activeTab === "transcription" && (
            <div className="tab-content">

              {/* Прогресс во время транскрипции */}
              {isLoading && progress.length > 0 && (
                <div className="progress-log">
                  {progress.slice(-3).map((line, i) => (
                    <div key={i} className="progress-line">{line}</div>
                  ))}
                </div>
              )}

              {/* Ошибка */}
              {error && <div className="error">{error}</div>}

              {/* Тулбар результата */}
              {rawResult && (
                <>
                  <div className="result-toolbar">
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

                  {/* Текст транскрипции */}
                  <div className="result">
                    {showTimecodes ? (
                      segments.map((seg, i) => (
                        <div key={i} className="segment">
                          {seg.time && <span className="timecode">[{seg.time}]</span>}
                          <span className="segment-text">{seg.text}</span>
                        </div>
                      ))
                    ) : (
                      <p>{toPlainText(segments)}</p>
                    )}
                  </div>
                </>
              )}

              {/* Пустое состояние */}
              {!rawResult && !isLoading && !error && (
                <div className="empty-state">
                  <span className="empty-icon">🎙️</span>
                  <p>Выберите файл и нажмите «Расшифровать»</p>
                </div>
              )}
            </div>
          )}

          {/* ===========================
              ВКЛАДКА — LLM результат
              =========================== */}
          {activeTab === "llm" && (
            <div className="tab-content">

              {/* Тулбар результата LLM */}
              {llmResult && (
                <>
                  <div className="result-toolbar">
                    <span className="llm-result-label">
                      {selectedStyle?.icon} {selectedStyle?.label}
                      {llmElapsed !== null && (
                        <span className="statusbar-time">
                          {llmElapsed > 60000
                            ? ` ${Math.floor(llmElapsed / 60000)}м ${Math.floor((llmElapsed % 60000) / 1000)}с`
                            : ` ${(llmElapsed / 1000).toFixed(1)}с`}
                        </span>
                      )}
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

                  {/* Markdown результат LLM */}
                  <div className="result">
                    <ReactMarkdown>{llmResult}</ReactMarkdown>
                  </div>
                </>
              )}

              {/* Пустое состояние */}
              {!llmResult && !isLlmLoading && (
                <div className="empty-state">
                  <span className="empty-icon">🤖</span>
                  <p>Выберите стиль и нажмите «Обработать»</p>
                </div>
              )}

              {/* Загрузка */}
              {isLlmLoading && !llmResult && (
                <div className="empty-state">
                  <span className="empty-icon">⏳</span>
                  <p>LLM обрабатывает текст...</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===========================
            ПРАВАЯ КОЛОНКА — настройки
            =========================== */}
        {!rightCollapsed && (
          <div className="right-panel">

            {/* Настройки Whisper */}
            <div className="panel-section">
              <div className="panel-section-title">🎙️ Whisper</div>
              {models.length === 0 ? (
                <p className="warning">⚠️ Модели не найдены</p>
              ) : (
                <select
                  value={selectedModel}
                  onChange={e => {
                   setSelectedModel(e.target.value)
                   saveSettings({ selectedModel: e.target.value }); 
                  }}
                  disabled={isLoading}
                  className="settings-select"
                >
                  {models.map(m => (
                    <option key={m.filename} value={m.filename}>
                      {m.name} ({bytesToHuman(m.size_bytes)})
                    </option>
                  ))}
                </select>
              )}
              {/* Время последней транскрипции */}
              {elapsed !== null && (
                <div className="settings-info">
                  ⏱ {elapsed > 60000
                    ? `${Math.floor(elapsed / 60000)}м ${Math.floor((elapsed % 60000) / 1000)}с`
                    : `${(elapsed / 1000).toFixed(1)}с`}
                </div>
              )}
            </div>

            {/* Разделитель */}
            <div className="panel-divider" />

            {/* Настройки LLM */}
            <div className="panel-section">
              <div className="panel-section-title">🤖 LLM сервер</div>

              <div className="settings-field">
                <label>URL:</label>
                <input
                  type="text"
                  value={llmUrl}
                  onChange={e => setLlmUrl(e.target.value)}
                  placeholder="http://127.0.0.1:1234"
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label>Модель:</label>
                <input
                  type="text"
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                  placeholder="gemma-3-12b-it"
                  className="settings-input"
                />
              </div>

              {/* Статус соединения */}
              {llmConnected !== null && (
                <div className={llmConnected ? "status-ok" : "status-err"}>
                  {llmConnected ? "🟢 Подключено" : "🔴 Нет соединения"}
                </div>
              )}

              <button
                className="primary"
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
              >
                {isSavingSettings ? "⏳ Проверка..." : "Сохранить и проверить"}
              </button>
            </div>

            {/* Разделитель */}
            <div className="panel-divider" />

            {/* Настройки интерфейса */}
            <div className="panel-section">
              <div className="panel-section-title">⚙️ Интерфейс</div>
              {/* Стало — ползунок */}
                  <div className="theme-switch">
                    <span className="theme-switch-label">☀️</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={theme === "dark"}
                        onChange={toggleTheme}
                      />
                      <span className="switch-slider" />
                    </label>
                    <span className="theme-switch-label">🌙</span>
                  </div>
            </div>
          </div>
        )}
      </div>

      {/* ===========================
          СТАТУСНАЯ СТРОКА
          =========================== */}
      <div className="statusbar">
        <div className="statusbar-left">
          <div className={`status-dot ${
            isLoading || isLlmLoading ? "loading" :
            error || llmError ? "error" :
            rawResult ? "active" : ""
          }`} />
          <span>
            {isLoading ? "Транскрипция..." :
             isLlmLoading ? "LLM обрабатывает..." :
             error ? "Ошибка транскрипции" :
             llmError ? "Ошибка LLM" :
             rawResult ? "Готово" : "Ожидание"}
          </span>
          {elapsed !== null && !isLoading && (
            <span className="statusbar-time">
              🎙️ {elapsed > 60000
                ? `${Math.floor(elapsed / 60000)}м ${Math.floor((elapsed % 60000) / 1000)}с`
                : `${(elapsed / 1000).toFixed(1)}с`}
            </span>
          )}
          {llmElapsed !== null && !isLlmLoading && (
            <span className="statusbar-time">
              🤖 {llmElapsed > 60000
                ? `${Math.floor(llmElapsed / 60000)}м ${Math.floor((llmElapsed % 60000) / 1000)}с`
                : `${(llmElapsed / 1000).toFixed(1)}с`}
            </span>
          )}
        </div>
        <div className="statusbar-right">
          {selectedModel && (
            <div className="statusbar-item" title="Модель транскрипции">
              <span>🎙️</span>
              <span className="statusbar-badge whisper-badge">
                {selectedModel.replace("ggml-", "").replace(".bin", "")}
              </span>
            </div>
          )}
          <div className="statusbar-divider" />
          {llmModel && (
            <div className="statusbar-item" title="Модель LLM">
              <div className={`status-dot ${
                llmConnected === true ? "active" :
                llmConnected === false ? "error" : ""
              }`} />
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
