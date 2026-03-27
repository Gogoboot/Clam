export interface TranscriptionSegment {
  time: string;
  text: string;
}

/**
 * Байты → читаемый вид (например, 1533000000 → "1.43 GB")
 */
export const bytesToHuman = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(2)} KB`;
};

/**
 * Форматирует миллисекунды в вид "1м 23с" или "5.2с"
 */
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return "";
  if (ms > 60000) {
    return `${Math.floor(ms / 60000)}м ${Math.floor((ms % 60000) / 1000)}с`;
  }
  return `${(ms / 1000).toFixed(1)}с`;
};

/**
 * Парсит сырой вывод Whisper в массив сегментов
 */
export const parseSegments = (raw: string): TranscriptionSegment[] => {
  const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3})\]\s+(.*)/g;
  const segments: TranscriptionSegment[] = [];
  let match;
  while ((match = regex.exec(raw)) !== null) {
    segments.push({ time: match[1], text: match[2].trim() });
  }
  if (segments.length === 0 && raw.trim()) {
    segments.push({ time: "", text: raw.trim() });
  }
  return segments;
};

/**
 * Генерирует SRT (субтитры)
 */
export const toSrt = (segments: TranscriptionSegment[]): string => {
  return segments
    .map((seg, i) => {
      if (!seg.time.includes(" --> ")) return "";
      const [start, end] = seg.time.split(" --> ").map(t => t.replace(".", ","));
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .filter(Boolean)
    .join("\n");
};

/**
 * Извлекает чистый текст без таймкодов
 */
export const toPlainText = (segments: TranscriptionSegment[]): string => {
  return segments.map(s => s.text).join(" ");
};
