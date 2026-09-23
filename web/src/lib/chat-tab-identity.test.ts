// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Tab = {
  resolveChatTabPair: (scope: string, rotate?: boolean) => Promise<{ attach: string; channel: string }>;
  chatChannelForAttach: (attach: string, scope: string) => string;
  storage: Storage;
};

const TOKEN_KEY = "hermes.pty.token.chat";
const SCOPE = "resume-1\0default";

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const store: Record<string, string> = { ...seed };
  return {
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    getItem: (key: string) => store[key] ?? null,
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
  } as Storage;
}

function fakeLocks(held: Set<string>) {
  return {
    request: (
      name: string,
      _options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => unknown,
    ) => {
      if (held.has(name)) {
        callback(null);
        return Promise.resolve();
      }
      held.add(name);
      return Promise.resolve(callback({ name }));
    },
  };
}

function simulateUnload(held: Set<string>) {
  held.clear();
}

async function openTab(held: Set<string>, seed: Record<string, string> = {}): Promise<Tab> {
  vi.resetModules();
  const storage = fakeStorage(seed);
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: storage });
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: fakeLocks(held),
  });
  const mod = await import("./chat-tab-identity");
  return { resolveChatTabPair: mod.resolveChatTabPair, chatChannelForAttach: mod.chatChannelForAttach, storage };
}

beforeEach(() => {
  vi.stubGlobal("crypto", {
    getRandomValues: (values: Uint8Array) => {
      values.fill(Math.floor(Math.random() * 256));
      return values;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window.navigator as { locks?: unknown }).locks;
});

describe("chat tab identity", () => {
  it("reload preserves the attach+channel pair", async () => {
    const held = new Set<string>();
    const before = await openTab(held);
    const first = await before.resolveChatTabPair(SCOPE);
    expect(first.channel).toBe(before.chatChannelForAttach(first.attach, SCOPE));

    simulateUnload(held);
    const reloaded = await openTab(held, { [TOKEN_KEY]: first.attach });
    const second = await reloaded.resolveChatTabPair(SCOPE);

    expect(second.attach).toBe(first.attach);
    expect(second.channel).toBe(first.channel);
  });

  it("explicit rotation changes both attach and channel", async () => {
    const held = new Set<string>();
    const tab = await openTab(held);
    const first = await tab.resolveChatTabPair(SCOPE);
    const rotated = await tab.resolveChatTabPair(SCOPE, true);

    expect(rotated.attach).not.toBe(first.attach);
    expect(rotated.channel).not.toBe(first.channel);
    expect(rotated.channel).toBe(tab.chatChannelForAttach(rotated.attach, SCOPE));
  });
});
