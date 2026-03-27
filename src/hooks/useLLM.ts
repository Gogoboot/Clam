import { useState, useRef, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { toPlainText, TranscriptionSegment } from "../utils/transcriptionUtils";

// ===========================
// Типы
// ===========================
export interface PromptStyle {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

interface UseLLMProps {
  segments: TranscriptionSegment[];
  rawResult: string;
  llmUrl: string;
  llmModel: string;
}

// ===========================
// Хук
// ===========================
export function useLLM({ segments, rawResult, llmUrl, llmModel }: UseLLMProps) {
  const [promptStyles, setPromptStyles] = useState<PromptStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string>("summary");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [llmResult, setLlmResult] = useState<string>("");
  const [isLlmLoading, setIsLlmLoading] = useState<boolean>(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmCopied, setLlmCopied] = useState<boolean>(false);
  const [llmElapsed, setLlmElapsed] = useState<number | null>(null);

  // Контроллер отмены запроса
  const llmAbortController = useRef<AbortController | null>(null);

  // Текущий выбранный стиль
  const selectedStyle = promptStyles.find(s => s.id === selectedStyleId);

  // Финальный промт — свой или из библиотеки
  const finalPrompt = selectedStyleId === "custom"
    ? customPrompt
    : (selectedStyle?.prompt ?? "");

  // Загружаем библиотеку промтов при старте
  useEffect(() => {
    invoke<PromptStyle[]>("list_prompt_styles")
      .then(styles => setPromptStyles(styles))
      .catch(e => console.error("Ошибка загрузки стилей:", e));
  }, []);

  // Отменяем запрос при размонтировании
  useEffect(() => {
    return () => {
      if (llmAbortController.current) {
        llmAbortController.current.abort();
      }
    };
  }, []);

  // Стриминг ответа LLM напрямую из фронтенда
  const handleLlmProcess = async (): Promise<void> => {
    if (!rawResult || !finalPrompt) return;

    // Отменяем предыдущий запрос
    if (llmAbortController.current) {
      llmAbortController.current.abort();
    }

    const controller = new AbortController();
    llmAbortController.current = controller;

    setIsLlmLoading(true);
    setLlmResult("");
    setLlmError(null);
    setLlmElapsed(null);

    const startTime = Date.now();
    try {
      const response = await fetch(`${llmUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      if (e instanceof Error && e.name === "AbortError") return;
      setLlmError(`Ошибка LLM: ${e}`);
    } finally {
      setIsLlmLoading(false);
      llmAbortController.current = null;
    }
  };

  // Отмена запроса
  const handleLlmAbort = () => {
    if (llmAbortController.current) {
      llmAbortController.current.abort();
      llmAbortController.current = null;
      setIsLlmLoading(false);
      setLlmError(null);
    }
  };

  // Копируем результат LLM
  const handleLlmCopy = async () => {
    await navigator.clipboard.writeText(llmResult);
    setLlmCopied(true);
    setTimeout(() => setLlmCopied(false), 2000);
  };

  // Экспорт результата LLM в .txt
  const handleLlmExport = async () => {
    const savePath = await save({
      filters: [{ name: "Text", extensions: ["txt"] }],
      defaultPath: "llm-result.txt",
    });
    if (savePath) await writeTextFile(savePath, llmResult);
  };

  return {
    // Состояния
    promptStyles,
    selectedStyleId, setSelectedStyleId,
    customPrompt, setCustomPrompt,
    llmResult, setLlmResult,
    isLlmLoading,
    llmError,
    llmCopied,
    llmElapsed,
    selectedStyle,
    finalPrompt,
    // Обработчики
    handleLlmProcess,
    handleLlmAbort,
    handleLlmCopy,
    handleLlmExport,
  };
}
