// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateJevIntent,
  executeJevFastPath,
  getJarvisJevStatus,
  isJevFastPathEnabled,
  setJevFastPathEnabled,
  type JevRouteDecision,
} from "./jarvisJevClient";

const mockAuthedFetch = vi.fn();
vi.mock("@/lib/api", () => ({
  authedFetch: (...args: unknown[]) => mockAuthedFetch(...args),
}));

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

describe("jarvisJevClient", () => {
  beforeEach(() => {
    mockAuthedFetch.mockReset();
    window.localStorage?.clear();
  });

  it("stores and reads Jev enabled state", () => {
    expect(isJevFastPathEnabled()).toBe(true);
    setJevFastPathEnabled(false);
    expect(isJevFastPathEnabled()).toBe(false);
    setJevFastPathEnabled(true);
    expect(isJevFastPathEnabled()).toBe(true);
  });

  it("fetches Jev status from backend endpoint", async () => {
    mockAuthedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        enabled: true,
        provider: "openrouter",
        model: "~typesafe/jev-latest",
        active_key_source: "OPENROUTER_API_KEY",
      }),
    });

    const status = await getJarvisJevStatus();
    expect(status.provider).toBe("openrouter");
    expect(status.model).toBe("~typesafe/jev-latest");
    expect(mockAuthedFetch).toHaveBeenCalledWith("/api/jarvis/jev-status");
  });

  it("evaluates intent and returns typed decision", async () => {
    mockAuthedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        route: "music",
        action: "play",
        target: "amr diab",
        confidence: 0.95,
        latency_ms: 120,
        provider: "openrouter",
        spoken_confirmation: "Playing amr diab right away, Sir.",
        bypass_llm: true,
      }),
    });

    const decision = await evaluateJevIntent("play amr diab", "english", "jarvis");
    expect(decision.route).toBe("music");
    expect(decision.bypass_llm).toBe(true);
    expect(decision.provider).toBe("openrouter");
    expect(decision.target).toBe("amr diab");
  });

  it("falls back gracefully when remote intent call fails", async () => {
    mockAuthedFetch.mockRejectedValueOnce(new Error("Network error"));

    const decision = await evaluateJevIntent("what is the weather?", "english");
    expect(decision.provider).toBe("fallback");
    expect(decision.bypass_llm).toBe(false);
  });

  it("executes fast-path music by calling /api/youtube/play", async () => {
    mockAuthedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, opened: true }),
    });

    const decision: JevRouteDecision = {
      route: "music",
      action: "play",
      target: "amr diab",
      confidence: 0.95,
      latency_ms: 50,
      provider: "openrouter",
      spoken_confirmation: "Playing amr diab",
      bypass_llm: true,
    };

    const res = await executeJevFastPath(decision);
    expect(res.handled).toBe(true);
    expect(mockAuthedFetch).toHaveBeenCalledWith("/api/youtube/play", expect.objectContaining({
      method: "POST",
    }));
  });
});
