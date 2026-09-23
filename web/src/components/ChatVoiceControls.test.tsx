// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatVoiceControls,
} from "./ChatVoiceControls";
import { normalizeVoicePrompt, recognitionTranscript, sendVoicePrompt } from "@/lib/chat-voice";

const speechMocks = vi.hoisted(() => ({
  speak: vi.fn(async () => undefined),
  stop: vi.fn(),
}));

const feedMocks = vi.hoisted(() => {
  class FakeEventsFeed {
    static instances: FakeEventsFeed[] = [];
    handlers = new Map<string, Set<(event: { type: string; payload: Record<string, unknown> }) => void>>();
    closeHandlers = new Set<(code?: number) => void>();
    stateHandlers = new Set<(state: string) => void>();
    lastCloseCode: number | null | undefined = null;

    constructor() {
      FakeEventsFeed.instances.push(this);
    }

    async connect() {
      for (const handler of this.stateHandlers) handler("open");
    }

    close() {}

    on(type: string, handler: (event: { type: string; payload: Record<string, unknown> }) => void) {
      const handlers = this.handlers.get(type) ?? new Set();
      handlers.add(handler);
      this.handlers.set(type, handlers);
      return () => handlers.delete(handler);
    }

    onClose(handler: (code?: number) => void) {
      this.closeHandlers.add(handler);
      return () => this.closeHandlers.delete(handler);
    }

    onState(handler: (state: string) => void) {
      this.stateHandlers.add(handler);
      return () => this.stateHandlers.delete(handler);
    }

    emit(type: string, payload: Record<string, unknown> = {}) {
      for (const handler of this.handlers.get(type) ?? []) {
        handler({ type, payload });
      }
    }
  }
  return { FakeEventsFeed };
});

const ttsMocks = vi.hoisted(() => {
  const playNextFn = vi.fn<(text: string, engine: "flux" | "fish") => Promise<{ spoke: boolean; fallbackToFish: boolean }>>();
  const stopOpenRouterAudio = vi.fn();
  const unlockOpenRouterAudioForGesture = vi.fn();

  /** Mock pipeline: enqueues sentences and delegates each playNext to playNextFn. */
  class MockTtsPrefetchPipeline {
    private engine: "flux" | "fish";
    private queue: string[] = [];
    private cancelled = false;
    constructor(engine: "flux" | "fish") { this.engine = engine; }
    enqueue(sentences: string[]) {
      if (this.cancelled) return;
      for (const s of sentences) if (s.trim()) this.queue.push(s);
    }
    hasNext() { return !this.cancelled && this.queue.length > 0; }
    async playNext(): Promise<{ text: string; spoke: boolean; fallbackToFish: boolean }> {
      if (this.cancelled || this.queue.length === 0) return { text: "", spoke: false, fallbackToFish: false };
      const text = this.queue.shift()!;
      if (this.cancelled) return { text, spoke: false, fallbackToFish: false };
      const result = await playNextFn(text, this.engine);
      return { text, ...result };
    }
    drainTexts(): string[] {
      const texts = [...this.queue];
      this.queue = [];
      return texts;
    }
    cancel() { this.cancelled = true; this.queue = []; }
  }

  return { playNextFn, stopOpenRouterAudio, unlockOpenRouterAudioForGesture, MockTtsPrefetchPipeline };
});

vi.mock("@/lib/eventsFeedClient", () => ({ EventsFeedClient: feedMocks.FakeEventsFeed }));
vi.mock("@/lib/chat-voice-tts", () => ({
  stopOpenRouterAudio: ttsMocks.stopOpenRouterAudio,
  unlockOpenRouterAudioForGesture: ttsMocks.unlockOpenRouterAudioForGesture,
  TtsPrefetchPipeline: ttsMocks.MockTtsPrefetchPipeline,
  mergeSentencesForNetworkTts: (sentences: string[]) => {
    // Pass-through: tests care about individual sentences, not merging
    return sentences.filter((s: string) => s.trim());
  },
}));
vi.mock("@/utils/jarvisSpeechUtils", () => ({
  speakWithNabra: speechMocks.speak,
  stopNabraAudio: speechMocks.stop,
}));

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.onstart?.();
  }

  abort() {}
}

