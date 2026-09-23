import { authedFetch } from "@/lib/api";
import {
  chooseOpenRouterTts,
  type TtsEngine,
  type VoicePersona,
} from "@/lib/chat-voice";
import { sanitizeTextForSpeech } from "@/lib/speechUtils";

/**
 * OpenRouter TTS for the dashboard chat voice loop: POSTs the backend
 * `/api/audio/speak` contract (`provider: "openrouter"` + model_id +
 * voice_id -> `{data_url}`) and plays the returned audio.
 *
 * The fast browser voice (`speakWithNabra`) stays the default engine and the
 * fallback whenever this path fails — a TTS outage must never drop a spoken
 * reply, only degrade it.
 *
 * The prefetch pipeline overlaps synthesis with playback: while sentence N
 * is playing, sentences N+1..N+MAX_PREFETCH are already being fetched from
 * the backend, eliminating the inter-sentence gap that causes stuttering.
 */

let activeAudio: HTMLAudioElement | null = null;
let activeSettle: ((played: boolean) => void) | null = null;

/**
 * Minimal silent WAV (44-byte header, zero samples): no audible output, but
 * a real unmuted media-element load through the audio pipeline.
 */
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAA";

let sharedUnlockContext: AudioContext | null = null;

/**
 * Unlock OpenRouter (HTMLAudioElement) playback inside a user gesture.
 *
 * `primeSpeechForGesture` in ChatVoiceControls only primed SpeechSynthesis,
 * so the first `<audio>` play — fired later from a network event outside any
 * gesture — was rejected by the autoplay policy (`NotAllowedError`) while
 * the browser voice worked fine. The Mic/Voice toggle IS a gesture: resume
 * the shared AudioContext and run one silent unmuted primer through a real
 * HTMLAudioElement here, so sticky activation covers later sentence playback.
 * Must be called synchronously inside the click handler. Safe to call
 * repeatedly; never touches the active sentence player.
 */
export function unlockOpenRouterAudioForGesture(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      if (!sharedUnlockContext || sharedUnlockContext.state === "closed") {
        sharedUnlockContext = new Ctor();
      }
      if (sharedUnlockContext.state === "suspended") {
        void sharedUnlockContext.resume().catch(() => {});
      }
    }
  } catch {
    // AudioContext unlock is best-effort; the element primer below is the path that matters.
  }
  try {
    if (typeof Audio === "undefined") return;
    const primer = new Audio(SILENT_WAV_DATA_URL);
    primer.muted = false;
    primer.volume = 0;
    primer.preload = "auto";
    const playing = primer.play();
    if (playing && typeof playing.catch === "function") {
      playing.catch(() => {});
    }
  } catch {
    // ignore — playback will fall back to the browser voice per sentence.
  }
}

/**
 * Stop the current data-URL playback and settle its pending promise
 * immediately as "not played". Pause alone would leave the playback promise
 * dangling until the wedge timer, stalling the speech queue after a
 * stop/cancel (e.g. a new message starting mid-sentence).
 */
export function stopOpenRouterAudio(): void {
  const audio = activeAudio;
  const settle = activeSettle;
  activeAudio = null;
  activeSettle = null;
  if (!audio) return;
  try {
    audio.pause();
  } catch {
    // ignore
  }
  settle?.(false);
}

/**
 * Play one data-URL audio clip. Resolves `true` only when playback actually
 * ran to completion (`onended`); `false` on construction failure, `onerror`,
 * `play()` rejection (e.g. the autoplay policy), stop/cancel, or the wedge
 * timeout when no sound was ever produced. The caller uses this to decide
 * whether to fall back — a silent failure must never count as speech.
 */
