import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import './App.css';

// ===========================
// Типы
// ===========================

// Совпадает с Rust структурой ModelInfo
interface ModelInfo {
  name: string;       // "ggml-medium"
  filename: string;   // "ggml-medium.bin"
  size_bytes: number; // 1533000000
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
  const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3})\]\s+(.*)/g;
  const segments: { time: string; text: string }[] = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    segments.push({ time: match[1], text: match[2].trim() });
  }
  // Если таймкоды не найдены — весь текст как один сегмент
  if (segments.length === 0 && raw.trim()) {
    segments.push({ time: '', text: raw.trim() });
  }
  return segments;
}

// Конвертируем в формат SRT субтитров
// "00:00:07.740" → "00:00:07,740" (точка → запятая)
function toSrt(segments: { time: string; text: string }[]): string {
  return segments.map((seg, i) => {
    const [start, end] = seg.time
      .split(' --> ')
      .map(t => t.replace('.', ','));
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join('\n');
}

// Чистый текст без таймкодов — все сегменты через пробел
function toPlainText(segments: { time: string; text: string }[]): string {
  return segments.map(s => s.text).join(' ');
}

// ===========================
// Компонент
// ===========================
function App() {
  // Путь к выбранному файлу
  const [filePath, setFilePath] = useState<string | null>(null);
  // Список доступных моделей whisper
  const [models, setModels] = useState<ModelInfo[]>([]);
  // Имя файла выбранной модели
  const [selectedModel, setSelectedModel] = useState<string>('');
  // Сырой результат транскрипции с таймкодами
  const [rawResult, setRawResult] = useState<string>('');
  // Флаг загрузки — блокирует UI во время транскрипции
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // Строки прогресса из stderr whisper
  const [progress, setProgress] = useState<string[]>([]);
  // Текст ошибки если что-то пошло не так
  const [error, setError] = useState<string | null>(null);
  // Режим отображения: true = с таймкодами, false = чистый текст
  const [showTimecodes, setShowTimecodes] = useState<boolean>(true);
  // Флаг для анимации кнопки "Скопировано"
  const [copied, setCopied] = useState<boolean>(false);
  // Время транскрипции в миллисекундах
  const [elapsed, setElapsed] = useState<number | null>(null);
  // Текущая тема: light / dark
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Парсим сегменты из сырого результата
  const segments = parseSegments(rawResult);

  // ===========================
  // Эффекты
  // ===========================

  // Применяем тему через data-атрибут на <html>
  // CSS читает [data-theme="dark"] и переключает переменные
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Загружаем список моделей при старте приложения
  // Пустой массив [] = выполняется один раз при монтировании
  useEffect(() => {
    invoke<ModelInfo[]>('list_models')
      .then(list => {
        setModels(list);
        // Автовыбор первой модели из списка
        if (list.length > 0) setSelectedModel(list[0].filename);
      })
      .catch(e => setError(`Ошибка загрузки моделей: ${e}`));
  }, []);

  // Подписываемся на события прогресса от Rust
  // Rust делает app.emit("transcribe-progress", line) → мы получаем здесь
  useEffect(() => {
    const unlisten = listen<string>('transcribe-progress', (event) => {
      // Храним последние 50 строк чтобы не переполнить память
      setProgress(prev => [...prev.slice(-50), event.payload]);
    });
    // Отписываемся при размонтировании компонента
    return () => { unlisten.then(f => f()); };
  }, []);

  // ===========================
  // Обработчики
  // ===========================

  // Открываем диалог выбора файла через Tauri
  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Audio/Video', extensions: ['mp3', 'wav', 'mp4', 'ogg', 'm4a', 'flac', 'mkv', 'avi'] }]
    });
    if (typeof selected === 'string') {
      setFilePath(selected);
      // Сбрасываем предыдущий результат
      setRawResult('');
      setProgress([]);
      setError(null);
    }
  };

  // Запускаем транскрипцию через IPC команду Tauri
  // invoke('transcribe') → Rust commands::transcribe()
  const handleTranscribe = async () => {
    if (!filePath || !selectedModel) return;
    setIsLoading(true);
    setRawResult('');
    setProgress([]);
    setError(null);
    setElapsed(null);

    // Засекаем время начала
    const startTime = Date.now();

    try {
      const text = await invoke<string>('transcribe', {
        filePath,
        modelFilename: selectedModel, // camelCase → snake_case в Rust автоматически
      });
      setRawResult(text);
      // Считаем сколько времени заняла транскрипция
      setElapsed(Date.now() - startTime);
    } catch (e) {
      setError(`Ошибка: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Копируем текст в буфер обмена
  // В зависимости от режима — с таймкодами или чистый
  const handleCopy = async () => {
    const text = showTimecodes ? rawResult : toPlainText(segments);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    // Сбрасываем флаг через 2 секунды
    setTimeout(() => setCopied(false), 2000);
  };

  // Сохраняем чистый текст в .txt файл
  const handleExportTxt = async () => {
    const savePath = await save({
      filters: [{ name: 'Text', extensions: ['txt'] }],
      defaultPath: 'transcription.txt',
    });
    if (savePath) {
      await writeTextFile(savePath, toPlainText(segments));
    }
  };

  // Сохраняем субтитры в .srt файл
  const handleExportSrt = async () => {
    const savePath = await save({
      filters: [{ name: 'Subtitles', extensions: ['srt'] }],
      defaultPath: 'transcription.srt',
    });
    if (savePath) {
      await writeTextFile(savePath, toSrt(segments));
    }
  };

  // Переключаем тему light ↔ dark
  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  // ===========================
  // Рендер
  // ===========================
  return (
    <div className="container">

      {/* Шапка с переключателем темы */}
      <div className="header">
        <h1>Офлайн-транскрибатор</h1>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>

      {/* Выбор модели whisper */}
      <div className="card">
         <div className="section">
            <label>Модель:</label>
            {models.length === 0 ? (
              <p className="warning">⚠️ Модели не найдены</p>
            ) : (
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={isLoading}
              >
                {models.map(m => (
                  <option key={m.filename} value={m.filename}>
                    {m.name} ({bytesToHuman(m.size_bytes)})
                  </option>
                ))}
              </select>
            )}
          </div>
      </div>

      {/* Кнопка выбора аудио/видео файла */}
      <div className="card">
        <div className="section">
          <button onClick={handleSelectFile} disabled={isLoading} className="file-btn">
            {filePath ? `📁 ${filePath.split('\\').pop()}` : 'Выбрать файл'}
          </button>
        </div>
      </div>

      {/* Главная кнопка — запуск транскрипции */}
      <button
        onClick={handleTranscribe}
        disabled={!filePath || !selectedModel || isLoading}
        className="primary"
      >
        {isLoading ? '⏳ Расшифровка...' : 'Расшифровать'}
      </button>

      {/* Время потраченное на транскрипцию */}
      {elapsed !== null && (
        <div className="elapsed">
          ⏱ Время: {elapsed > 60000
            ? `${Math.floor(elapsed / 60000)} мин ${Math.floor((elapsed % 60000) / 1000)} сек`
            : `${(elapsed / 1000).toFixed(1)} сек`}
        </div>
      )}

      {/* Лог прогресса — показываем последние 5 строк из stderr whisper */}
      {isLoading && progress.length > 0 && (
        <div className="progress-log">
          {progress.slice(-5).map((line, i) => (
            <div key={i} className="progress-line">{line}</div>
          ))}
        </div>
      )}

      {/* Блок ошибки */}
      {error && <div className="error">{error}</div>}

      {/* Блок результата — появляется после успешной транскрипции */}
      {rawResult && (
        <div className="result-section">

          {/* Тулбар с переключателями и кнопками экспорта */}
          <div className="result-toolbar">

            {/* Переключатель режима отображения */}
            <div className="toggle-group">
              <button
                className={showTimecodes ? 'toggle active' : 'toggle'}
                onClick={() => setShowTimecodes(true)}
              >
                🕐 С таймкодами
              </button>
              <button
                className={!showTimecodes ? 'toggle active' : 'toggle'}
                onClick={() => setShowTimecodes(false)}
              >
                📄 Чистый текст
              </button>
            </div>

            {/* Кнопки действий с результатом */}
            <div className="action-group">
              <button className="action-btn" onClick={handleCopy}>
                {copied ? '✅ Скопировано' : '📋 Копировать'}
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
                  {seg.time && (
                    <span className="timecode">[{seg.time}]</span>
                  )}
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
    </div>
  );
}

export default App;
