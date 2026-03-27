import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import {
  parseSegments,
  toSrt,
  toPlainText,
  TranscriptionSegment,
} from "../utils/transcriptionUtils";

// ===========================
// Типы
// ===========================
export interface ModelInfo {
  name: string;
  filename: string;
  size_bytes: number;
}

// ===========================
// Хук
// ===========================
export function useTranscription(saveSettings: (updates: Record<string, unknown>) => Promise<void>) {
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

  // useMemo — пересчитываем только когда меняется rawResult
  const segments: TranscriptionSegment[] = useMemo(
    () => parseSegments(rawResult),
    [rawResult]
  );

  // Загружаем модели при старте
  useEffect(() => {
    invoke<ModelInfo[]>("list_models")
      .then(list => {
        setModels(list);
        if (list.length > 0) setSelectedModel(list[0].filename);
      })
      .catch(e => setError(`Ошибка загрузки моделей: ${e}`));
  }, []);

  // Загружаем сохранённую модель из store
  useEffect(() => {
    // Получаем selectedModel из store через saveSettings
    // Модель устанавливается в useSettings при загрузке
  }, []);

  // Подписка на прогресс транскрипции от Rust
  useEffect(() => {
    const unlisten = listen<string>("transcribe-progress", event => {
      setProgress(prev => [...prev.slice(-50), event.payload]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Выбор файла через диалог Tauri
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
    }
  };

  // Запуск транскрипции через Rust команду
  const handleTranscribe = async (): Promise<void> => {
    if (!filePath || !selectedModel) return;
    setIsLoading(true);
    setRawResult("");
    setProgress([]);
    setError(null);
    setElapsed(null);

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
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: "transcription.txt",
    });
    if (savePath) await writeTextFile(savePath, toPlainText(segments));
  };

  // Экспорт в .srt
  const handleExportSrt = async () => {
    const savePath = await save({
      filters: [{ name: "Subtitles", extensions: ["srt"] }],
      defaultPath: "transcription.srt",
    });
    if (savePath) await writeTextFile(savePath, toSrt(segments));
  };

  // Смена модели с сохранением в store
  const handleModelChange = (filename: string) => {
    setSelectedModel(filename);
    saveSettings({ selectedModel: filename });
  };

  return {
    // Состояния
    filePath, setFilePath,
    models,
    selectedModel, handleModelChange,
    rawResult, setRawResult,
    isLoading,
    progress,
    error, setError,
    showTimecodes, setShowTimecodes,
    copied,
    elapsed,
    segments,
    // Обработчики
    handleSelectFile,
    handleTranscribe,
    handleCopy,
    handleExportTxt,
    handleExportSrt,
  };
}
