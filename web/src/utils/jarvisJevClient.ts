import { authedFetch } from "@/lib/api";

export interface JevRouteDecision {
  route: "music" | "telemetry" | "task" | "standby" | "browser" | "computer" | "llm";
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

const BROWSER_TAB_CLOSE_PATTERNS = [
  /^(?:close|shut)\s*(?:the\s*)?(?:current\s*)?tab$/i,
  /\b(?:close\s+tab|close\s+this\s+tab)\b/i,
  /^(?:اقفل|اقفلي|قفل)\s*(?:التابة|التاب|الصفحة)(?:\s+دي)?$/i,
];

const BROWSER_TAB_OPEN_PATTERNS = [
  /^(?:open|launch|create)\s+(?:a\s+)?(?:new\s+)?tab(?:\s+(?:for|to|with)\s+(.+))?$/i,
  /^(?:new\s+tab)(?:\s+(?:for|to|with)\s+(.+))?$/i,
  /\b(?:open\s+(?:a\s+)?(?:new\s+)?(?:browser\s+)?tab)\b/i,
  /^(?:open|launch|go\s+to|visit)\s+(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?)$/i,
  /^(?:open|launch)\s+(google|youtube|github|twitter|x|reddit|facebook|instagram|linkedin|chatgpt|claude|gmail)(?:\s+(?:in\s+a\s+new\s+tab|tab))?$/i,
  /^(?:افتح|افتحلي|افتحلنا|هات)\s+(?:تابة|تاب|صفحة|موقع)\s*(?:جديدة|جديد)?(?:\s+(.+))?$/i,
  /^(?:تابة|تاب)\s+جديدة(?:\s+(.+))?$/i,
  /^(?:افتح|ادخل\s+على|روح\s+على)\s+(?:موقع\s+)?(جوجل|يوتيوب|فيسبوك|تويتر|جيتهاب|لينكدإن|شات\s*جي\s*بي\s*تي|جيميل)(?:\s+(?:في\s+تابة\s+جديدة|في\s+تاب))?$/i,
  /^(?:افتح|ادخل\s+على)\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}\S*)$/i,
];

const COMPUTER_SCREENSHOT_PATTERNS = [
  /\b(?:take\s*(?:a\s*)?screenshot|capture\s*(?:the\s*)?(?:desktop|screen)|desktop\s*screenshot|screen\s*grab)\b/i,
  /^(?:خد|خدي|اعمل|أخد)\s*(?:سكرين\s*شوت|لقطة\s*شاشة|صورة\s*للشاشة)$/i,
];

const MUSIC_PLAY_PATTERNS = [
  /^(?:شغل|شغلي|شغللي|شغللنا|عايز اسمع|عايز أسمع|عاوز اسمع|عاوز أسمع|سمعني|play|start)\s+(.+)$/i,
  /\b(?:play\s+song|play\s+track|play\s+music)\s+(.+)$/i,
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

  for (const p of BROWSER_TAB_CLOSE_PATTERNS) {
    if (p.test(clean)) {
      return {
        route: "browser",
        action: "close_tab",
        target: null,
        confidence: 0.96,
        latency_ms: 1,
        provider: "fallback",
        spoken_confirmation: isArabic
          ? "تم إغلاق التابة."
          : "Closing current tab, Sir.",
        bypass_llm: true,
      };
    }
  }

  for (const p of BROWSER_TAB_OPEN_PATTERNS) {
    const m = p.exec(clean);
    if (m) {
      const rawTarget = m[1] ? m[1].trim() : "";
      const target = rawTarget.replace(/^(?:for|to|with|موقع|site|website)\s+/i, "").trim() || null;
      return {
        route: "browser",
        action: "open_tab",
        target,
        confidence: 0.96,
        latency_ms: 1,
        provider: "fallback",
        spoken_confirmation: isArabic
          ? `فتحتلك ${target || "تابة جديدة"} حالا.`
          : `Opening ${target || "a new tab"} now, Sir.`,
        bypass_llm: true,
      };
    }
  }

  for (const p of COMPUTER_SCREENSHOT_PATTERNS) {
    if (p.test(clean)) {
      return {
        route: "computer",
        action: "screenshot",
        target: null,
        confidence: 0.96,
        latency_ms: 1,
        provider: "fallback",
        spoken_confirmation: isArabic
          ? "تم أخذ لقطة شاشة لسطح المكتب."
          : "Captured desktop screenshot, Sir.",
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

  if (decision.route === "browser") {
    if (decision.action === "open_tab") {
      const target = decision.target?.trim() || "";
      let destUrl = "https://www.google.com";

      if (!target || target.toLowerCase() === "new tab" || target === "تابة جديدة") {
        destUrl = "about:blank";
      } else if (/^https?:\/\//i.test(target)) {
        destUrl = target;
      } else if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(target)) {
        destUrl = `https://${target}`;
      } else {
        const norm = target.toLowerCase();
        if (norm === "youtube" || norm === "يوتيوب") destUrl = "https://www.youtube.com";
        else if (norm === "google" || norm === "جوجل") destUrl = "https://www.google.com";
        else if (norm === "github" || norm === "جيتهاب") destUrl = "https://github.com";
        else if (norm === "twitter" || norm === "x" || norm === "تويتر") destUrl = "https://x.com";
        else if (norm === "reddit") destUrl = "https://www.reddit.com";
        else if (norm === "gmail" || norm === "جيميل") destUrl = "https://mail.google.com";
        else if (norm === "facebook" || norm === "فيسبوك") destUrl = "https://www.facebook.com";
        else destUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }

      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(destUrl, "_blank", "noopener,noreferrer");
      }
      return { handled: true, actionDesc: `Opened tab: ${destUrl}` };
    }

    if (decision.action === "close_tab") {
      if (typeof window !== "undefined" && typeof window.close === "function") {
        window.close();
      }
      return { handled: true, actionDesc: "Closed tab" };
    }
  }

  if (decision.route === "computer") {
    return { handled: true, actionDesc: `Computer action: ${decision.action || "executed"}` };
  }

  return { handled: false };
}

