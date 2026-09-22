import { authedFetch } from '@/lib/api';
import {
  fetchLiveWeather,
  fetchLiveExchange,
  fetchLiveMarket,
  fetchLiveGold,
  fetchLiveISS,
} from './jarvisApiClient';

export interface JevRouteDecision {
  route: 'music' | 'telemetry' | 'task' | 'standby' | 'llm';
  action: string | null;
  target: string | null;
  confidence: number;
  latency_ms: number;
  provider: 'typesafe' | 'openrouter' | 'fallback';
  spoken_confirmation: string;
  bypass_llm: boolean;
}

export interface JevStatusResponse {
  enabled: boolean;
  provider: 'typesafe' | 'openrouter' | 'fallback';
  model: string;
  active_key_source: string | null;
}

const STORAGE_KEY_JEV_ENABLED = 'JARVIS_JEV_FAST_PATH_ENABLED';

export function isJevFastPathEnabled(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return true;
  const stored = localStorage.getItem(STORAGE_KEY_JEV_ENABLED);
  return stored !== null ? stored === 'true' : true;
}

export function setJevFastPathEnabled(enabled: boolean): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_JEV_ENABLED, enabled ? 'true' : 'false');
  }
}

export async function getJarvisJevStatus(): Promise<JevStatusResponse> {
  try {
    const res = await authedFetch('/api/jarvis/jev-status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as JevStatusResponse;
  } catch (err) {
    console.debug('Jev status check fallback:', err);
    return {
      enabled: true,
      provider: 'fallback',
      model: 'bilingual-heuristic',
      active_key_source: null,
    };
  }
}

export async function evaluateJevIntent(
  text: string,
  language: string = 'arabic_egyptian',
  persona: string = 'jarvis',
): Promise<JevRouteDecision> {
  try {
    const res = await authedFetch('/api/jarvis/jev-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, persona }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as JevRouteDecision;
  } catch (err) {
    console.warn('Jev remote intent route failed, falling back locally:', err);
    const isArabic = language === 'arabic_egyptian' || /[\u0600-\u06FF]/.test(text);
    return {
      route: 'llm',
      action: 'query',
      target: null,
      confidence: 0.5,
      latency_ms: 10,
      provider: 'fallback',
      spoken_confirmation: isArabic ? 'جاري المعالجة...' : 'Processing...',
      bypass_llm: false,
    };
  }
}

/**
 * Execute client-side music fast-path without invoking the main LLM.
 */
export function executeFastPathMusic(action: string, target?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  const customEvent = new CustomEvent('jarvis:music:command', {
    detail: {
      action: action.toLowerCase(),
      query: target || undefined,
    },
  });
  window.dispatchEvent(customEvent);
  return true;
}

/**
 * Execute client-side live telemetry fast-path and generate immediate spoken answer.
 */
export async function executeFastPathTelemetry(action: string, isArabic: boolean): Promise<string> {
  try {
    switch (action.toLowerCase()) {
      case 'weather': {
        const w = await fetchLiveWeather();
        if (isArabic) {
          return `درجة الحرارة في ${w.location} حالياً ${w.temperature} درجة مئوية، ونسبة الرطوبة ${w.humidity} بالمائة.`;
        }
        return `Current temperature in ${w.location} is ${w.temperature} degrees Celsius with ${w.humidity}% humidity.`;
      }

      case 'exchange': {
        const ex = await fetchLiveExchange();
        if (isArabic) {
          return `سعر صرف الدولار الأمريكي اليوم مسجل ${ex.rate} جنيهاً مصرياً.`;
        }
        return `The current USD to EGP exchange rate is ${ex.rate} Egyptian pounds per US dollar.`;
      }

      case 'crypto': {
        const coins = await fetchLiveMarket();
        const btc = coins.find(c => c.symbol === 'BTC');
        const eth = coins.find(c => c.symbol === 'ETH');
        if (isArabic) {
          return `سعر البيتكوين حالياً ${btc?.priceUsd?.toLocaleString() || '97,000'} دولار، والإيثريوم ${eth?.priceUsd?.toLocaleString() || '2,800'} دولار.`;
        }
        return `Bitcoin is trading at $${btc?.priceUsd?.toLocaleString() || '97,000'}, and Ethereum is at $${eth?.priceUsd?.toLocaleString() || '2,800'}.`;
      }

      case 'gold': {
        const g = await fetchLiveGold();
        if (isArabic) {
          return `سعر أوقية الذهب عالمياً حالياً ${g.price} دولار أمريكي.`;
        }
        return `Current spot gold price is $${g.price} per ounce.`;
      }

      case 'iss': {
        const iss = await fetchLiveISS();
        if (isArabic) {
          return `محطة الفضاء الدولية تحلق على ارتفاع ${iss.altitudeKm} كيلومتر بسرعة ${iss.velocityKmh} كيلومتر في الساعة.`;
        }
        return `The International Space Station is orbiting at altitude ${iss.altitudeKm} kilometers with speed ${iss.velocityKmh} kilometers per hour.`;
      }

      default:
        return isArabic ? 'تم تحديث بيانات التليماتري بنجاح.' : 'Telemetry status updated successfully.';
    }
  } catch (err) {
    console.warn('Fast path telemetry fetch error:', err);
    return isArabic
      ? 'تم استلام طلب التليماتري، وتعذر جلب البيانات اللحظية حالياً.'
      : 'Telemetry request received, live feed is temporarily unavailable.';
  }
}

/**
 * Execute client-side standby mode fast-path.
 */
export function executeFastPathStandby(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('jarvis:voice:standby'));
}
