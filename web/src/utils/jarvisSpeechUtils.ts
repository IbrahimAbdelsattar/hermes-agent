import { authedFetch } from "@/lib/api";
import { playAudioDataUrl, stopOpenRouterAudio } from "@/lib/chat-voice-tts";
import { getVoicesSafely, pickArabicVoice, pickEnglishVoice } from "@/lib/speechUtils";

export const sanitizeTextForSpeech = (text: string): string => {
  if (!text) return '';

  return text
    // Replace markdown bullet items (* item, - item, + item) with clean speech phrasing
    .replace(/^[\s]*[*•\-+]\s+/gm, 'Item: ')
    // Replace inline bold/italic markdown (*word*, **word**, ***word***) keeping the word intact
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // Replace underscore bold/italic (_word_, __word__) keeping the word intact
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Strip markdown header symbols (### Header)
    .replace(/^#{1,6}\s+/gm, '')
    // Replace inline backticks (`code`) keeping content
    .replace(/`([^`]+)`/g, '$1')
    // Convert multiple hyphens (--) into a natural comma pause
    .replace(/--+/g, ', ')
    // Clean remaining isolated asterisks or hashes that might confuse speech synthesis
    .replace(/[*#]+/g, '')
    // Normalize multiple spaces into single space
    .replace(/\s+/g, ' ')
    .trim();
};

export const formatDisplayContentWithPunctuation = (text: string): string => {
  if (!text) return '';

  return text
    // Strip markdown headers (### Header) keeping the heading text
    .replace(/^#{1,6}\s+/gm, '')
    // Convert markdown bullets (* item, - item, + item) to clean bullets
    .replace(/^[\s]*[•*\-+]\s+/gm, '• ')
    // Strip bold/italic markers (**word**, *word*, ***word***) keeping the word
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // Strip underscore emphasis (_word_, __word__) keeping the word
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
    // Strip inline backticks (`code`) keeping content
    .replace(/`([^`]+)`/g, '$1')
    // Strip markdown links [text](url) keeping the display text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Strip remaining isolated asterisks, hashes, tildes that are not punctuation
    .replace(/[*#~]+/g, '')
    // Normalize runs of whitespace but preserve single newlines for readable structure
    .replace(/[ \t]+/g, ' ')
    // Normalize 3+ blank lines down to a single blank line
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Outcome of one browser SpeechSynthesis attempt.
 * - "ended": audio actually played through (or was still audibly speaking when
 *   the wedge guard fired) — the caller is done.
 * - "canceled": the synthesis was stopped deliberately (stopNabraAudio /
 *   speechSynthesis.cancel) — the caller must NOT fall back, or the stop
 *   would be followed by a duplicate backend voice.
 * - "failed": the engine errored, was denied (autoplay policy), or produced
 *   no sound — the caller must fall back to the next tier.
 */
type BrowserSpeechOutcome = "ended" | "canceled" | "failed";

const speakWithBrowserVoice = (
  clean: string,
  isAr: boolean,
  voice: SpeechSynthesisVoice | null | undefined,
  timeoutMs: number,
): Promise<BrowserSpeechOutcome> => {
  return new Promise<BrowserSpeechOutcome>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve("failed");
      return;
    }
    let settled = false;
    let wedgeGuard: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: BrowserSpeechOutcome) => {
      if (settled) return;
      settled = true;
      if (wedgeGuard !== undefined) clearTimeout(wedgeGuard);
      resolve(outcome);
    };
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = isAr ? "ar-EG" : "en-US";
    utter.rate = 1.05;
    utter.pitch = 0.95;
    if (voice) utter.voice = voice;
    utter.onend = () => finish("ended");
    utter.onerror = (event) => {
      const error = (event as SpeechSynthesisErrorEvent)?.error;
      finish(error === "canceled" || error === "interrupted" ? "canceled" : "failed");
    };
    if (window.speechSynthesis.paused) {
      try {
        window.speechSynthesis.resume();
      } catch {}
    }
    window.speechSynthesis.speak(utter);
    // Wedge guard: an engine that never fires onend/onerror must not hang the
    // speech queue. Still speaking counts as delivered; silence as failure.
    wedgeGuard = setTimeout(() => {
      finish(window.speechSynthesis.speaking || window.speechSynthesis.pending ? "ended" : "failed");
    }, timeoutMs);
  });
};

export const stopNabraAudio = (): void => {
  // The backend tier plays data-URL audio through the shared player, so stop
  // both surfaces (the shared player also settles its pending promise).
  stopOpenRouterAudio();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
};

export const speakWithNabra = async (
  text: string,
  persona: 'jarvis' | 'gwen' = 'jarvis',
  cancelExisting = true
): Promise<void> => {
  const clean = sanitizeTextForSpeech(text);
  if (!clean || typeof window === 'undefined') return;
  if (cancelExisting) {
    stopNabraAudio();
  }

  const isAr = /[\u0600-\u06FF]/.test(clean);

  // Fast path for Jarvis: Browser Web SpeechSynthesis API gives instant (<50ms) natural speech.
  // A failed attempt must fall through to the backend — a silent browser
  // engine (no voices, autoplay denial, synthesis error) must never swallow
  // the spoken reply.
  if (persona === 'jarvis' && 'speechSynthesis' in window) {
    try {
      const voices = await getVoicesSafely();
      // No voices at all means the browser engine cannot speak; skip
      // straight to the backend instead of emitting silence.
      if (voices.length > 0) {
        const voice = isAr
          ? pickArabicVoice(voices, 'jarvis')
          : pickEnglishVoice(voices, 'jarvis');
        const outcome = await speakWithBrowserVoice(clean, isAr, voice, 25000);
        if (outcome === 'ended') return;
        if (outcome === 'canceled') return;
        // "failed": fall through to the Hermes audio backend below.
      }
    } catch (e) {
      console.warn('Browser speech instant path notice:', e);
    }
  }

  // Tier 2: Try Hermes Audio backend (/api/audio/speak)
  try {
    const res = await authedFetch('/api/audio/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        persona,
        provider: persona === 'gwen' ? 'elevenlabs' : 'edge',
        voice_id: persona === 'gwen' ? 'EXAVITQu4vr4xnSDxMaL' : (isAr ? 'ar-EG-ShakirNeural' : 'en-US-GuyNeural'),
        model_id: persona === 'gwen' ? 'eleven_multilingual_v2' : undefined,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const dataUrl = typeof data?.data_url === 'string' ? data.data_url : '';
      if (dataUrl.startsWith('data:audio')) {
        const played = await playAudioDataUrl(dataUrl);
        if (played) return;
        // Playback failed (autoplay rejection, decode error): the final
        // browser attempt below is the last resort.
      }
    }
  } catch (err) {
    console.warn('Backend audio synthesis unavailable:', err);
  }

  // Tier 3: Browser fallback if backend was unavailable
  if ('speechSynthesis' in window) {
    try {
      const voices = await getVoicesSafely();
      const voice = isAr
        ? pickArabicVoice(voices, persona)
        : pickEnglishVoice(voices, persona);
      await speakWithBrowserVoice(clean, isAr, voice, 20000);
    } catch {}
  }
};
