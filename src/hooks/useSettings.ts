import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

// ===========================
// Типы
// ===========================

export interface AppSettings {
  theme: "light" | "dark";
  llmUrl: string;
  llmModel: string;
  selectedModel: string;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

// Значения по умолчанию
const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  llmUrl: "http://127.0.0.1:1234",
  llmModel: "gemma-3-12b-it",
  selectedModel: "",
  leftCollapsed: false,
  rightCollapsed: false,
};

// ===========================
// Хук
// ===========================
export function useSettings() {
  const [theme, setTheme] = useState<"light" | "dark">(DEFAULT_SETTINGS.theme);
  const [llmUrl, setLlmUrl] = useState<string>(DEFAULT_SETTINGS.llmUrl);
  const [llmModel, setLlmModel] = useState<string>(DEFAULT_SETTINGS.llmModel);
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(DEFAULT_SETTINGS.leftCollapsed);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(DEFAULT_SETTINGS.rightCollapsed);

  // Применяем тему через data-атрибут на <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Загружаем настройки из store при старте
  useEffect(() => {
    load("settings.json").then(async store => {
      const savedTheme = await store.get<"light" | "dark">("theme");
      if (savedTheme) setTheme(savedTheme);

      const savedUrl = await store.get<string>("llmUrl");
      if (savedUrl) setLlmUrl(savedUrl);

      const savedModel = await store.get<string>("llmModel");
      if (savedModel) setLlmModel(savedModel);

      const savedLeftCollapsed = await store.get<boolean>("leftCollapsed");
      if (savedLeftCollapsed != null) setLeftCollapsed(savedLeftCollapsed);

      const savedRightCollapsed = await store.get<boolean>("rightCollapsed");
      if (savedRightCollapsed != null) setRightCollapsed(savedRightCollapsed);
    }).catch(console.error);
  }, []);

  // Сохраняем изменения в store
  const saveSettings = async (updates: Partial<AppSettings>) => {
    try {
      const store = await load("settings.json");
      for (const [key, value] of Object.entries(updates)) {
        await store.set(key, value);
      }
      await store.save();
    } catch (e) {
      console.error("Ошибка сохранения настроек:", e);
    }
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

  // Сохраняем настройки LLM и проверяем соединение
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setLlmConnected(null);
    try {
      await invoke("set_llm_settings", { baseUrl: llmUrl, model: llmModel });
      const response = await fetch(`${llmUrl}/v1/models`);
      setLlmConnected(response.ok);
      await saveSettings({ llmUrl, llmModel });
    } catch {
      setLlmConnected(false);
    } finally {
      setIsSavingSettings(false);
    }
  };

  return {
    // Тема
    theme, toggleTheme,
    // LLM настройки
    llmUrl, setLlmUrl,
    llmModel, setLlmModel,
    llmConnected,
    isSavingSettings,
    handleSaveSettings,
    // Layout
    leftCollapsed, toggleLeftPanel,
    rightCollapsed, toggleRightPanel,
    // Утилита сохранения
    saveSettings,
  };
}
