import { authedFetch } from "@/lib/api";

export interface JevRouteDecision {
  route: "music" | "telemetry" | "task" | "standby" | "llm";
  action: string | null;
  target: string | null;
  confidence: number;
  latency_ms: number;
  provider: "typesafe" | "openrouter" | "fallback";
  spoken_confirmation: string;
  bypass_llm: boolean;
}

export interface JevStatusResponse {
  enabled: boolean;
  provider: "typesafe" | "openrouter" | "fallback";
  model: string;
  active_key_source: string | null;
}

export const JEV_ENABLED_STORAGE_KEY = "hermes_chat_jev_enabled";

const STANDBY_PATTERNS = [
  /\b(?:standby\s*jarvis|go\s*to\s*sleep|sleep\s*mode|power\s*down|enter\s*standby|standby|goodnight\s*jarvis)\b/i,
  /(?:نام|انام|ادخل\s*وضع\s*الاستعداد|وضع\s*الاستعداد|تصبح\s*على\s*خير|اقفل\s*يا\s*جارفيس|اسكت\s*يا\s*جارفيس)/i,
];

const MUSIC_PLAY_PATTERNS = [
  /^(?:شغل|شغلي|شغللي|شغللنا|عايز اسمع|عايز أسمع|عاوز اسمع|عاوز أسمع|سمعني|افتح|play|start)\s+(.+)$/i,
  /\b(?:play\s+song|play\s+track|play\s+music|play)\s+(.+)$/i,
];

const MUSIC_PAUSE_PATTERNS = [
  /^(?:وقف|وقفي|وقفلي|اقفل|اقفلي|اسكت|كفاية|stop|pause)\s*(?:الموسيقى|الميوزك|المزيكا|الاغنية|الأغنية|music|song)?$/i,
  /\b(?:pause\s*(?:the\s*)?music|stop\s*(?:the\s*)?music|pause\s*song|stop\s*song|pause\s*playback|وقف\s*المزيكا)\b/i,
];

export function classifyJevFastPath(
  text: string,
  isArabic: boolean = false,
): JevRouteDecision | null {
  const clean = text.trim();
  if (!clean) return null;

  for (const p of STANDBY_PATTERNS) {
    if (p.test(clean)) {
      return {
        route: "standby",
        action: "sleep",
        target: null,
        confidence: 0.98,
        latency_ms: 1,
        provider: "fallback",
        spoken_confirmation: isArabic
          ? "تصبح على خير، وضعت النظام في وضع الاستعداد."
          : "Entering standby mode now, Sir.",
        bypass_llm: true,
      };
    }
  }

  for (const p of MUSIC_PAUSE_PATTERNS) {
    if (p.test(clean)) {
      return {
        route: "music",
        action: "pause",
        target: null,
        confidence: 0.95,
        latency_ms: 1,
        provider: "fallback",
        spoken_confirmation: isArabic
          ? "تم إيقاف تشغيل الموسيقى."
          : "Music paused, Sir.",
        bypass_llm: true,
      };
    }
  }

  for (const p of MUSIC_PLAY_PATTERNS) {
    const m = p.exec(clean);
    if (m && m[1]) {
      const target = m[1].replace(/\s+(?:from\s+youtube|on\s+youtube|من\s+اليوتيوب|على\s+اليوتيوب)$/i, "").trim();
      return {
        route: "music",
        action: "play",
        target,
        confidence: 0.94,
        latency_ms: 1,
        provider: "fallback",
        spoken_confirmation: isArabic
          ? `شغلتلك ${target} حالا.`
          : `Playing ${target} right away, Sir.`,
        bypass_llm: true,
      };
    }
  }

  return null;
}

export function isJevFastPathEnabled(): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return true;
  try {
    const stored = localStorage.getItem(JEV_ENABLED_STORAGE_KEY);
    return stored !== null ? stored === "true" : true;
  } catch {
    return true;
  }
}

export function setJevFastPathEnabled(enabled: boolean): void {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(JEV_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
    } catch {
      // ignore
    }
  }
}

export async function getJarvisJevStatus(): Promise<JevStatusResponse> {
  try {
    const res = await authedFetch("/api/jarvis/jev-status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as JevStatusResponse;
  } catch (err) {
    console.debug("[JevClient] Status check fallback:", err);
    return {
      enabled: true,
      provider: "fallback",
      model: "bilingual-heuristic",
      active_key_source: null,
    };
  }
}

export async function evaluateJevIntent(
  text: string,
  language: string = "arabic_egyptian",
  persona: string = "jarvis",
): Promise<JevRouteDecision> {
  try {
    const res = await authedFetch("/api/jarvis/jev-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, persona }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as JevRouteDecision;
  } catch (err) {
    if (typeof process === "undefined" || process.env?.NODE_ENV !== "test") {
      console.warn("[JevClient] Remote intent evaluation note:", err);
    }
    const isArabic = language === "arabic_egyptian" || /[\u0600-\u06FF]/.test(text);
    return {
      route: "llm",
      action: "query",
      target: null,
      confidence: 0.5,
      latency_ms: 10,
      provider: "fallback",
      spoken_confirmation: isArabic ? "جاري المعالجة..." : "Processing...",
      bypass_llm: false,
    };
  }
}

/**
 * Execute client-side fast-path actions (such as playing YouTube music) without
 * calling the full Hermes agent turn loop.
 */
export async function executeJevFastPath(
  decision: JevRouteDecision,
): Promise<{ handled: boolean; actionDesc?: string }> {
  if (!decision.bypass_llm) {
    return { handled: false };
  }

  if (decision.route === "music") {
    const query = decision.target;
    if (query) {
      try {
        await authedFetch("/api/youtube/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, open_browser: true, autoplay: true }),
        });
        return { handled: true, actionDesc: `Playing ${query}` };
      } catch (err) {
        console.warn("[JevClient] Fast-path YouTube play error:", err);
      }
    }
    return { handled: true, actionDesc: "Music action handled" };
  }

  if (decision.route === "standby") {
    return { handled: true, actionDesc: "Standby mode activated" };
  }

  if (decision.route === "telemetry") {
    return { handled: true, actionDesc: "Telemetry update" };
  }

  return { handled: false };
}
