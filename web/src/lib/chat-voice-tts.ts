import { authedFetch } from "@/lib/api";
import {
  chooseOpenRouterTts,
  type TtsEngine,
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
 */

let activeAudio: HTMLAudioElement | null = null;
let activeSettle: ((played: boolean) => void) | null = null;

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
    let wedgeGuard: ReturnType<typeof setTimeout> | undefined;
    const done = (played: boolean) => {
      if (settled) return;
      settled = true;
      if (wedgeGuard !== undefined) clearTimeout(wedgeGuard);
      if (activeAudio === audio) {
        activeAudio = null;
        activeSettle = null;
      }
      resolve(played);
    };
    activeAudio = audio;
    activeSettle = done;
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    try {
      const playing = audio.play();
      if (playing && typeof playing.catch === "function") {
        playing.catch(() => done(false));
      }
    } catch {
      done(false);
      return;
    }
    // Playback that neither ends nor errors must not wedge the speech queue.
    // Audio that started producing sound counts as delivered (falling back
    // would duplicate it); audio that never made a sound counts as failure.
    wedgeGuard = setTimeout(() => {
      done(!audio.paused && audio.currentTime > 0);
    }, 120_000);
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
): Promise<{ dataUrl: string; fallbackToFish: boolean } | null> {
  const clean = sanitizeTextForSpeech(text);
  if (!clean) return null;
  const spec = chooseOpenRouterTts(clean, engine);
  try {
    const res = await authedFetch("/api/audio/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: clean,
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
): Promise<{ spoke: boolean; fallbackToFish: boolean }> {
  const fetched = await fetchOpenRouterSpeakUrl(text, engine);
  if (!fetched) return { spoke: false, fallbackToFish: false };
  const played = await playAudioDataUrl(fetched.dataUrl);
  // Playback failure is NOT success: report it so the caller falls back to
  // the browser voice instead of silently dropping the spoken sentence.
  return { spoke: played, fallbackToFish: fetched.fallbackToFish };
}

export type { TtsEngine };
