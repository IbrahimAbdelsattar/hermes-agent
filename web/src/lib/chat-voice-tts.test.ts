// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authedFetch } from "@/lib/api";
import { OPENROUTER_FEMALE_FISH_VOICE, OPENROUTER_MALE_FISH_VOICE, OPENROUTER_TTS_SPECS } from "./chat-voice";
import { fetchOpenRouterSpeakUrl, speakViaOpenRouter, stopOpenRouterAudio, unlockOpenRouterAudioForGesture } from "./chat-voice-tts";

vi.mock("@/lib/api", () => ({ authedFetch: vi.fn() }));
const mockAuthedFetch = vi.mocked(authedFetch);

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Behavior double for HTMLAudioElement: playback succeeds/fails/is stopped. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  currentTime = 0;
  private rejectPlay: ((reason?: unknown) => void) | null = null;
  readonly src: string;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.paused = false;
    return new Promise<void>((_resolve, reject) => {
      this.rejectPlay = reject;
    });
  }

  pause(): void {
    this.paused = true;
  }

  /** Simulate play() rejection (e.g. the autoplay policy) plus onerror. */
  rejectPlayback(): void {
    this.paused = true;
    this.rejectPlay?.(new DOMException("play() blocked", "NotAllowedError"));
    this.onerror?.();
  }

  /** Simulate audio running to completion. */
  finishPlayback(): void {
    this.paused = true;
    this.currentTime = 4;
    this.onended?.();
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("fetchOpenRouterSpeakUrl", () => {
  beforeEach(() => {
    mockAuthedFetch.mockReset();
  });

  it("posts the OpenRouter contract and returns the audio data URL (Flux)", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
    );
    await expect(fetchOpenRouterSpeakUrl("Hello there", "flux")).resolves.toEqual({
      dataUrl: "data:audio/mpeg;base64,AAA",
      fallbackToFish: false,
    });

    const [url, init] = mockAuthedFetch.mock.calls[0];
    expect(url).toBe("/api/audio/speak");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      text: "Hello there",
      provider: "openrouter",
      model_id: OPENROUTER_TTS_SPECS.flux.model_id,
      voice_id: "flux-orion-en",
      persona: "jarvis",
    });
  });

  it("posts female Flux voice when Gwen persona is selected", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
    );
    await expect(fetchOpenRouterSpeakUrl("Hello there", "flux", "gwen")).resolves.toEqual({
      dataUrl: "data:audio/mpeg;base64,AAA",
      fallbackToFish: false,
    });

    const [url, init] = mockAuthedFetch.mock.calls[0];
    expect(url).toBe("/api/audio/speak");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      text: "Hello there",
      provider: "openrouter",
      model_id: OPENROUTER_TTS_SPECS.flux.model_id,
      voice_id: "flux-alexis-en",
      persona: "gwen",
    });
  });

  it("uses the Fish contract when the Fish engine is selected", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/wav;base64,AAA" }),
    );
    await expect(fetchOpenRouterSpeakUrl("صباح الخير", "fish", "jarvis")).resolves.toMatchObject({
      fallbackToFish: false,
    });
    const bodyJarvis = JSON.parse(String((mockAuthedFetch.mock.calls[0][1] as RequestInit).body));
    expect(bodyJarvis).toMatchObject({
      provider: "openrouter",
      model_id: OPENROUTER_TTS_SPECS.fish.model_id,
      voice_id: OPENROUTER_MALE_FISH_VOICE,
    });

    mockAuthedFetch.mockClear();
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/wav;base64,AAA" }),
    );
    await expect(fetchOpenRouterSpeakUrl("صباح الخير", "fish", "gwen")).resolves.toMatchObject({
      fallbackToFish: false,
    });
    const bodyGwen = JSON.parse(String((mockAuthedFetch.mock.calls[0][1] as RequestInit).body));
    expect(bodyGwen).toMatchObject({
      provider: "openrouter",
      model_id: OPENROUTER_TTS_SPECS.fish.model_id,
      voice_id: OPENROUTER_FEMALE_FISH_VOICE,
    });
  });

  it("reroutes Arabic text to Fish even under the Flux engine (Flux is English-only)", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
    );
    const result = await fetchOpenRouterSpeakUrl("صباح الخير يا هيرميس", "flux", "jarvis");
    expect(result?.fallbackToFish).toBe(true);
    const body = JSON.parse(String((mockAuthedFetch.mock.calls[0][1] as RequestInit).body));
    expect(body.model_id).toBe(OPENROUTER_TTS_SPECS.fish.model_id);
    expect(body.voice_id).toBe(OPENROUTER_MALE_FISH_VOICE);
  });

  it("returns null on a failed synthesis so the caller falls back to the browser voice", async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({ detail: "no provider" }, false));
    await expect(fetchOpenRouterSpeakUrl("Hello", "flux")).resolves.toBeNull();
  });

  it("returns null when the response carries no audio data URL", async () => {
    mockAuthedFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(fetchOpenRouterSpeakUrl("Hello", "fish")).resolves.toBeNull();
  });

  it("returns null when the request itself throws", async () => {
    mockAuthedFetch.mockRejectedValue(new Error("network down"));
    await expect(fetchOpenRouterSpeakUrl("Hello", "flux")).resolves.toBeNull();
  });
});

