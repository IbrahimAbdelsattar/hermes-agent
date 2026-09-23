export type VoiceLanguageMode = "en" | "ar" | "auto";

/** Recognition BCP-47 tags the Web Speech session can be started with. */
export type RecognitionLang = "en-US" | "ar-EG";

/** Where the submitted transcript comes from. */
export type SttMode = "browser" | "server";

/** Spoken-reply engine: fast browser voice or an OpenRouter-hosted TTS model. */
export type TtsEngine = "browser" | "flux" | "fish";

export const STT_MODE_LABELS: Record<SttMode, string> = {
  browser: "Browser",
  server: "Server",
};

export const TTS_ENGINE_LABELS: Record<TtsEngine, string> = {
  browser: "Browser",
  flux: "Flux EN",
  fish: "Fish AR/EN",
};

export interface VoiceRecognitionResult {
  isFinal: boolean;
  0?: { transcript?: string };
}

export interface VoiceRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<VoiceRecognitionResult>;
}

export const CONTINUATION_WORDS_AR = [
  "و", "او", "أو", "ثم", "ف", "علشان", "عشان", "بس", "لكن", "يعني",
  "مع", "في", "من", "عن", "على", "الي", "إلى", "إن", "ان", "انك", "لو",
  "لما", "حتى", "قبل", "بعد", "بدل", "زي", "معلش", "طيب", "يا", "ما"
] as const;

export const CONTINUATION_WORDS_EN = [
  "and", "or", "but", "because", "cause", "so", "then", "if", "when",
  "while", "where", "like", "with", "that", "which", "who", "also",
  "actually", "well", "um", "uh", "er", "ah", "the", "a", "an", "to"
] as const;

export function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function containsLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

export function detectDominantScript(text: string): "ar" | "en" | "neutral" {
  let arCount = 0;
  let enCount = 0;
  for (const char of text) {
    if (/[\u0600-\u06FF]/.test(char)) arCount++;
    else if (/[A-Za-z]/.test(char)) enCount++;
  }
  if (arCount > 0 && arCount >= enCount) return "ar";
  if (enCount > 0 && enCount > arCount) return "en";
  return "neutral";
}

/**
 * Endpointing delays (ms) for the hands-free pause timer. The previous
 * 1400ms base + 400ms continuation bonus kept an ~2s avoidable wait after
 * every utterance; these shorter rungs submit terminally-punctuated final
 * results fast while still holding the turn open for mid-thought pauses.
 */
export const VOICE_ENDPOINT_FINAL_PUNCT_MS = 650;
export const VOICE_ENDPOINT_FINAL_MS = 850;
export const VOICE_ENDPOINT_INTERIM_MS = 1100;
export const VOICE_ENDPOINT_CONTINUATION_BONUS_MS = 400;
export const VOICE_ENDPOINT_MAX_MS = 1800;

export interface VoiceEndpointOptions {
  /** Explicit base delay; defaults to the final/interim rung below. */
  baseMs?: number;
  /** True when the latest recognition update contained final text. */
  isFinal?: boolean;
}