export function playAudioDataUrl(dataUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let audio: HTMLAudioElement;
    try {
      audio = new Audio(dataUrl);
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (played: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(wedgeGuard);
      if (activeAudio === audio) {
        activeAudio = null;
        activeSettle = null;
      }
      resolve(played);
    };
    activeAudio = audio;
    activeSettle = done;
    // Explicit output state: the gesture unlock primer runs at volume 0, and
    // a stale muted flag must never silence a real sentence.
    try {
      audio.preload = "auto";
      audio.muted = false;
      audio.volume = 1;
    } catch {
      // ignore — attribute assignment cannot fail playback.
    }
    audio.onended = () => done(true);
    audio.onerror = () => done(false);

    // Playback that neither ends nor errors must not wedge the speech queue.
    // Audio that started producing sound counts as delivered (falling back
    // would duplicate it); audio that never made a sound counts as failure.
    const wedgeGuard = setTimeout(() => {
      done(!audio.paused && audio.currentTime > 0);
    }, 120_000);

    try {
      const playing = audio.play();
      if (playing && typeof playing.catch === "function") {
        playing.catch(() => done(false));
      }
    } catch {
      done(false);
      return;
    }
  });
}

/**
 * Fetch synthesized audio for one spoken sentence. Resolves the `data_url`
 * on success, or `null` when the backend cannot synthesize (bad status,
 * malformed body, network error) — the caller then falls back to the
 * browser voice. `fallbackToFish` is true when Arabic text was rerouted
 * away from the English-only Flux model.
 */
