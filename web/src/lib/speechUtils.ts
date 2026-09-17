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
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | undefined => {
  return (
    voices.find((v) => v.lang.toLowerCase().includes('ar-eg')) ||
    voices.find((v) => v.lang.toLowerCase().startsWith('ar')) ||
    undefined
  );
};
