import { authedFetch } from "@/lib/api";
import {
  resolveServerTranscript,
  type ServerTranscriptionResponse,
} from "@/lib/chat-voice";

/**
 * Server-side STT for the dashboard chat voice loop ("STT: Server" mode).
 *
 * The browser Web Speech engine transcribes Arabic poorly when the session
 * language mismatches, so this mode records the utterance with MediaRecorder
 * while browser recognition still drives endpointing/interim display, then
 * swaps the submitted text for the backend's transcription provider via
 * `POST /api/audio/transcribe` (`{data_url, mime_type}` -> `{ok, transcript}`).
 * Every failure path falls back to the browser draft so the live turn loop is
 * never harmed or dropped.
 */

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Transcribe a captured utterance on the backend. Resolves with the text to
 * submit: the server transcript when present, otherwise the browser draft
 * (failed request, empty transcript, unreadable recording).
 */
export async function transcribeAudioBlob(
  blob: Blob,
  browserDraft: string,
): Promise<string> {
  if (blob.size <= 0) return resolveServerTranscript(null, browserDraft);
  const dataUrl = await blobToDataUrl(blob);
  const res = await authedFetch("/api/audio/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl, mime_type: blob.type || "audio/webm" }),
  });
  const payload = res.ok
    ? ((await res.json().catch(() => null)) as ServerTranscriptionResponse | null)
    : null;
  return resolveServerTranscript(payload, browserDraft);
}
