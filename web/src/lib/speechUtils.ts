/**
 * Speech & Text Punctuation Utility for Web Speech Synthesis API.
 * Local Female Voice is permanently purged — all female and Arabic speech
 * is exclusively handled by the ElevenLabs API model (eleven_multilingual_v2).
 */

export interface LanguageDetectionResult {
  isArabicPredominant: boolean;
  isEnglishPredominant: boolean;
  detectedLanguage: 'Arabic' | 'English';
  arabicCount: number;
  englishCount: number;
  totalLetters: number;
  arabicRatio: number;
}

export const detectLanguageContent = (text: string): LanguageDetectionResult => {
  if (!text) {
    return {
      isArabicPredominant: false,
      isEnglishPredominant: true,
      detectedLanguage: 'English',
      arabicCount: 0,
      englishCount: 0,
      totalLetters: 0,
      arabicRatio: 0,
    };
  }

  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = arabicChars + englishChars;

  if (totalLetters === 0) {
    const hasArabic = /[\u0600-\u06FF]/.test(text);
    return {
      isArabicPredominant: hasArabic,
      isEnglishPredominant: !hasArabic,
      detectedLanguage: hasArabic ? 'Arabic' : 'English',
      arabicCount: arabicChars,
      englishCount: englishChars,
      totalLetters: 0,
      arabicRatio: hasArabic ? 1 : 0,
    };
  }

  const arabicRatio = arabicChars / totalLetters;
  const isArabicPredominant = arabicRatio >= 0.35 || (arabicChars > 0 && englishChars === 0);
  const isEnglishPredominant = !isArabicPredominant;

  return {
    isArabicPredominant,
    isEnglishPredominant,
    detectedLanguage: isArabicPredominant ? 'Arabic' : 'English',
    arabicCount: arabicChars,
    englishCount: englishChars,
    totalLetters,
    arabicRatio,
  };
};

export const sanitizeTextForSpeech = (text: string): string => {
  if (!text) return '';

  return text
    .replace(/^[\s]*[*•\-+]\s+/gm, 'Item: ')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/--+/g, ', ')
    .replace(/[\*\#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const isArabic = (text: string): boolean => {
  return detectLanguageContent(text).isArabicPredominant;
};

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export const getVoicesSafely = (): Promise<SpeechSynthesisVoice[]> => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([]);

  if (cachedVoices.length > 0) return Promise.resolve(cachedVoices);

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    cachedVoices = existing;
    return Promise.resolve(existing);
  }

  if (!voicesPromise) {
    voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        const v = window.speechSynthesis.getVoices();
        if (v.length > 0) cachedVoices = v;
        window.speechSynthesis.removeEventListener('voiceschanged', settle);
        resolve(v);
      };
      window.speechSynthesis.addEventListener('voiceschanged', settle);
      setTimeout(settle, 1000);
    });
  }
  return voicesPromise;
};

// Eagerly trigger voice loading if in browser
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    const v = window.speechSynthesis.getVoices();
    if (v.length > 0) cachedVoices = v;
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      const updated = window.speechSynthesis.getVoices();
      if (updated.length > 0) cachedVoices = updated;
    });
  } catch {}
}

export const pickArabicVoice = (
  voices: SpeechSynthesisVoice[],
  persona?: 'jarvis' | 'gwen'
): SpeechSynthesisVoice | undefined => {
  // STRICT PERMANENT BAN: Local female voices (Salma, Hoda, Laila, Zeina, etc.) are PURGED.
  // Female Arabic voice is handled EXCLUSIVELY by ElevenLabs API.
  if (persona === 'gwen') {
    return undefined;
  }

  // Filter out any female voice strictly
  const maleArabicVoices = voices.filter((v) => {
    const name = v.name.toLowerCase();
    const isFemale =
      name.includes('female') ||
      name.includes('salma') ||
      name.includes('hoda') ||
      name.includes('laila') ||
      name.includes('zeina') ||
      name.includes('mariam') ||
      name.includes('fatima') ||
      name.includes('zira') ||
      name.includes('jenny');
    if (isFemale) return false;

    return (
      v.lang.toLowerCase().includes('ar') ||
      name.includes('arabic') ||
      name.includes('shakir') ||
      name.includes('tarik') ||
      name.includes('maged') ||
      name.includes('hamed') ||
      name.includes('bassel') ||
      name.includes('naayf') ||
      name.includes('male')
    );
  });

  if (maleArabicVoices.length === 0) return undefined;

  const maleEg = maleArabicVoices.find(
    (v) =>
      v.lang.toLowerCase().includes('ar-eg') &&
      (v.name.toLowerCase().includes('shakir') || v.name.toLowerCase().includes('male'))
  );
  if (maleEg) return maleEg;

  const generalMale = maleArabicVoices.find(
    (v) =>
      v.name.toLowerCase().includes('shakir') ||
      v.name.toLowerCase().includes('male') ||
      v.name.toLowerCase().includes('tarik') ||
      v.name.toLowerCase().includes('hamed') ||
      v.name.toLowerCase().includes('maged') ||
      v.name.toLowerCase().includes('bassel') ||
      v.name.toLowerCase().includes('naayf')
  );
  if (generalMale) return generalMale;

  // Return any other verified non-female Arabic voice
  return maleArabicVoices[0];
};

