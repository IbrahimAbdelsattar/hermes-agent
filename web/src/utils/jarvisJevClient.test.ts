// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateJevIntent,
  executeFastPathMusic,
  executeFastPathStandby,
  executeFastPathTelemetry,
  getJarvisJevStatus,
  isJevFastPathEnabled,
  setJevFastPathEnabled,
} from './jarvisJevClient';

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k];
  }),
};

describe('jarvisJevClient', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    mockLocalStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manages fast path enabled preference in localStorage', () => {
    expect(isJevFastPathEnabled()).toBe(true);
    setJevFastPathEnabled(false);
    expect(isJevFastPathEnabled()).toBe(false);
    setJevFastPathEnabled(true);
    expect(isJevFastPathEnabled()).toBe(true);
  });

  it('fetches Jev status from backend', async () => {
    const mockStatus = {
      enabled: true,
      provider: 'typesafe',
      model: 'typesafe/jev-latest',
      active_key_source: 'TYPESAFE_API_KEY',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockStatus,
    }));

    const status = await getJarvisJevStatus();
    expect(status.enabled).toBe(true);
    expect(status.provider).toBe('typesafe');
    expect(status.model).toBe('typesafe/jev-latest');
  });

  it('evaluates Jev intent via API', async () => {
    const mockDecision = {
      route: 'music',
      action: 'play',
      target: 'Iron Man theme',
      confidence: 0.95,
      latency_ms: 82,
      provider: 'typesafe',
      spoken_confirmation: 'Playing Iron Man theme right away, Sir.',
      bypass_llm: true,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDecision,
    }));

    const decision = await evaluateJevIntent('play Iron Man theme', 'english');
    expect(decision.route).toBe('music');
    expect(decision.action).toBe('play');
    expect(decision.bypass_llm).toBe(true);
    expect(decision.confidence).toBe(0.95);
  });

  it('falls back gracefully when evaluateJevIntent API throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const decision = await evaluateJevIntent('random query', 'english');
    expect(decision.route).toBe('llm');
    expect(decision.bypass_llm).toBe(false);
    expect(decision.provider).toBe('fallback');
  });

  it('dispatches music command event on executeFastPathMusic', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const result = executeFastPathMusic('play', 'AC/DC');
    expect(result).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'jarvis:music:command',
        detail: { action: 'play', query: 'AC/DC' },
      })
    );
  });

  it('dispatches voice standby event on executeFastPathStandby', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    executeFastPathStandby();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'jarvis:voice:standby',
      })
    );
  });

  it('formats telemetry response for weather', async () => {
    const spokenArabic = await executeFastPathTelemetry('weather', true);
    expect(spokenArabic).toContain('درجة الحرارة');

    const spokenEnglish = await executeFastPathTelemetry('weather', false);
    expect(spokenEnglish).toContain('Current temperature');
  });

  it('formats telemetry response for USD/EGP exchange', async () => {
    const spokenArabic = await executeFastPathTelemetry('exchange', true);
    expect(spokenArabic).toContain('الدولار');

    const spokenEnglish = await executeFastPathTelemetry('exchange', false);
    expect(spokenEnglish).toContain('USD to EGP');
  });
});
