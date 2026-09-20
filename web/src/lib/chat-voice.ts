export interface VoiceRecognitionResult {
  isFinal: boolean;
  0?: { transcript?: string };
}

export interface VoiceRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<VoiceRecognitionResult>;
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