export function getVoicePauseTimeoutMs(
  textDraft: string,
  baseOrOptions: number | VoiceEndpointOptions = {},
): number {
  const options: VoiceEndpointOptions =
    typeof baseOrOptions === "number" ? { baseMs: baseOrOptions } : baseOrOptions;
  const isFinal = options.isFinal ?? false;
  // Interim text may still be revised by the engine, so it waits longer
  // than a final result for the same draft.
  const baseMs = options.baseMs ?? (isFinal ? VOICE_ENDPOINT_FINAL_MS : VOICE_ENDPOINT_INTERIM_MS);

  const trimmed = textDraft.trim();
  if (!trimmed) return Math.min(VOICE_ENDPOINT_MAX_MS, baseMs);

  // A final result ending in terminal punctuation is a complete thought:
  // submit on the fast rung instead of waiting out the full base delay.
  if (isFinal && /[.?!…。！？؟]$/.test(trimmed)) {
    return Math.min(baseMs, VOICE_ENDPOINT_FINAL_PUNCT_MS);
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return Math.min(VOICE_ENDPOINT_MAX_MS, baseMs);

  const lastWord = words[words.length - 1].toLowerCase().replace(/[،,.:;!؟?]/g, "");
  const isContinuation =
    (CONTINUATION_WORDS_AR as readonly string[]).includes(lastWord) ||
    (CONTINUATION_WORDS_EN as readonly string[]).includes(lastWord) ||
    lastWord.startsWith("و") ||
    lastWord.startsWith("ف");

  const dynamicBonus = isContinuation ? VOICE_ENDPOINT_CONTINUATION_BONUS_MS : 0;
  return Math.min(VOICE_ENDPOINT_MAX_MS, baseMs + dynamicBonus);
}

export function normalizeVoicePrompt(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export function recognitionTranscript(event: VoiceRecognitionEvent): {
  final: string;
  interim: string;
} {
  const final: string[] = [];
  const interim: string[] = [];
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const text = String(result?.[0]?.transcript ?? "").trim();
    if (!text) continue;
    (result.isFinal ? final : interim).push(text);
  }
  return { final: final.join(" "), interim: interim.join(" ") };
}

interface VoicePromptSocket {
  readyState: number;
  send(data: string): void;
}

export function sendVoicePrompt(
  socket: VoicePromptSocket | null,
  rawText: string,
  sendReturn: (callback: () => void) => void,
  isCurrent: () => boolean,
): boolean {
  const text = normalizeVoicePrompt(rawText);
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(text);
  sendReturn(() => {
    if (isCurrent() && socket.readyState === WebSocket.OPEN) socket.send("\r");
  });
  return true;
}

/**
 * Auto-language state machine for the recognition session language.
 *
 * Web Speech cannot switch `lang` mid-session, and an en-US engine fed
 * Arabic returns *Latinized* gibberish whose dominant script is Latin —
 * script detection alone can therefore never recover Arabic once the session
 * started in English. Auto mode treats each recognition session as a probe:
 * commit to the detected script when one appears, and alternate the probe
 * language when a session ends without producing any script evidence.
 */
export function nextAutoRecognitionLang(
  current: RecognitionLang,
  outcome: "ar" | "en" | "neutral",
): RecognitionLang {
  if (outcome === "ar") return "ar-EG";
  if (outcome === "en") return "en-US";
  return current === "en-US" ? "ar-EG" : "en-US";
}

/**
 * Backend `/api/audio/speak` contract for the OpenRouter TTS engines:
 * `{text, provider: "openrouter", model_id, voice_id}` → `{data_url}`.
 * The OpenRouter catalog lists Flux as English-only (voice `flux-alexis-en`);
 * Fish is multilingual and enumerates no voice list — the backend's
 * documented Fish example voice is used.
 */
export interface OpenRouterTtsSpec {
  model_id: string;
  voice_id: string;
}

export type VoicePersona = "jarvis" | "gwen";

export const VOICE_PERSONA_STORAGE_KEY = "hermes_chat_voice_persona";

export const VOICE_PERSONA_LABELS: Record<VoicePersona, string> = {
  jarvis: "Male (Jarvis)",
  gwen: "Female (Gwen)",
};

export const OPENROUTER_MALE_FLUX_VOICE = "flux-orion-en";
export const OPENROUTER_FEMALE_FLUX_VOICE = "flux-alexis-en";

export const OPENROUTER_TTS_SPECS: Record<"flux" | "fish", OpenRouterTtsSpec> = {
  flux: { model_id: "deepgram/flux-tts:free", voice_id: OPENROUTER_FEMALE_FLUX_VOICE },
  fish: {
    model_id: "fish-audio/s2.1-pro-free:free",
    voice_id: "b347db033a6549378b48d00acb0d06cd",
  },
};

export interface OpenRouterTtsRoute extends OpenRouterTtsSpec {
  /** True when Arabic text forced a reroute from the English-only Flux model. */
  fallbackToFish: boolean;
}

/**
 * Resolve which OpenRouter model/voice a spoken sentence must use. Arabic
 * text is never sent to Flux (English-only per the OpenRouter catalog); it
 * reroutes to the multilingual Fish model instead.
 *
 * For Flux, the voice is chosen to match the selected persona:
 * - "jarvis" (Male) -> flux-orion-en
 * - "gwen" (Female) -> flux-alexis-en
 */
export function chooseOpenRouterTts(
  text: string,
  engine: "flux" | "fish",
  persona: VoicePersona = "gwen",
): OpenRouterTtsRoute {
  if (engine === "flux" && (containsArabic(text) || detectDominantScript(text) === "ar")) {
    return { ...OPENROUTER_TTS_SPECS.fish, fallbackToFish: true };
  }
  const spec = { ...OPENROUTER_TTS_SPECS[engine] };
  if (engine === "flux") {
    spec.voice_id = persona === "jarvis" ? OPENROUTER_MALE_FLUX_VOICE : OPENROUTER_FEMALE_FLUX_VOICE;
  }
  return { ...spec, fallbackToFish: false };
}

export interface ServerTranscriptionResponse {
  ok?: boolean;
  transcript?: string;
}

/**
 * Decide the text to submit after a server transcription attempt. The turn
 * must never be dropped because the accurate path failed or heard silence:
 * a failed or empty server transcript falls back to the browser's
 * provisional draft.
 */
export function resolveServerTranscript(
  response: ServerTranscriptionResponse | null,
  browserDraft: string,
): string {
  if (response?.ok) {
    const transcript = (response.transcript ?? "").trim();
    if (transcript) return transcript;
  }
  return normalizeVoicePrompt(browserDraft);
}

