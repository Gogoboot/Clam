<<<<<<< HEAD
# My Transcriber

Офлайн транскрибатор на базе Tauri + Rust + whisper.cpp

## Требования
- Windows x64
- Модели whisper в `src-tauri/resources/models/`
- Бинарник whisper-cli в `src-tauri/bin/`

## Запуск
```bash
pnpm install
pnpm tauri dev
```

## Стек
- Tauri 2
- Rust
- React + TypeScript
- whisper.cpp
- 
- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
=======
# 🎙️ Офлайн-транскрибатор

Десктопное приложение для офлайн-транскрипции аудио и видео файлов на базе [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

## 🛠️ Стек

- [Tauri 2](https://tauri.app/) — десктопный фреймворк
- [Rust](https://www.rust-lang.org/) — бэкенд
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — фронтенд
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — офлайн транскрипция

## ✨ Возможности

- 🎯 Офлайн транскрипция — без интернета, данные не покидают компьютер
- 🗂️ Выбор модели — tiny / base / small / medium / large
- ⏱️ Таймкоды — отображение с временными метками или чистым текстом
- 📋 Копирование в буфер обмена
- 💾 Экспорт в `.txt` и `.srt` (субтитры)
- 📊 Время транскрипции

## 📋 Требования

- Windows x64
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)

## 🚀 Запуск для разработки

```bash
# Установить зависимости
pnpm install

# Запустить в режиме разработки
pnpm tauri dev
```

## 📁 Структура проекта

```
my-transcriber/
├── src/                        # Фронтенд (React + TypeScript)
│   ├── App.tsx
│   └── App.css
├── src-tauri/                  # Бэкенд (Rust)
│   ├── src/
│   │   ├── app/                # AppState
│   │   ├── commands.rs         # Tauri команды (IPC)
│   │   ├── error.rs            # Обработка ошибок
│   │   ├── file_handler/       # Валидация и подготовка файлов
│   │   ├── model_manager/      # Управление моделями whisper
│   │   └── transcriber/        # Транскрипция через whisper-cli
│   ├── bin/                    # Бинарник whisper-cli + DLL
│   ├── resources/
│   │   └── models/             # Модели whisper (.bin файлы)
│   └── capabilities/
│       └── default.json        # Разрешения Tauri
└── README.md
```

## 🤖 Модели Whisper

Скачать модели можно с [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp):

| Модель | Размер | Скорость | Качество |
|--------|--------|----------|----------|
| tiny   | 75 MB  | ⚡⚡⚡⚡⚡ | ⭐⭐ |
| base   | 142 MB | ⚡⚡⚡⚡  | ⭐⭐⭐ |
| small  | 466 MB | ⚡⚡⚡    | ⭐⭐⭐⭐ |
| medium | 1.5 GB | ⚡⚡      | ⭐⭐⭐⭐⭐ |
| large  | 3.1 GB | ⚡        | ⭐⭐⭐⭐⭐ |

Положить в: `src-tauri/resources/models/`

## 📦 Сборка

```bash
pnpm tauri build
```
>>>>>>> 53e81ef (feat: model selection, progress, export txt/srt, elapsed time)
