import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { useSettings } from "./hooks/useSettings";
import { useTranscription } from "./hooks/useTranscription";
import { useLLM } from "./hooks/useLLM";
import { bytesToHuman, formatDuration } from "./utils/transcriptionUtils";
import "./App.css";

function App() {
  // ===========================
  // Хуки
  // ===========================
  const settings = useSettings();
  const transcription = useTranscription(settings.saveSettings);
  const llm = useLLM({
    segments: transcription.segments,
    rawResult: transcription.rawResult,
    llmUrl: settings.llmUrl,
    llmModel: settings.llmModel,
  });

  // Активная вкладка — здесь потому что зависит от обоих хуков
  const [activeTab, setActiveTab] = useState<"transcription" | "llm">("transcription");

  // ===========================
  // Рендер
  // ===========================
  return (
    <div className="app-layout">

      {/* ШАПКА */}
      <div className="app-header">
        <div className="app-header-left">
          <button
            className="collapse-btn"
            onClick={settings.toggleLeftPanel}
            title={settings.leftCollapsed ? "Развернуть панель промтов" : "Свернуть панель промтов"}
          >
            {settings.leftCollapsed ? "▶" : "◀"}
          </button>
          <h1>Офлайн-транскрибатор</h1>
        </div>

        <div className="app-header-center">
          <button
            onClick={transcription.handleSelectFile}
            disabled={transcription.isLoading}
            className="file-btn-header"
          >
            {transcription.filePath
              ? `📁 ${transcription.filePath.split("\\").pop()}`
              : "📂 Выбрать файл"}
          </button>
          <button
            onClick={() => {
              transcription.handleTranscribe();
              setActiveTab("transcription");
            }}
            disabled={!transcription.filePath || !transcription.selectedModel || transcription.isLoading}
            className="primary-header"
          >
            {transcription.isLoading ? "⏳ Расшифровка..." : "Расшифровать"}
          </button>
        </div>

        <div className="app-header-right">
          <button className="icon-btn" onClick={settings.toggleTheme} title="Сменить тему">
            {settings.theme === "light" ? "🌙" : "☀️"}
          </button>
          <button
            className="collapse-btn"
            onClick={settings.toggleRightPanel}
            title={settings.rightCollapsed ? "Развернуть настройки" : "Свернуть настройки"}
          >
            {settings.rightCollapsed ? "◀" : "▶"}
          </button>
        </div>
      </div>

      {/* ТЕЛО */}
      <div className="app-body">

        {/* ЛЕВАЯ КОЛОНКА */}
        {!settings.leftCollapsed && (
          <div className="left-panel">
            <div className="panel-title">🤖 Обработка текста</div>

            <div className="style-list">
              {llm.promptStyles.map(style => (
                <button
                  key={style.id}
                  className={llm.selectedStyleId === style.id ? "style-item active" : "style-item"}
                  onClick={() => llm.setSelectedStyleId(style.id)}
                  disabled={llm.isLlmLoading}
                >
                  <span className="style-icon">{style.icon}</span>
                  <span className="style-label">{style.label}</span>
                </button>
              ))}
            </div>

            {llm.selectedStyleId === "custom" && (
              <textarea
                className="custom-prompt"
                placeholder="Введите инструкцию для LLM..."
                value={llm.customPrompt}
                onChange={e => llm.setCustomPrompt(e.target.value)}
                rows={4}
                disabled={llm.isLlmLoading}
              />
            )}

            <button
              className="primary"
              onClick={() => {
                llm.handleLlmProcess();
                setActiveTab("llm");
              }}
              disabled={!transcription.rawResult || !llm.finalPrompt || llm.isLlmLoading}
            >
              {llm.isLlmLoading ? "⏳ Обработка..." : "🤖 Обработать"}
            </button>

            {llm.isLlmLoading && (
              <button className="stop-btn" onClick={llm.handleLlmAbort}>
                ⏹ Остановить
              </button>
            )}

            {llm.llmError && <div className="error">{llm.llmError}</div>}
          </div>
        )}

        {/* ЦЕНТР */}
        <div className="center-panel">
          <div className="tabs-bar">
            <button
              className={activeTab === "transcription" ? "tab active" : "tab"}
              onClick={() => setActiveTab("transcription")}
            >
              📄 Транскрипция
              {transcription.isLoading && <span className="tab-dot loading" />}
              {transcription.rawResult && !transcription.isLoading && <span className="tab-dot active" />}
            </button>
            <button
              className={activeTab === "llm" ? "tab active" : "tab"}
              onClick={() => setActiveTab("llm")}
            >
              🤖 LLM результат
              {llm.isLlmLoading && <span className="tab-dot loading" />}
              {llm.llmResult && !llm.isLlmLoading && <span className="tab-dot active" />}
            </button>
          </div>

          {/* Вкладка транскрипции */}
          {activeTab === "transcription" && (
            <div className="tab-content">
              {transcription.isLoading && transcription.progress.length > 0 && (
                <div className="progress-log">
                  {transcription.progress.slice(-3).map((line, i) => (
                    <div key={i} className="progress-line">{line}</div>
                  ))}
                </div>
              )}

              {transcription.error && <div className="error">{transcription.error}</div>}

              {transcription.rawResult && (
                <>
                  <div className="result-toolbar">
                    <div className="toggle-group">
                      <button
                        className={transcription.showTimecodes ? "toggle active" : "toggle"}
                        onClick={() => transcription.setShowTimecodes(true)}
                      >
                        🕐 С таймкодами
                      </button>
                      <button
                        className={!transcription.showTimecodes ? "toggle active" : "toggle"}
                        onClick={() => transcription.setShowTimecodes(false)}
                      >
                        📄 Чистый текст
                      </button>
                    </div>
                    <div className="action-group">
                      <button className="action-btn" onClick={transcription.handleCopy}>
                        {transcription.copied ? "✅ Скопировано" : "📋 Копировать"}
                      </button>
                      <button className="action-btn" onClick={transcription.handleExportTxt}>
                        💾 TXT
                      </button>
                      <button className="action-btn" onClick={transcription.handleExportSrt}>
                        🎬 SRT
                      </button>
                    </div>
                  </div>

                  <div className="result">
                    {transcription.showTimecodes ? (
                      transcription.segments.map((seg, i) => (
                        <div key={i} className="segment">
                          {seg.time && <span className="timecode">[{seg.time}]</span>}
                          <span className="segment-text">{seg.text}</span>
                        </div>
                      ))
                    ) : (
                      <p>{transcription.segments.map(s => s.text).join(" ")}</p>
                    )}
                  </div>
                </>
              )}

              {!transcription.rawResult && !transcription.isLoading && !transcription.error && (
                <div className="empty-state">
                  <span className="empty-icon">🎙️</span>
                  <p>Выберите файл и нажмите «Расшифровать»</p>
                </div>
              )}
            </div>
          )}

          {/* Вкладка LLM */}
          {activeTab === "llm" && (
            <div className="tab-content">
              {llm.llmResult && (
                <>
                  <div className="result-toolbar">
                    <span className="llm-result-label">
                      {llm.selectedStyle?.icon} {llm.selectedStyle?.label}
                      {llm.llmElapsed !== null && (
                        <span className="statusbar-time">
                          {formatDuration(llm.llmElapsed)}
                        </span>
                      )}
                    </span>
                    <div className="action-group">
                      <button className="action-btn" onClick={llm.handleLlmCopy}>
                        {llm.llmCopied ? "✅ Скопировано" : "📋 Копировать"}
                      </button>
                      <button className="action-btn" onClick={llm.handleLlmExport}>
                        💾 TXT
                      </button>
                    </div>
                  </div>
                  <div className="result">
                    <ReactMarkdown>{llm.llmResult}</ReactMarkdown>
                  </div>
                </>
              )}

              {!llm.llmResult && !llm.isLlmLoading && (
                <div className="empty-state">
                  <span className="empty-icon">🤖</span>
                  <p>Выберите стиль и нажмите «Обработать»</p>
                </div>
              )}

              {llm.isLlmLoading && !llm.llmResult && (
                <div className="empty-state">
                  <span className="empty-icon">⏳</span>
                  <p>LLM обрабатывает текст...</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ПРАВАЯ КОЛОНКА */}
        {!settings.rightCollapsed && (
          <div className="right-panel">
            <div className="panel-section">
              <div className="panel-section-title">🎙️ Whisper</div>
              {transcription.models.length === 0 ? (
                <p className="warning">⚠️ Модели не найдены</p>
              ) : (
                <select
                  value={transcription.selectedModel}
                  onChange={e => transcription.handleModelChange(e.target.value)}
                  disabled={transcription.isLoading}
                  className="settings-select"
                >
                  {transcription.models.map(m => (
                    <option key={m.filename} value={m.filename}>
                      {m.name} ({bytesToHuman(m.size_bytes)})
                    </option>
                  ))}
                </select>
              )}
              {transcription.elapsed !== null && (
                <div className="settings-info">
                  ⏱ {formatDuration(transcription.elapsed)}
                </div>
              )}
            </div>

            <div className="panel-divider" />

            <div className="panel-section">
              <div className="panel-section-title">🤖 LLM сервер</div>
              <div className="settings-field">
                <label>URL:</label>
                <input
                  type="text"
                  value={settings.llmUrl}
                  onChange={e => settings.setLlmUrl(e.target.value)}
                  placeholder="http://127.0.0.1:1234"
                  className="settings-input"
                />
              </div>
              <div className="settings-field">
                <label>Модель:</label>
                <input
                  type="text"
                  value={settings.llmModel}
                  onChange={e => settings.setLlmModel(e.target.value)}
                  placeholder="gemma-3-12b-it"
                  className="settings-input"
                />
              </div>
              {settings.llmConnected !== null && (
                <div className={settings.llmConnected ? "status-ok" : "status-err"}>
                  {settings.llmConnected ? "🟢 Подключено" : "🔴 Нет соединения"}
                </div>
              )}
              <button
                className="primary"
                onClick={settings.handleSaveSettings}
                disabled={settings.isSavingSettings}
              >
                {settings.isSavingSettings ? "⏳ Проверка..." : "Сохранить и проверить"}
              </button>
            </div>

            <div className="panel-divider" />

            <div className="panel-section">
              <div className="panel-section-title">⚙️ Интерфейс</div>
              <div className="theme-switch">
                <span className="theme-switch-label">☀️</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={settings.theme === "dark"}
                    onChange={settings.toggleTheme}
                  />
                  <span className="switch-slider" />
                </label>
                <span className="theme-switch-label">🌙</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* СТАТУСНАЯ СТРОКА */}
      <div className="statusbar">
        <div className="statusbar-left">
          <div className={`status-dot ${
            transcription.isLoading || llm.isLlmLoading ? "loading" :
            transcription.error || llm.llmError ? "error" :
            transcription.rawResult ? "active" : ""
          }`} />
          <span>
            {transcription.isLoading ? "Транскрипция..." :
             llm.isLlmLoading ? "LLM обрабатывает..." :
             transcription.error ? "Ошибка транскрипции" :
             llm.llmError ? "Ошибка LLM" :
             transcription.rawResult ? "Готово" : "Ожидание"}
          </span>
          {transcription.elapsed !== null && !transcription.isLoading && (
            <span className="statusbar-time">
              🎙️ {formatDuration(transcription.elapsed)}
            </span>
          )}
          {llm.llmElapsed !== null && !llm.isLlmLoading && (
            <span className="statusbar-time">
              🤖 {formatDuration(llm.llmElapsed)}
            </span>
          )}
        </div>
        <div className="statusbar-right">
          {transcription.selectedModel && (
            <div className="statusbar-item" title="Модель транскрипции">
              <span>🎙️</span>
              <span className="statusbar-badge whisper-badge">
                {transcription.selectedModel.replace("ggml-", "").replace(".bin", "")}
              </span>
            </div>
          )}
          <div className="statusbar-divider" />
          {settings.llmModel && (
            <div className="statusbar-item" title="Модель LLM">
              <div className={`status-dot ${
                settings.llmConnected === true ? "active" :
                settings.llmConnected === false ? "error" : ""
              }`} />
              <span>🤖</span>
              <span className="statusbar-badge llm-badge">{settings.llmModel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