export async function fetchOpenRouterSpeakUrl(
  text: string,
  engine: "flux" | "fish",
  persona: VoicePersona = "jarvis",
): Promise<{ dataUrl: string; fallbackToFish: boolean } | null> {
  const clean = sanitizeTextForSpeech(text);
  if (!clean) return null;
  const spec = chooseOpenRouterTts(clean, engine, persona);
  try {
    const res = await authedFetch("/api/audio/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: clean,
        persona,
        provider: "openrouter",
        model_id: spec.model_id,
        voice_id: spec.voice_id,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { data_url?: unknown } | null;
    const dataUrl = typeof data?.data_url === "string" ? data.data_url : "";
    if (!dataUrl.startsWith("data:audio")) return null;
    return { dataUrl, fallbackToFish: spec.fallbackToFish };
  } catch {
    return null;
  }
}

/**
 * Speak one sentence through the selected OpenRouter model. Returns
 * `spoke: false` when synthesis or playback failed so the caller can use
 * the browser voice; `fallbackToFish` reports an Arabic reroute from Flux.
 */
export async function speakViaOpenRouter(
  text: string,
  engine: "flux" | "fish",
  persona: VoicePersona = "jarvis",
): Promise<{ spoke: boolean; fallbackToFish: boolean }> {
  const fetched = await fetchOpenRouterSpeakUrl(text, engine, persona);
  if (!fetched) return { spoke: false, fallbackToFish: false };
  const played = await playAudioDataUrl(fetched.dataUrl);
  // Playback failure is NOT success: report it so the caller falls back to
  // the browser voice instead of silently dropping the spoken sentence.
  return { spoke: played, fallbackToFish: fetched.fallbackToFish };
}

// ---------------------------------------------------------------------------
// Prefetch pipeline: overlap synthesis with playback to eliminate gaps
// ---------------------------------------------------------------------------

/** Result of a prefetched sentence ready for playback. */
export interface PrefetchedSentence {
  text: string;
  fetched: Promise<{ dataUrl: string; fallbackToFish: boolean } | null>;
}

/**
 * Maximum number of sentences to prefetch ahead of the currently playing one.
 * Mirrors the Python backend's `_StreamerPlayback` semaphore (3 in flight).
 */
const MAX_PREFETCH = 3;

/**
 * Merge consecutive short sentences to reduce the number of network
 * round-trips for OpenRouter TTS. Browser SpeechSynthesis is instant
 * (<50ms) so small chunks help latency, but network TTS pays ~500ms-2s
 * per request — fewer, larger chunks eliminate gaps.
 *
 * Sentences shorter than `threshold` are merged with the next sentence
 * until the merged result exceeds `threshold` or the queue runs out.
 */
export function mergeSentencesForNetworkTts(
  sentences: string[],
  threshold = 80,
): string[] {
  if (sentences.length <= 1) return [...sentences];
  const merged: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (!buffer) {
      buffer = trimmed;
    } else {
      buffer = buffer + " " + trimmed;
    }
    if (buffer.length >= threshold) {
      merged.push(buffer);
      buffer = "";
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
}

/**
 * Prefetching speech pipeline for OpenRouter TTS. Eliminates inter-sentence
 * pauses by starting HTTP synthesis requests for upcoming sentences while
 * the current one is still playing.
 *
 * Usage: create a pipeline, enqueue sentences, then call `playNext()` in a
 * loop. Each call plays one sentence whose audio was prefetched during the
 * previous sentence's playback. Call `cancel()` on barge-in.
 */
export class TtsPrefetchPipeline {
  private engine: "flux" | "fish";
  private persona: VoicePersona;
  private queue: PrefetchedSentence[] = [];
  private cancelled = false;

  constructor(engine: "flux" | "fish", persona: VoicePersona = "jarvis") {
    this.engine = engine;
    this.persona = persona;
  }

  /** Add sentences to the pipeline, immediately starting prefetch for them. */
  enqueue(sentences: string[]): void {
    if (this.cancelled) return;
    for (const text of sentences) {
      if (!text.trim()) continue;
      // Limit in-flight fetches: only prefetch if we're within the lookahead.
      // Sentences beyond MAX_PREFETCH from the head will be fetched lazily
      // as earlier ones are consumed (in playNext).
      const inflight = this.queue.length;
      if (inflight < MAX_PREFETCH) {
        this.queue.push({ text, fetched: fetchOpenRouterSpeakUrl(text, this.engine, this.persona) });
      } else {
        this.queue.push({ text, fetched: _DEFERRED_SENTINEL });
      }
    }
  }

  /** True when there are sentences remaining to play. */
  hasNext(): boolean {
    return !this.cancelled && this.queue.length > 0;
  }

  /**
   * Play the next sentence. Returns the sentence text alongside the
   * playback result so the caller can fall back to a different engine
   * for sentences that failed synthesis.
   */
  async playNext(): Promise<{ text: string; spoke: boolean; fallbackToFish: boolean }> {
    if (this.cancelled || this.queue.length === 0) {
      return { text: "", spoke: false, fallbackToFish: false };
    }
    const entry = this.queue.shift()!;
    // Kick off deferred prefetches now that a slot opened.
    this._ensurePrefetch();

    const fetched = await entry.fetched;
    if (this.cancelled) return { text: entry.text, spoke: false, fallbackToFish: false };
    if (!fetched) return { text: entry.text, spoke: false, fallbackToFish: false };

    const played = await playAudioDataUrl(fetched.dataUrl);
    if (this.cancelled) return { text: entry.text, spoke: false, fallbackToFish: false };
    return { text: entry.text, spoke: played, fallbackToFish: fetched.fallbackToFish };
  }

  /** Return remaining queued sentence texts and clear the queue. */
  drainTexts(): string[] {
    const texts = this.queue.map((e) => e.text);
    this.queue = [];
    return texts;
  }

  /** Cancel all pending fetches (barge-in / mute / new message). */
  cancel(): void {
    this.cancelled = true;
    this.queue = [];
  }

  /**
   * Ensure the first MAX_PREFETCH entries in the queue have active fetches.
   * Called after consuming a sentence in playNext to fill the lookahead.
   */
  private _ensurePrefetch(): void {
    if (this.cancelled) return;
    for (let i = 0; i < this.queue.length && i < MAX_PREFETCH; i++) {
      if (this.queue[i].fetched === _DEFERRED_SENTINEL) {
        this.queue[i] = {
          text: this.queue[i].text,
          fetched: fetchOpenRouterSpeakUrl(this.queue[i].text, this.engine, this.persona),
        };
      }
    }
  }
}

/** Sentinel promise for entries whose fetch is deferred beyond MAX_PREFETCH. */
const _DEFERRED_SENTINEL: Promise<null> = Promise.resolve(null);

export type { TtsEngine, VoicePersona };
