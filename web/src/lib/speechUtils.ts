/**
 * Speech & Text Punctuation Utility for Web Speech Synthesis API.
 */

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
  const arabicRegex = /[\u0600-\u06FF]/;
  return arabicRegex.test(text);
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
  const arabicVoices = voices.filter(
    (v) =>
      v.lang.toLowerCase().includes('ar') ||
      v.name.toLowerCase().includes('arabic') ||
      v.name.toLowerCase().includes('shakir') ||
      v.name.toLowerCase().includes('salma') ||
      v.name.toLowerCase().includes('hoda') ||
      v.name.toLowerCase().includes('tarik')
  );

  if (arabicVoices.length === 0) return undefined;

  // Prefer Egyptian Arabic (ar-EG) if available
  const egVoice = arabicVoices.find((v) => v.lang.toLowerCase().includes('ar-eg'));
  if (egVoice) return egVoice;

  // Persona matching (local female browser voice removed in favor of ElevenLabs API)
  if (persona === 'gwen') {
    return undefined;
  }
  const maleVoice = arabicVoices.find(
    (v) =>
      v.name.toLowerCase().includes('male') ||
      v.name.toLowerCase().includes('shakir') ||
      v.name.toLowerCase().includes('tarik') ||
      v.name.toLowerCase().includes('maged')
  );
  if (maleVoice) return maleVoice;

  return arabicVoices[0];
};

export const pickEnglishVoice = (
  voices: SpeechSynthesisVoice[],
  persona?: 'jarvis' | 'gwen'
): SpeechSynthesisVoice | undefined => {
  // Local female browser voice removed in favor of ElevenLabs API
  if (persona === 'gwen') {
    return undefined;
  }
  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (englishVoices.length === 0) return undefined;

  // Jarvis British / sophisticated male voice
    const britishMale = englishVoices.find(
      (v) =>
        (v.lang.toLowerCase().includes('gb') || v.lang.toLowerCase().includes('uk')) &&
        (v.name.toLowerCase().includes('male') ||
          v.name.toLowerCase().includes('george') ||
          v.name.toLowerCase().includes('oliver') ||
          v.name.toLowerCase().includes('daniel'))
    );
    if (britishMale) return britishMale;

    const naturalMale = englishVoices.find(
      (v) =>
        v.name.toLowerCase().includes('david') ||
        v.name.toLowerCase().includes('mark') ||
        v.name.toLowerCase().includes('guy') ||
        v.name.toLowerCase().includes('natural')
    );
    if (naturalMale) return naturalMale;

  return englishVoices[0];
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

