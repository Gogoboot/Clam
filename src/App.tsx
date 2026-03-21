import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import './App.css';

interface ModelInfo {
  name: string;
  filename: string;
  size_bytes: number;
}

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
  // Если таймкоды не найдены — возвращаем весь текст как один сегмент
  if (segments.length === 0 && raw.trim()) {
    segments.push({ time: '', text: raw.trim() });
  }
  return segments;
}

// Конвертируем "00:00:07.740" → "00:00:07,740" (формат SRT)
function toSrt(segments: { time: string; text: string }[]): string {
  return segments.map((seg, i) => {
    const [start, end] = seg.time
      .split(' --> ')
      .map(t => t.replace('.', ','));
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join('\n');
}

function toPlainText(segments: { time: string; text: string }[]): string {
  return segments.map(s => s.text).join(' ');
}

function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [rawResult, setRawResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showTimecodes, setShowTimecodes] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const segments = parseSegments(rawResult);

  useEffect(() => {
    invoke<ModelInfo[]>('list_models')
      .then(list => {
        setModels(list);
        if (list.length > 0) setSelectedModel(list[0].filename);
      })
      .catch(e => setError(`Ошибка загрузки моделей: ${e}`));
  }, []);

  useEffect(() => {
    const unlisten = listen<string>('transcribe-progress', (event) => {
      setProgress(prev => [...prev.slice(-50), event.payload]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Audio/Video', extensions: ['mp3', 'wav', 'mp4', 'ogg', 'm4a', 'flac', 'mkv', 'avi'] }]
    });
    if (typeof selected === 'string') {
      setFilePath(selected);
      setRawResult('');
      setProgress([]);
      setError(null);
    }
  };


  const handleTranscribe = async () => {
    if (!filePath || !selectedModel) return;
    setIsLoading(true);
    setRawResult('');
    setProgress([]);
    setError(null);
    setElapsed(null);

    const startTime = Date.now(); // ← засекаем время

    try {
      const text = await invoke<string>('transcribe', {
        filePath,
        modelFilename: selectedModel,
      });
      setRawResult(text);
      setElapsed(Date.now() - startTime); // ← считаем разницу
    } catch (e) {
      setError(`Ошибка: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };


  // Копируем текст в буфер обмена
  const handleCopy = async () => {
    const text = showTimecodes ? rawResult : toPlainText(segments);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Экспорт в .txt
  const handleExportTxt = async () => {
    const savePath = await save({
      filters: [{ name: 'Text', extensions: ['txt'] }],
      defaultPath: 'transcription.txt',
    });
    if (savePath) {
      await writeTextFile(savePath, toPlainText(segments));
    }
  };

  // Экспорт в .srt
  const handleExportSrt = async () => {
    const savePath = await save({
      filters: [{ name: 'Subtitles', extensions: ['srt'] }],
      defaultPath: 'transcription.srt',
    });
    if (savePath) {
      await writeTextFile(savePath, toSrt(segments));
    }
  };

  return (
    <div className="container">
      <h1>Офлайн-транскрибатор</h1>

      {/* Выбор модели */}
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

      {/* Выбор файла */}
      <div className="section">
        <button onClick={handleSelectFile} disabled={isLoading} className="file-btn">
          {filePath ? `📁 ${filePath.split('\\').pop()}` : 'Выбрать файл'}
        </button>
      </div>

      {/* Кнопка транскрипции */}
      <button
        onClick={handleTranscribe}
        disabled={!filePath || !selectedModel || isLoading}
        className="primary"
      >
        {isLoading ? '⏳ Расшифровка...' : 'Расшифровать'}
      </button>

      {elapsed !== null && (
        <div className="elapsed">
          ⏱ Время: {elapsed > 60000
            ? `${Math.floor(elapsed / 60000)} мин ${Math.floor((elapsed % 60000) / 1000)} сек`
            : `${(elapsed / 1000).toFixed(1)} сек`}
        </div>
      )}


      {/* Прогресс */}
      {isLoading && progress.length > 0 && (
        <div className="progress-log">
          {progress.slice(-5).map((line, i) => (
            <div key={i} className="progress-line">{line}</div>
          ))}
        </div>
      )}

      {/* Ошибка */}
      {error && <div className="error">{error}</div>}

      {/* Результат */}
      {rawResult && (
        <div className="result-section">

          {/* Тулбар результата */}
          <div className="result-toolbar">
            {/* Переключатель режима */}
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

            {/* Кнопки действий */}
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
              // Режим с таймкодами
              segments.map((seg, i) => (
                <div key={i} className="segment">
                  {seg.time && (
                    <span className="timecode">[{seg.time}]</span>
                  )}
                  <span className="segment-text">{seg.text}</span>
                </div>
              ))
            ) : (
              // Чистый текст
              <p>{toPlainText(segments)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