export const pickEnglishVoice = (
  voices: SpeechSynthesisVoice[],
  persona?: 'jarvis' | 'gwen'
): SpeechSynthesisVoice | undefined => {
  // STRICT PERMANENT BAN: Local female voices are PURGED.
  if (persona === 'gwen') {
    return undefined;
  }

  const maleEnglishVoices = voices.filter((v) => {
    const name = v.name.toLowerCase();
    const isFemale =
      name.includes('female') ||
      name.includes('zira') ||
      name.includes('jenny') ||
      name.includes('samantha') ||
      name.includes('victoria') ||
      name.includes('linda') ||
      name.includes('susan');
    if (isFemale) return false;
    return v.lang.toLowerCase().startsWith('en');
  });

  if (maleEnglishVoices.length === 0) return undefined;

  // Jarvis British / sophisticated male voice
  const britishMale = maleEnglishVoices.find(
    (v) =>
      (v.lang.toLowerCase().includes('gb') || v.lang.toLowerCase().includes('uk')) &&
      (v.name.toLowerCase().includes('male') ||
        v.name.toLowerCase().includes('george') ||
        v.name.toLowerCase().includes('oliver') ||
        v.name.toLowerCase().includes('daniel'))
  );
  if (britishMale) return britishMale;

  const naturalMale = maleEnglishVoices.find(
    (v) =>
      v.name.toLowerCase().includes('david') ||
      v.name.toLowerCase().includes('mark') ||
      v.name.toLowerCase().includes('guy') ||
      v.name.toLowerCase().includes('natural') ||
      v.name.toLowerCase().includes('male')
  );
  if (naturalMale) return naturalMale;

  return undefined;
};

export const splitTextIntoSentences = (text: string): string[] => {
  if (!text) return [];
  // Split on periods, exclamation, question marks, Arabic comma/semicolon, or newlines
  const rawChunks = text.split(/([.!?،؟؛\n]+)/g);
  const sentences: string[] = [];
  let buffer = '';

  for (let i = 0; i < rawChunks.length; i += 2) {
    const segment = rawChunks[i] || '';
    const punctuation = rawChunks[i + 1] || '';
    const combined = (segment + punctuation).trim();
    if (!combined) continue;

    buffer = buffer ? `${buffer} ${combined}` : combined;
    if (buffer.length > 80 || punctuation) {
      sentences.push(buffer);
      buffer = '';
    }
  }

  if (buffer.trim()) {
    sentences.push(buffer.trim());
  }

  return sentences.filter((s) => s.trim().length > 0);
};

/**
 * Strips completed and active streaming reasoning (<think>) blocks so they are never spoken.
 */
export const cleanSpokenText = (text: string): string => {
  if (!text) return '';
  let clean = text.replace(/<think[\s\S]*?<\/think>/gi, '');
  return clean.replace(/<think[\s\S]*/gi, '');
};

export interface ExtractedSentence {
  sentence: string;
  nextIndex: number;
}

/**
 * Incrementally extracts the next clean, spoken sentence from streaming LLM output.
 */
export const extractNextSpokenSentence = (
  cleanText: string,
  startIndex: number
): ExtractedSentence | null => {
  if (!cleanText || startIndex >= cleanText.length) return null;

  const unchunked = cleanText.slice(startIndex);
  // Match standard sentence terminators: . ! ? ؟ ؛ or newline followed by space or end
  const match = unchunked.match(/([.!?؛؟\n]+)(?:\s+|$)/);
  if (match && match.index !== undefined) {
    const boundary = match.index + match[1].length;
    const raw = unchunked.slice(0, boundary).trim();
    if (raw.length > 0) {
      return { sentence: raw, nextIndex: startIndex + boundary };
    }
  }

    // If unchunked is getting long (> 60 chars or > 10 words) and has a clause separator (comma)
  if (unchunked.length > 60) {
    const commaMatch = unchunked.match(/([,،])\s+/);
    if (commaMatch && commaMatch.index !== undefined && commaMatch.index > 15) {
      const boundary = commaMatch.index + commaMatch[1].length;
      const raw = unchunked.slice(0, boundary).trim();
      if (raw.length > 0) {
        return { sentence: raw, nextIndex: startIndex + boundary };
      }
    }
  }

  // If unchunked is reaching >= 75 chars without punctuation, split at word boundary for zero-delay speech
  if (unchunked.length >= 75) {
    const spaceIndex = unchunked.lastIndexOf(' ', 75);
    if (spaceIndex >= 25) {
      const raw = unchunked.slice(0, spaceIndex).trim();
      if (raw.length > 0) {
        return { sentence: raw, nextIndex: startIndex + spaceIndex + 1 };
      }
    }
  }

  return null;
};

export type QueueTask = (signal: AbortSignal) => Promise<void>;

/**
 * Pipelined sequential audio playback queue for streaming TTS sentences.
 * Ensures sentence audio plays without gaps and can be instantly aborted upon interruption.
 */
export class PipelinedAudioQueue {
  private queue: QueueTask[] = [];
  private isProcessing = false;
  private isAborted = false;
  private currentAbortController: AbortController | null = null;
  private onSpeakingChange?: (speaking: boolean) => void;

  constructor(onSpeakingChange?: (speaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange;
  }

  public enqueue(task: QueueTask): void {
    if (this.isAborted) return;
    this.queue.push(task);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.isProcessing || this.isAborted) return;
    this.isProcessing = true;
    this.onSpeakingChange?.(true);

    while (this.queue.length > 0 && !this.isAborted) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        this.currentAbortController = new AbortController();
        try {
          await nextTask(this.currentAbortController.signal);
        } catch (err) {
          console.warn('[PipelinedAudioQueue] sentence play notice:', err);
        } finally {
          this.currentAbortController = null;
        }
      }
    }

    this.isProcessing = false;
    if (this.queue.length === 0 && !this.isAborted) {
      this.onSpeakingChange?.(false);
    }
  }

  public abort(): void {
    this.isAborted = true;
    this.queue = [];
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.onSpeakingChange?.(false);
  }

  public async waitUntilDone(): Promise<void> {
    while ((this.isProcessing || this.queue.length > 0) && !this.isAborted) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
}

