// @vitest-environment jsdom
// Behavior tests for the silent-reply failure class in speakWithNabra: a
// browser SpeechSynthesisUtterance that ERRORS (not a deliberate cancel) must
// fall through to the backend /api/audio/speak playback, while a deliberate
// cancellation must not trigger a duplicate fallback voice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ authedFetch: vi.fn() }));
const ttsMocks = vi.hoisted(() => ({
  playAudioDataUrl: vi.fn(),
  stopOpenRouterAudio: vi.fn(),
}));
const voiceMocks = vi.hoisted(() => ({
  getVoicesSafely: vi.fn(),
  pickArabicVoice: vi.fn(),
  pickEnglishVoice: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ authedFetch: apiMocks.authedFetch }));
vi.mock("@/lib/chat-voice-tts", () => ({
  playAudioDataUrl: ttsMocks.playAudioDataUrl,
  stopOpenRouterAudio: ttsMocks.stopOpenRouterAudio,
}));
vi.mock("@/lib/speechUtils", () => ({
  getVoicesSafely: voiceMocks.getVoicesSafely,
  pickArabicVoice: voiceMocks.pickArabicVoice,
  pickEnglishVoice: voiceMocks.pickEnglishVoice,
}));

import { speakWithNabra, stopNabraAudio } from "./jarvisSpeechUtils";

class FakeUtterance {
  static instances: FakeUtterance[] = [];
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
    FakeUtterance.instances.push(this);
  }
}

const BACKEND_AUDIO = "data:audio/mpeg;base64,QQ==";
const fakeVoice = { name: "Test Voice", lang: "en-US" } as SpeechSynthesisVoice;
let activeUtterance: FakeUtterance | null = null;

function installFakeSpeechSynthesis(): void {
  const speechSynthesis = {
    paused: false,
    speaking: false,
    pending: false,
    getVoices: () => [] as SpeechSynthesisVoice[],
    speak: (utter: FakeUtterance) => {
      speechSynthesis.speaking = true;
      activeUtterance = utter;
    },
    // Chrome reports a deliberate stop through onerror ("canceled"), not onend.
    cancel: () => {
      speechSynthesis.speaking = false;
      const utter = activeUtterance;
      activeUtterance = null;
      utter?.onerror?.({ error: "canceled" });
    },
    resume: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: speechSynthesis,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: FakeUtterance,
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("speakWithNabra fallback lifecycle", () => {
  beforeEach(() => {
    FakeUtterance.instances = [];
    activeUtterance = null;
    installFakeSpeechSynthesis();
    apiMocks.authedFetch.mockReset();
    apiMocks.authedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data_url: BACKEND_AUDIO }),
    });
    ttsMocks.playAudioDataUrl.mockReset();
    ttsMocks.playAudioDataUrl.mockResolvedValue(true);
    ttsMocks.stopOpenRouterAudio.mockReset();
    voiceMocks.getVoicesSafely.mockReset();
    voiceMocks.getVoicesSafely.mockResolvedValue([fakeVoice]);
    voiceMocks.pickEnglishVoice.mockReset();
    voiceMocks.pickEnglishVoice.mockReturnValue(fakeVoice);
    voiceMocks.pickArabicVoice.mockReset();
    voiceMocks.pickArabicVoice.mockReturnValue(fakeVoice);
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  });

  it("falls back to the backend /api/audio/speak when the browser engine errors", async () => {
    const pending = speakWithNabra("All systems nominal.", "jarvis");
    await flushMicrotasks();
    const utter = FakeUtterance.instances.at(-1);
    expect(utter?.text).toContain("All systems nominal.");

    // A real engine failure (NOT a deliberate cancel)...
    utter?.onerror?.({ error: "synthesis-failed" });
    await pending;

    // ...must reach the Hermes audio backend and play its audio.
    expect(apiMocks.authedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiMocks.authedFetch.mock.calls[0];
    expect(url).toBe("/api/audio/speak");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.text).toContain("All systems nominal.");
    expect(body.persona).toBe("jarvis");
    expect(body.provider).toBe("edge");
    expect(ttsMocks.playAudioDataUrl).toHaveBeenCalledWith(BACKEND_AUDIO);
  });

  it("does not trigger the backend fallback after a deliberate cancellation", async () => {
    const pending = speakWithNabra("All systems nominal.", "jarvis");
    await flushMicrotasks();
    expect(FakeUtterance.instances).toHaveLength(1);

    // The same stop path the mute toggle / new-message handler uses.
    stopNabraAudio();
    await pending;

    expect(apiMocks.authedFetch).not.toHaveBeenCalled();
    expect(ttsMocks.playAudioDataUrl).not.toHaveBeenCalled();
  });
});