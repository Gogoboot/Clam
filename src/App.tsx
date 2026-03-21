import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import './App.css';

// Тип совпадает с Rust структурой ModelInfo
interface ModelInfo {
  name: string;
  filename: string;
  size_bytes: number;
}

// Переводим байты в читаемый вид: 3095033483 → "2.88 GB"
function bytesToHuman(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Загружаем список моделей при старте
  // `useEffect` с пустым массивом [] — выполняется один раз при монтировании
  useEffect(() => {
    invoke<ModelInfo[]>('list_models')
      .then(list => {
        setModels(list);
        // Автоматически выбираем первую модель если список не пустой
        if (list.length > 0) {
          setSelectedModel(list[0].filename);
        }
      })
      .catch(e => setError(`Ошибка загрузки моделей: ${e}`));
  }, []);

  // Подписка на прогресс транскрипции
  useEffect(() => {
    const unlisten = listen<string>('transcribe-progress', (event) => {
      setProgress(prev => [...prev.slice(-50), event.payload]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  const handleSelectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Audio/Video', extensions: ['mp3', 'wav', 'mp4', 'ogg', 'm4a', 'flac'] }]
    });
    if (typeof selected === 'string') {
      setFilePath(selected);
      setResult('');
      setProgress([]);
      setError(null);
    }
  };

  const handleTranscribe = async () => {
    if (!filePath || !selectedModel) return;
    setIsLoading(true);
    setResult('');
    setProgress([]);
    setError(null);
    try {
      const text = await invoke<string>('transcribe', {
        filePath,
        modelFilename: selectedModel, // camelCase на фронте = snake_case в Rust
      });
      setResult(text);
    } catch (e) {
      setError(`Ошибка: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Офлайн-транскрибатор</h1>

      {/* Выбор модели */}
      <div className="section">
        <label>Модель:</label>
        {models.length === 0 ? (
          <p className="warning">⚠️ Модели не найдены в папке resources/models/</p>
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
        <button onClick={handleSelectFile} disabled={isLoading}>
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

      {/* Прогресс */}
      {isLoading && progress.length > 0 && (
        <div className="progress-log">
          {progress.map((line, i) => (
            <div key={i} className="progress-line">{line}</div>
          ))}
        </div>
      )}

      {/* Ошибка */}
      {error && <div className="error">{error}</div>}

      {/* Результат */}
      {result && <div className="result">{result}</div>}
    </div>
  );
}

export default App;