let container: HTMLDivElement;
let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Node 26 defines its own `localStorage` accessor on the global object, which
// returns `undefined` without --localstorage-file; in the jsdom environment
// it shadows jsdom's Storage (same shim rationale as apps/desktop/vitest.setup.ts).
if (typeof (globalThis as { localStorage?: Storage }).localStorage === "undefined") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(String(k)) ?? null,
    setItem: (k: string, v: string) => void store.set(String(k), String(v)),
    removeItem: (k: string) => void store.delete(String(k)),
    clear: () => store.clear(),
  };
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

describe("ChatVoiceControls", () => {
  beforeEach(() => {
    feedMocks.FakeEventsFeed.instances = [];
    FakeRecognition.instances = [];
    speechMocks.speak.mockClear();
    speechMocks.stop.mockClear();
    ttsMocks.playNextFn.mockReset();
    ttsMocks.playNextFn.mockImplementation(async () => ({ spoke: true, fallbackToFish: false }));
    ttsMocks.stopOpenRouterAudio.mockClear();
    ttsMocks.unlockOpenRouterAudioForGesture.mockClear();
    window.localStorage.clear();
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("normalizes dictated prompts and separates final from interim text", () => {
    expect(normalizeVoicePrompt("  open\n the\t calendar  ")).toBe("open the calendar");
    expect(
      recognitionTranscript({
        resultIndex: 0,
        results: [
          { 0: { transcript: "run the task" }, isFinal: true },
          { 0: { transcript: "please" }, isFinal: false },
        ],
      }),
    ).toEqual({ final: "run the task", interim: "please" });

    const socket = { readyState: WebSocket.OPEN, send: vi.fn() };
    let sendReturn: (() => void) | undefined;
    expect(sendVoicePrompt(socket, " run\n it ", (callback) => { sendReturn = callback; }, () => true)).toBe(true);
    expect(socket.send).toHaveBeenCalledWith("run it");
    sendReturn?.();
    expect(socket.send).toHaveBeenLastCalledWith("\r");
  });

  it("submits final speech through the active Hermes chat via Send button or silence timeout", async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn(() => true);
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });

    await act(async () => {
      button("Mic").click();
      vi.advanceTimersByTime(10);
    });
    const recognition = FakeRecognition.instances.at(-1)!;
    expect(recognition.continuous).toBe(true);
    expect(recognition.lang).toBe("en-US");

    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "create a todo" }, isFinal: true }],
      });
    });

    // Instant send button is visible with draft
    expect(container.textContent).toContain("create a todo");
    const sendBtn = button("Send");
    act(() => {
      sendBtn.click();
    });

    expect(onSubmit).toHaveBeenCalledWith("create a todo");
    expect(container.textContent).toContain("Sent to Hermes");
    vi.useRealTimers();
  });

  it("accumulates multiple speech chunks continuously and auto-submits on silence timeout", async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn(() => true);
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });

    await act(async () => {
      button("Mic").click();
      vi.advanceTimersByTime(10);
    });
    const recognition = FakeRecognition.instances.at(-1)!;

    // Chunk 1
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "please help me" }, isFinal: true }],
      });
    });
    expect(container.textContent).toContain("please help me");

    // Pause briefly (less than timeout, e.g. 500ms) - should NOT submit yet
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // Chunk 2 (user continues speaking)
    act(() => {
      recognition.onresult?.({
        resultIndex: 1,
        results: [
          { 0: { transcript: "please help me" }, isFinal: true },
          { 0: { transcript: "write a python test" }, isFinal: true },
        ],
      });
    });
    expect(container.textContent).toContain("please help me write a python test");

    // Advance past silence timeout
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onSubmit).toHaveBeenCalledWith("please help me write a python test");
    expect(container.textContent).toContain("Sent to Hermes");
    vi.useRealTimers();
  });

  it("cycles language modes (EN -> عربي -> Auto) and re-starts recognition with the right language", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });

    // Default is English as requested
    expect(container.textContent).toContain("EN");

    // Start mic in English
    await act(async () => {
      button("Mic").click();
      vi.advanceTimersByTime(10);
    });
    let rec = FakeRecognition.instances.at(-1)!;
    expect(rec.lang).toBe("en-US");

    // Toggle to Arabic (عربي)
    await act(async () => {
      button("EN").click();
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toContain("عربي");
    rec = FakeRecognition.instances.at(-1)!;
    expect(rec.lang).toBe("ar-EG");

    // Toggle to Auto
    await act(async () => {
      button("عربي").click();
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toContain("Auto");

    // In Auto mode, speaking Arabic adapts the lang
    rec = FakeRecognition.instances.at(-1)!;
    act(() => {
      rec.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "عايزك تساعدني" }, isFinal: true }],
      });
    });
    expect(container.textContent).toContain("عايزك تساعدني");

    vi.useRealTimers();
  });

  it("speaks streamed assistant sentences and flushes the final clause", async () => {
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    await act(async () => button("Voice off").click());
    const feed = feedMocks.FakeEventsFeed.instances[0];

    await act(async () => {
      feed.emit("message.start");
      feed.emit("message.delta", { text: "Task complete. Remaining detail" });
      await Promise.resolve();
    });
    expect(speechMocks.speak).toHaveBeenCalledWith("Task complete.", "jarvis", false);

    await act(async () => {
      feed.emit("message.complete", { text: "Task complete. Remaining detail" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(speechMocks.speak).toHaveBeenCalledWith("Remaining detail", "jarvis", false);
  });

  it("spoken replies follow the mic by default and an explicit Voice choice persists", async () => {
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    // No explicit choice yet: Voice is off until the Mic is enabled.
    expect(container.textContent).toContain("Voice off");

    // Enabling the Mic enables spoken replies by default.
    await act(async () => button("Mic").click());
    expect(container.textContent).toContain("Voice on");

    // An explicit mute is persisted and wins over the default.
    await act(async () => button("Voice on").click());
    expect(container.textContent).toContain("Voice off");
    expect(window.localStorage.getItem("hermes_chat_speech_enabled")).toBe("off");

    // A persisted explicit "on" is honored on the next mount too.
    window.localStorage.setItem("hermes_chat_speech_enabled", "on");
    act(() => root.unmount());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    expect(container.textContent).toContain("Voice on");
    await act(async () => button("Voice on").click());
    expect(window.localStorage.getItem("hermes_chat_speech_enabled")).toBe("off");
  });

  it("unlocks OpenRouter audio in the same gesture that enables Voice", async () => {
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    expect(ttsMocks.unlockOpenRouterAudioForGesture).not.toHaveBeenCalled();
    // Enabling Voice is the autoplay gesture: the `<audio>` path must be
    // primed here, not when the first sentence arrives from the network.
    await act(async () => button("Voice off").click());
    expect(ttsMocks.unlockOpenRouterAudioForGesture).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Voice on");
  });

  it("toggles voice persona between Male (Jarvis) and Female (Gwen) and persists to localStorage", async () => {
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    expect(container.textContent).toContain("Voice: Male");
    await act(async () => button("Voice: Male").click());
    expect(container.textContent).toContain("Voice: Female");
    expect(window.localStorage.getItem("hermes_chat_voice_persona")).toBe("gwen");
    await act(async () => button("Voice: Female").click());
    expect(container.textContent).toContain("Voice: Male");
    expect(window.localStorage.getItem("hermes_chat_voice_persona")).toBe("jarvis");
  });

  it("falls back to the browser voice when OpenRouter playback fails instead of dropping the sentence", async () => {
    ttsMocks.playNextFn.mockResolvedValue({ spoke: false, fallbackToFish: false });
    let releaseSpeak!: () => void;
    speechMocks.speak.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseSpeak = () => resolve(undefined);
        }),
    );
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    await act(async () => button("Voice off").click()); // explicit Voice on
    await act(async () => button("TTS: Browser").click()); // -> Flux engine
    const feed = feedMocks.FakeEventsFeed.instances.at(-1)!;

    await act(async () => {
      feed.emit("message.start");
      feed.emit("message.delta", { text: "Task complete. Remaining detail" });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(ttsMocks.playNextFn).toHaveBeenCalledWith("Task complete.", "flux");
    // The pipeline failed; the pump sets the fallback status and enters the
    // browser-voice loop. The browser voice is pending, so the status is
    // visible now.
    expect(container.textContent).toContain("OpenRouter TTS unavailable");

    await act(async () => {
      releaseSpeak();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    // The transient fallback note must not outlive the drained queue.
    expect(container.textContent).toContain("Voice ready");
    expect(container.textContent).not.toContain("OpenRouter TTS unavailable");
  });

  it("captures server-STT audio from recognition start and restarts cleanly each turn", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("hermes_chat_stt_mode", "server");

    class FakeMediaRecorder {
      static instances: FakeMediaRecorder[] = [];
      state: "inactive" | "recording" = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      readonly mimeType = "audio/webm";
      readonly stream: MediaStream;
      constructor(stream: MediaStream) {
        this.stream = stream;
        FakeMediaRecorder.instances.push(this);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }
    FakeMediaRecorder.instances = [];
    const fakeStream = { getTracks: () => [] as MediaStreamTrack[] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => fakeStream) },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });

    try {
      const onSubmit = vi.fn(() => true);
      await act(async () => {
        root.render(
          <ChatVoiceControls
            channel="chat-1"
            connected
            foreground="#fff"
            onSubmit={onSubmit}
          />,
        );
      });

      await act(async () => {
        button("Mic").click();
        await Promise.resolve();
        vi.advanceTimersByTime(10);
        await Promise.resolve();
      });

      // Capture began when recognition became active — before the first word,
      // so the server transcript includes the utterance onset.
      expect(FakeMediaRecorder.instances).toHaveLength(1);

      // A recognition result must not start a second overlapping capture.
      const recognition = FakeRecognition.instances.at(-1)!;
      act(() => {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ 0: { transcript: "create a todo" }, isFinal: true }],
        });
      });
      expect(FakeMediaRecorder.instances).toHaveLength(1);
      expect(container.textContent).toContain("create a todo");

      // Submitting the turn stops the capture and still submits the draft
      // (empty recording falls back to the browser transcript).
      await act(async () => {
        button("Send").click();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      expect(onSubmit).toHaveBeenCalledWith("create a todo");
      expect(FakeMediaRecorder.instances[0].state).toBe("inactive");

      // The next turn starts a fresh capture on recognition start.
      const feed = feedMocks.FakeEventsFeed.instances.at(-1)!;
      await act(async () => {
        feed.emit("message.start");
        feed.emit("message.complete", { text: "" });
        for (let i = 0; i < 10; i++) await Promise.resolve();
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      expect(FakeMediaRecorder.instances).toHaveLength(2);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaDevices;
      delete (window as unknown as Record<string, unknown>).MediaRecorder;
      vi.useRealTimers();
    }
  });

  it("muting while OpenRouter playback is pending cancels cleanly without duplicate speech", async () => {
    let release!: (value: { spoke: boolean; fallbackToFish: boolean }) => void;
    ttsMocks.playNextFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    await act(async () => button("Voice off").click()); // explicit Voice on
    await act(async () => button("TTS: Browser").click()); // -> Flux engine
    const feed = feedMocks.FakeEventsFeed.instances.at(-1)!;

    await act(async () => {
      feed.emit("message.start");
      feed.emit("message.delta", { text: "One sentence only." });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(container.textContent).toContain("Hermes speaking");

    // Mute while the OpenRouter attempt is still pending, then let it resolve
    // as FAILED: the generation bump must unwind the queue — no fallback
    // speech, no stuck "speaking" state.
    await act(async () => button("Voice on").click());
    expect(ttsMocks.stopOpenRouterAudio).toHaveBeenCalled();
    await act(async () => {
      release({ spoke: false, fallbackToFish: false });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(speechMocks.speak).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Spoken replies off");
    expect(container.textContent).not.toContain("Hermes speaking");
    expect(container.textContent).not.toContain("OpenRouter TTS unavailable");
  });

  it("returns the status to a ready state after the speech queue drains with the mic off", async () => {
    let releaseSpeak!: () => void;
    speechMocks.speak.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseSpeak = () => resolve(undefined);
        }),
    );
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={() => true}
        />,
      );
    });
    // Explicit Voice on, but the Mic stays OFF the whole time — the exact
    // configuration where maybeResumeListening is a no-op and the pump's
    // own status used to stick after the audio finished.
    await act(async () => button("Voice off").click());
    const feed = feedMocks.FakeEventsFeed.instances.at(-1)!;

    await act(async () => {
      feed.emit("message.start");
      feed.emit("message.delta", { text: "All systems nominal." });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(container.textContent).toContain("Hermes speaking");

    // message.complete flushes the remainder while the sentence is still
    // playing; the pump must only unwind once the queue is actually empty.
    await act(async () => {
      feed.emit("message.complete", { text: "All systems nominal." });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(container.textContent).toContain("Hermes speaking");

    await act(async () => {
      releaseSpeak();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(speechMocks.speak).toHaveBeenCalledWith("All systems nominal.", "jarvis", false);
    // The stale speaking status must not outlive the drained queue.
    expect(container.textContent).toContain("Voice ready");
    expect(container.textContent).not.toContain("Hermes speaking");
  });

  it("clears the reconnecting status when the chat reconnects without clobbering live status", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected={false}
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });
    expect(container.textContent).toContain("Chat is reconnecting");

    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });
    expect(container.textContent).toContain("Voice ready");
    expect(container.textContent).not.toContain("Chat is reconnecting");

    // A live status written after the drop wins over the reconnect clear.
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected={false}
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });
    expect(container.textContent).toContain("Chat is reconnecting");
    await act(async () => button("STT: Browser").click());
    expect(container.textContent).toContain("Server transcription on");
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });
    expect(container.textContent).toContain("Server transcription on");
    expect(container.textContent).not.toContain("Voice ready");
  });

  it("toggles Jev intent routing and intercepts fast-path commands without calling onSubmit", async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn(() => true);
    await act(async () => {
      root.render(
        <ChatVoiceControls
          channel="chat-1"
          connected
          foreground="#fff"
          onSubmit={onSubmit}
        />,
      );
    });

    // Default is Jev On
    expect(container.textContent).toContain("Jev: On");

    // Toggle to Jev Off
    await act(async () => button("Jev: On").click());
    expect(container.textContent).toContain("Jev: Off");
    expect(window.localStorage.getItem("hermes_chat_jev_enabled")).toBe("false");

    // Toggle back to Jev On
    await act(async () => button("Jev: Off").click());
    expect(container.textContent).toContain("Jev: On");
    expect(window.localStorage.getItem("hermes_chat_jev_enabled")).toBe("true");

    // Start mic and dictate a fast-path music command
    await act(async () => {
      button("Mic").click();
      vi.advanceTimersByTime(10);
    });
    const rec = FakeRecognition.instances.at(-1)!;

    act(() => {
      rec.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "play lofi hip hop" }, isFinal: true }],
      });
    });

    // Mock fetch for fast-path execution to prevent invalid relative URL in node
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    } as unknown as Response);

    try {
      // Submit the command
      const sendBtn = button("Send");
      await act(async () => {
        sendBtn.click();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

      // Intercepted by Jev fast-path: status updated and onSubmit bypassed
      expect(container.textContent).toContain("Jev: music");
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });
});

