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

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export const getVoicesSafely = (): Promise<SpeechSynthesisVoice[]> => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([]);

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  if (!voicesPromise) {
    voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', settle);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener('voiceschanged', settle);
      setTimeout(settle, 2000);
    });
  }
  return voicesPromise;
};

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
      v.name.toLowerCase().includes('male') ||
      v.name.toLowerCase().includes('shakir') ||
      v.name.toLowerCase().includes('tarik')
  );
  if (generalMale) return generalMale;

  return undefined; // Never fall back to an unverified voice that might be female
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