describe("speakViaOpenRouter playback outcomes", () => {
  beforeEach(() => {
    mockAuthedFetch.mockReset();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports spoke:false when play() is rejected — a silent failure is not speech", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
    );
    const pending = speakViaOpenRouter("Hello there", "flux");
    await flushMicrotasks();
    const audio = FakeAudio.instances.at(-1);
    expect(audio).toBeInstanceOf(FakeAudio);
    audio!.rejectPlayback();
    await expect(pending).resolves.toEqual({ spoke: false, fallbackToFish: false });
  });

  it("reports spoke:false on a media error event", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
    );
    const pending = speakViaOpenRouter("Hello there", "flux");
    await flushMicrotasks();
    const audio = FakeAudio.instances.at(-1)!;
    // play() resolved fine but the decode failed mid-stream.
    audio.onerror?.();
    await expect(pending).resolves.toMatchObject({ spoke: false });
  });

  it("reports spoke:true only when playback actually ends", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/wav;base64,AAA" }),
    );
    const pending = speakViaOpenRouter("Hello there", "fish");
    await flushMicrotasks();
    FakeAudio.instances.at(-1)!.finishPlayback();
    await expect(pending).resolves.toEqual({ spoke: true, fallbackToFish: false });
  });

  it("stop settles pending playback immediately as not-played, without wedging", async () => {
    mockAuthedFetch.mockResolvedValue(
      jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
    );
    const pending = speakViaOpenRouter("Hello there", "flux");
    await flushMicrotasks();
    const audio = FakeAudio.instances.at(-1)!;
    stopOpenRouterAudio();
    expect(audio.paused).toBe(true);
    await expect(pending).resolves.toEqual({ spoke: false, fallbackToFish: false });
    // Stopping with nothing active stays a safe no-op.
    expect(() => stopOpenRouterAudio()).not.toThrow();
  });

  it("wedge guard releases audio that never produces sound instead of hanging the queue", async () => {
    vi.useFakeTimers();
    try {
      mockAuthedFetch.mockResolvedValue(
        jsonResponse({ ok: true, data_url: "data:audio/mpeg;base64,AAA" }),
      );
      const pending = speakViaOpenRouter("Hello there", "flux");
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(pending).resolves.toMatchObject({ spoke: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("unlockOpenRouterAudioForGesture", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("primes a silent audio element in the gesture without hijacking the sentence player", () => {
    unlockOpenRouterAudioForGesture();
    const primer = FakeAudio.instances.at(-1);
    expect(primer?.src.startsWith("data:audio")).toBe(true);
    // play() was attempted synchronously (the gesture's transient activation).
    expect(primer?.paused).toBe(false);
    // The primer is not tracked as sentence audio: stopping stays a safe no-op.
    expect(() => stopOpenRouterAudio()).not.toThrow();
  });
});
