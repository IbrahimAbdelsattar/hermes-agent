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

vi.mock("@/lib/eventsFeedClient", () => ({ EventsFeedClient: feedMocks.FakeEventsFeed }));
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

  it("submits final speech through the active Hermes chat", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const recognition = FakeRecognition.instances.at(-1)!;
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "create a todo" }, isFinal: true }],
      });
    });

    expect(onSubmit).toHaveBeenCalledWith("create a todo");
    expect(container.textContent).toContain("Sent to Hermes");
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
});
