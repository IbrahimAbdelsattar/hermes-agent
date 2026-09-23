import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Activity,
  ArrowRightLeft,
  Bot,
  Check,
  CheckCircle2,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Copy,
  Cpu,
  DollarSign,
  Droplets,
  ExternalLink,
  Filter,
  Flame,
  Globe,
  Key,
  Layers,
  Lock,
  Newspaper,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  SunMedium,
  TrendingUp,
  Volume2,
  VolumeX,
  Wind,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";

export interface PublicApiItem {
  name: string;
  url: string;
  description: string;
  auth: string;
  https: boolean;
  cors: string;
  category: string;
}

export interface ApiCategory {
  category: string;
  count: number;
}

export interface ApiStats {
  total_apis: number;
  total_categories: number;
  https_count: number;
  https_percentage: number;
  no_auth_count: number;
  apikey_count: number;
  oauth_count: number;
  cors_yes_count: number;
  last_synced: string | null;
  repo_url: string;
}

interface TestPingResult {
  url: string;
  alive: boolean;
  status_code: number;
  latency_ms: number;
  note?: string;
  error?: string;
}

export interface BriefingCurrencies {
  USD_EGP: number;
  USD_SAR: number;
  USD_AED: number;
  USD_EUR: number;
  USD_GBP?: number;
  USD_KWD?: number;
  BTC_USD: number;
  GOLD_OZ_USD: number;
  GOLD_GRAM_24K_EGP: number;
  updated_at: string;
}

export interface BriefingWeather {
  city: string;
  city_ar: string;
  temp_c: number;
  apparent_temp_c: number;
  condition_en: string;
  condition_ar: string;
  icon: string;
  humidity: number;
  wind_speed_kmh: number;
  max_temp?: number;
  min_temp?: number;
  time: string;
}

export interface NewsArticle {
  title: string;
  link: string;
  source: string;
  pub_date: string;
  description: string;
}

export interface BriefingData {
  currencies: BriefingCurrencies;
  weather: BriefingWeather;
  news: {
    ai: NewsArticle[];
    economics: NewsArticle[];
    gaza: NewsArticle[];
    fundraising: NewsArticle[];
  };
  available_cities: string[];
  generated_at: string;
}

type MainTab = "briefing" | "catalog";
type NewsChannel = "ai" | "economics" | "gaza" | "fundraising";

export default function PublicApisPage() {
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  // Navigation mode
  const [activeTab, setActiveTab] = useState<MainTab>("catalog");

  // Briefing state
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState<boolean>(true);
  const [selectedCity, setSelectedCity] = useState<string>("cairo");
  const [selectedChannel, setSelectedChannel] = useState<NewsChannel>("ai");
  const [newsFilterQuery, setNewsFilterQuery] = useState<string>("");
  const [converterAmount, setConverterAmount] = useState<number>(100);
  const [summaryModalOpen, setSummaryModalOpen] = useState<boolean>(false);
  const [summaryText, setSummaryText] = useState<string>("");
  const [generatingSummary, setGeneratingSummary] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Catalog state
  const [apis, setApis] = useState<PublicApiItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Catalog Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [authFilter, setAuthFilter] = useState<string>("all");
  const [httpsOnly, setHttpsOnly] = useState<boolean>(false);
  const [corsOnly, setCorsOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const pageSize = 24;

  // View state
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [pingStates, setPingStates] = useState<Record<string, { loading: boolean; result?: TestPingResult }>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Debounce search input for catalog
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Load Briefing
  const loadBriefing = useCallback(
    async (forceRefresh = false) => {
      setBriefingLoading(true);
      try {
        const url = `/api/public-apis/briefing?city=${encodeURIComponent(selectedCity)}${
          forceRefresh ? "&refresh=true" : ""
        }`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: BriefingData = await res.json();
        setBriefing(data);
      } catch (err) {
        console.error("Failed loading briefing:", err);
        showToast("Could not load live intelligence briefing", "error");
      } finally {
        setBriefingLoading(false);
      }
    },
    [selectedCity, showToast]
  );

  useEffect(() => {
    void loadBriefing();
  }, [loadBriefing]);

  // Auto-refresh briefing every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      void loadBriefing();
    }, 300000);
    return () => clearInterval(interval);
  }, [loadBriefing]);

  // Load Catalog metadata
  const loadMetadata = useCallback(async () => {
    try {
      const [statsRes, catsRes] = await Promise.all([
        fetch("/api/public-apis/stats"),
        fetch("/api/public-apis/categories"),
      ]);
      if (statsRes.ok) {
        const sData = await statsRes.json();
        setStats(sData);
      }
      if (catsRes.ok) {
        const cData = await catsRes.json();
        setCategories(cData.categories || []);
      }
    } catch (err) {
      console.warn("Failed loading public APIs metadata:", err);
    }
  }, []);

  // Fetch Catalog APIs
  const fetchApis = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (authFilter !== "all") params.set("auth", authFilter);
      if (httpsOnly) params.set("https", "true");
      if (corsOnly) params.set("cors", "yes");
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));

      const res = await fetch(`/api/public-apis?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApis(data.items || []);
      setTotalCount(data.total || 0);
    } catch (err) {
      console.error("Failed fetching public APIs:", err);
      showToast("Could not load public APIs catalog", "error");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, selectedCategory, authFilter, httpsOnly, corsOnly, page, pageSize, showToast]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    if (activeTab === "catalog") {
      void fetchApis();
    }
  }, [activeTab, fetchApis]);

  // Sync Catalog
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/public-apis/sync", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      showToast(
        `Synchronized ${result.total_apis} APIs across ${result.total_categories} categories from GitHub!`,
        "success"
      );
      void loadMetadata();
      void fetchApis();
    } catch (err) {
      console.error("Sync failed:", err);
      showToast("Sync failed. Check network connectivity.", "error");
    } finally {
      setSyncing(false);
    }
  };

  // Test Ping
  const handleTestPing = async (apiItem: PublicApiItem) => {
    const key = apiItem.url;
    setPingStates((prev) => ({ ...prev, [key]: { loading: true } }));
    try {
      const res = await fetch("/api/public-apis/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: apiItem.url }),
      });
      const data: TestPingResult = await res.json();
      setPingStates((prev) => ({
        ...prev,
        [key]: { loading: false, result: data },
      }));
    } catch (err) {
      setPingStates((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          result: {
            url: apiItem.url,
            alive: false,
            status_code: 0,
            latency_ms: 0,
            error: String(err),
          },
        },
      }));
    }
  };

  // Copy URL
  const handleCopyUrl = (url: string) => {
    void copyTextToClipboard(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // Send API to Chat
  const handleSendToChat = (apiItem: PublicApiItem) => {
    const prompt = `Can you help me integrate and test the "${apiItem.name}" API (${apiItem.url}) in my project? Category: ${apiItem.category}. Description: ${apiItem.description}. Auth: ${apiItem.auth}.`;
    sessionStorage.setItem("hermes_prefilled_prompt", prompt);
    navigate("/chat");
  };

  // Send News Story to Chat
  const handleSendStoryToChat = (article: NewsArticle) => {
    const prompt = `Please analyze this latest development from today's intelligence briefing: "${article.title}" (Source: ${article.source}, Link: ${article.link}). What are the key takeaways, context, and implications?`;
    sessionStorage.setItem("hermes_prefilled_prompt", prompt);
    navigate("/chat");
  };

  // Surprise Me API
  const handleSurpriseMe = async () => {
    try {
      const res = await fetch("/api/public-apis/random?count=1");
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const picked = data.items[0];
          setActiveTab("catalog");
          setSearchQuery(picked.name);
          showToast(`Found: ${picked.name} (${picked.category})`, "success");
        }
      }
    } catch (err) {
      console.warn("Random API query failed:", err);
    }
  };

  // Generate Executive Summary
  const handleGenerateSummary = async () => {
    setGeneratingSummary(true);
    try {
      const res = await fetch(`/api/public-apis/briefing/summarize?city=${encodeURIComponent(selectedCity)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummaryText(data.summary || "");
      setSummaryModalOpen(true);
    } catch (err) {
      console.error("Failed generating summary:", err);
      showToast("Could not generate summary at this moment", "error");
    } finally {
      setGeneratingSummary(false);
    }
  };

  // Web Speech synthesis for audio briefing
  const handleSpeakBriefing = () => {
    if (!("speechSynthesis" in window)) {
      showToast("Web Speech is not supported in this browser", "error");
      return;
    }
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    if (!summaryText) return;

    window.speechSynthesis.cancel();
    const cleanText = summaryText.replace(/[#*_`]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "ar-EG";
    utterance.rate = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  // Filtered news articles
  const currentNewsList = useMemo(() => {
    if (!briefing?.news) return [];
    const list = briefing.news[selectedChannel] || [];
    if (!newsFilterQuery.trim()) return list;
    const q = newsFilterQuery.toLowerCase();
    return list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    );
  }, [briefing, selectedChannel, newsFilterQuery]);

  // Weather icon component helper
  const renderWeatherIcon = (iconName: string) => {
    switch (iconName) {
      case "Sun":
        return <Sun className="size-8 text-amber-400 animate-spin-slow" />;
      case "SunMedium":
        return <SunMedium className="size-8 text-amber-300" />;
      case "CloudSun":
        return <CloudSun className="size-8 text-amber-200" />;
      case "Cloud":
        return <Cloud className="size-8 text-slate-300" />;
      case "CloudFog":
        return <CloudFog className="size-8 text-slate-400" />;
      case "CloudDrizzle":
        return <CloudDrizzle className="size-8 text-cyan-300" />;
      case "CloudRain":
        return <CloudRain className="size-8 text-blue-400" />;
      case "CloudRainWind":
        return <CloudRainWind className="size-8 text-blue-500" />;
      case "CloudSnow":
        return <CloudSnow className="size-8 text-slate-100" />;
      case "CloudLightning":
        return <CloudLightning className="size-8 text-yellow-400" />;
      default:
        return <Sun className="size-8 text-amber-400" />;
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#030712] text-slate-100">
      {/* Page Header HUD */}
      <div className="bg-[#071526]/90 border border-[#00f0ff]/30 rounded-xl p-5 shadow-[0_0_20px_rgba(0,240,255,0.08)] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="size-8 rounded-lg bg-[#00f0ff]/20 border border-[#00f0ff]/40 flex items-center justify-center text-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.3)]">
              <Globe className="size-5" />
            </div>
            <h1 className="text-xl font-bold font-mono tracking-wide text-[#00f0ff] flex items-center gap-2">
              Public APIs Hub & Explorer
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-mono flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              1,890+ LIVE APIS &bull; LIVE FEEDS ONLINE
            </span>
          </div>
          <p className="text-xs text-[#80f7ff]/75 font-mono max-w-3xl leading-relaxed">
            Your live executive intelligence briefing (Currency rates, Weather, AI, Economics, Gaza, and Startups)
            plus the 1,890+ developer API catalog with instant testing and Jarvis integration.
          </p>
        </div>

        {/* Action Controls & Navigation Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Main View Switcher */}
          <div className="flex items-center bg-[#030a14] border border-[#00f0ff]/40 rounded-lg p-1 shadow-[0_0_12px_rgba(0,240,255,0.1)]">
            <button
              onClick={() => setActiveTab("briefing")}
              className={cn(
                "px-3 py-1.5 text-xs font-mono rounded-md flex items-center gap-1.5 transition-all",
                activeTab === "briefing"
                  ? "bg-[#00f0ff] text-[#030913] font-bold shadow-[0_0_10px_rgba(0,240,255,0.5)]"
                  : "text-[#80f7ff]/70 hover:text-[#00f0ff]"
              )}
            >
              <Radio className="size-3.5" />
              <span>نشرة الأخبار الذكية</span>
            </button>
            <button
              onClick={() => setActiveTab("catalog")}
              className={cn(
                "px-3 py-1.5 text-xs font-mono rounded-md flex items-center gap-1.5 transition-all",
                activeTab === "catalog"
                  ? "bg-[#00f0ff] text-[#030913] font-bold shadow-[0_0_10px_rgba(0,240,255,0.5)]"
                  : "text-[#80f7ff]/70 hover:text-[#00f0ff]"
              )}
            >
              <Layers className="size-3.5" />
              <span>دليل الـ APIs ({stats?.total_apis || "1,890+"})</span>
            </button>
          </div>

          {activeTab === "briefing" ? (
            <Button
              outlined
              size="sm"
              onClick={() => void loadBriefing(true)}
              disabled={briefingLoading}
              className="bg-[#0b2238] border-[#00f0ff]/40 text-[#00f0ff] hover:bg-[#00f0ff]/20 text-xs font-mono flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.15)]"
            >
              <RefreshCw className={cn("size-3.5", briefingLoading && "animate-spin text-[#00f0ff]")} />
              <span>{briefingLoading ? "Refreshing..." : "Refresh Live Data"}</span>
            </Button>
          ) : (
            <>
              <button
                onClick={handleSurpriseMe}
                className="px-3 py-1.5 rounded-lg bg-[#0b2238] border border-[#00f0ff]/30 text-xs font-mono text-[#80f7ff] hover:text-[#00f0ff] hover:border-[#00f0ff] flex items-center gap-1.5 transition-all"
                title="Pick a random API for inspiration"
              >
                <Sparkles className="size-3.5 text-amber-300" />
                <span>Surprise Me</span>
              </button>
              <Button
                outlined
                size="sm"
                onClick={() => void handleSync()}
                disabled={syncing}
                className="bg-[#0b2238] border-[#00f0ff]/40 text-[#00f0ff] hover:bg-[#00f0ff]/20 text-xs font-mono flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.15)]"
              >
                <RefreshCw className={cn("size-3.5", syncing && "animate-spin text-[#00f0ff]")} />
                <span>{syncing ? "Syncing..." : "Sync Catalog"}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: LIVE DAILY INTELLIGENCE & NEWS BULLETIN                            */}
      {/* ========================================================================= */}
      {activeTab === "briefing" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* 1. Live Market & Currency Ticker Bar */}
          <div className="bg-[#051122]/90 border border-[#00f0ff]/30 rounded-xl p-4 shadow-[0_0_20px_rgba(0,240,255,0.06)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#00f0ff]/15 pb-2.5">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-[#00f0ff]" />
                <span className="text-xs font-bold font-mono tracking-wider text-[#00f0ff] uppercase">
                  Live Global Markets & Currency Ticker (أسعار العملات والذهب والبيتكوين)
                </span>
              </div>
              <div className="text-[11px] font-mono text-[#80f7ff]/60 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>Real-Time Public Feed • Updated: {briefing?.currencies?.updated_at || "Just now"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* USD / EGP */}
              <div className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-lg p-3 transition-all shadow-[inset_0_0_10px_rgba(0,240,255,0.02)]">
                <div className="text-[10px] font-mono text-[#80f7ff]/60 flex items-center justify-between">
                  <span>🇺🇸/🇪🇬 USD / EGP</span>
                  <span className="text-emerald-400 font-bold">الدولار</span>
                </div>
                <div className="text-lg font-bold font-mono text-[#00f0ff] mt-1 flex items-baseline gap-1">
                  <span>{briefing?.currencies?.USD_EGP?.toFixed(2) || "51.65"}</span>
                  <span className="text-[10px] text-[#80f7ff]/60">ج.م</span>
                </div>
                <div className="text-[10px] font-mono text-emerald-400/80 mt-0.5">سعر الصرف الرسمي المباشر</div>
              </div>

              {/* USD / SAR */}
              <div className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-lg p-3 transition-all">
                <div className="text-[10px] font-mono text-[#80f7ff]/60 flex items-center justify-between">
                  <span>🇺🇸/🇸🇦 USD / SAR</span>
                  <span className="text-cyan-400 font-bold">الريال</span>
                </div>
                <div className="text-lg font-bold font-mono text-cyan-300 mt-1 flex items-baseline gap-1">
                  <span>{briefing?.currencies?.USD_SAR?.toFixed(2) || "3.75"}</span>
                  <span className="text-[10px] text-[#80f7ff]/60">ر.س</span>
                </div>
                <div className="text-[10px] font-mono text-[#80f7ff]/50 mt-0.5">الريال السعودي</div>
              </div>

              {/* USD / AED */}
              <div className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-lg p-3 transition-all">
                <div className="text-[10px] font-mono text-[#80f7ff]/60 flex items-center justify-between">
                  <span>🇺🇸/🇦🇪 USD / AED</span>
                  <span className="text-teal-400 font-bold">الدرهم</span>
                </div>
                <div className="text-lg font-bold font-mono text-teal-300 mt-1 flex items-baseline gap-1">
                  <span>{briefing?.currencies?.USD_AED?.toFixed(2) || "3.67"}</span>
                  <span className="text-[10px] text-[#80f7ff]/60">د.إ</span>
                </div>
                <div className="text-[10px] font-mono text-[#80f7ff]/50 mt-0.5">الدرهم الإماراتي</div>
              </div>

              {/* USD / EUR */}
              <div className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-lg p-3 transition-all">
                <div className="text-[10px] font-mono text-[#80f7ff]/60 flex items-center justify-between">
                  <span>🇺🇸/🇪🇺 USD / EUR</span>
                  <span className="text-blue-400 font-bold">اليورو</span>
                </div>
                <div className="text-lg font-bold font-mono text-blue-300 mt-1 flex items-baseline gap-1">
                  <span>{briefing?.currencies?.USD_EUR?.toFixed(4) || "0.8732"}</span>
                  <span className="text-[10px] text-[#80f7ff]/60">€</span>
                </div>
                <div className="text-[10px] font-mono text-[#80f7ff]/50 mt-0.5">اليورو الأوروبي</div>
              </div>

              {/* Bitcoin */}
              <div className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-lg p-3 transition-all">
                <div className="text-[10px] font-mono text-[#80f7ff]/60 flex items-center justify-between">
                  <span>₿ Bitcoin (BTC)</span>
                  <span className="text-amber-400 font-bold">كريبتو</span>
                </div>
                <div className="text-lg font-bold font-mono text-amber-300 mt-1 flex items-baseline gap-1">
                  <span>${briefing?.currencies?.BTC_USD?.toLocaleString() || "85,750"}</span>
                </div>
                <div className="text-[10px] font-mono text-amber-400/80 mt-0.5">Spot Price USDT</div>
              </div>

              {/* Gold */}
              <div className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-lg p-3 transition-all">
                <div className="text-[10px] font-mono text-[#80f7ff]/60 flex items-center justify-between">
                  <span>🪙 Gold (XAU)</span>
                  <span className="text-yellow-400 font-bold">الذهب</span>
                </div>
                <div className="text-lg font-bold font-mono text-yellow-300 mt-1 flex items-baseline gap-1">
                  <span>${briefing?.currencies?.GOLD_OZ_USD?.toLocaleString() || "4,316"}</span>
                  <span className="text-[10px] text-[#80f7ff]/60">/oz</span>
                </div>
                <div className="text-[10px] font-mono text-yellow-400/80 mt-0.5">
                  عيار 24: ~{briefing?.currencies?.GOLD_GRAM_24K_EGP?.toLocaleString() || "7,160"} ج.م/غ
                </div>
              </div>
            </div>
          </div>

          {/* 2. Interactive Weather Card & Currency Converter */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Weather Station (5 cols) */}
            <div className="lg:col-span-5 bg-[#051122]/90 border border-[#00f0ff]/25 rounded-xl p-4 shadow-[0_0_15px_rgba(0,240,255,0.04)] flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-[#00f0ff]/10 pb-2.5">
                <div className="flex items-center gap-2">
                  <CloudSun className="size-4 text-[#00f0ff]" />
                  <span className="text-xs font-bold font-mono text-[#00f0ff]">
                    Live Weather Station (محطة الطقس)
                  </span>
                </div>
                {/* City Preset Selector */}
                <select
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                  className="bg-[#030914] border border-[#00f0ff]/30 text-xs text-[#00f0ff] px-2.5 py-1 rounded outline-none font-mono cursor-pointer"
                >
                  <option value="cairo">Cairo (القاهرة)</option>
                  <option value="alexandria">Alexandria (الإسكندرية)</option>
                  <option value="riyadh">Riyadh (الرياض)</option>
                  <option value="dubai">Dubai (دبي)</option>
                  <option value="london">London (لندن)</option>
                  <option value="newyork">New York (نيويورك)</option>
                </select>
              </div>

              {briefingLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Spinner className="size-6 text-[#00f0ff]" />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="flex items-center gap-3.5">
                    {renderWeatherIcon(briefing?.weather?.icon || "Sun")}
                    <div>
                      <div className="text-3xl font-extrabold font-mono text-white flex items-start gap-1">
                        <span>{briefing?.weather?.temp_c ?? 31.5}</span>
                        <span className="text-sm font-normal text-[#00f0ff]">°C</span>
                      </div>
                      <div className="text-xs font-mono text-[#00f0ff] font-medium">
                        {briefing?.weather?.condition_ar || "سماء صافية"} • {briefing?.weather?.condition_en || "Clear"}
                      </div>
                    </div>
                  </div>

                  <div className="text-right space-y-1 font-mono text-xs text-[#80f7ff]/80">
                    <div className="text-[11px] text-[#80f7ff]/60">
                      المحسوسة: <span className="text-white font-bold">{briefing?.weather?.apparent_temp_c}°C</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[11px]">
                      <Droplets className="size-3 text-cyan-300" />
                      <span>رطوبة: {briefing?.weather?.humidity}%</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[11px]">
                      <Wind className="size-3 text-teal-300" />
                      <span>رياح: {briefing?.weather?.wind_speed_kmh} كم/س</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-[#00f0ff]/10 flex items-center justify-between text-[11px] font-mono text-[#80f7ff]/60">
                <span>Location: {briefing?.weather?.city} ({briefing?.weather?.city_ar})</span>
                <span className="text-emerald-400">Open-Meteo High Accuracy</span>
              </div>
            </div>

            {/* Quick Currency Converter (4 cols) */}
            <div className="lg:col-span-4 bg-[#051122]/90 border border-[#00f0ff]/25 rounded-xl p-4 shadow-[0_0_15px_rgba(0,240,255,0.04)] flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-[#00f0ff]/10 pb-2.5">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="size-4 text-[#00f0ff]" />
                  <span className="text-xs font-bold font-mono text-[#00f0ff]">
                    Quick Converter (محول العملات السريع)
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#80f7ff]/50">1 USD = {briefing?.currencies?.USD_EGP || 51.65} EGP</span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 bg-[#030914] border border-[#00f0ff]/30 rounded-lg px-3 py-1.5">
                  <DollarSign className="size-4 text-[#00f0ff]" />
                  <input
                    type="number"
                    min="1"
                    value={converterAmount}
                    onChange={(e) => setConverterAmount(Number(e.target.value) || 0)}
                    placeholder="Enter USD..."
                    className="w-full bg-transparent text-sm font-mono text-[#00f0ff] outline-none font-bold"
                  />
                  <span className="text-xs font-mono text-[#80f7ff]/60">USD</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-[#030914] border border-[#00f0ff]/15 rounded p-2">
                    <span className="text-[10px] text-[#80f7ff]/60">🇪🇬 EGP (جنيه):</span>
                    <div className="text-sm font-bold text-emerald-400">
                      {((converterAmount || 0) * (briefing?.currencies?.USD_EGP || 51.65)).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}
                    </div>
                  </div>
                  <div className="bg-[#030914] border border-[#00f0ff]/15 rounded p-2">
                    <span className="text-[10px] text-[#80f7ff]/60">🇸🇦 SAR (ريال):</span>
                    <div className="text-sm font-bold text-cyan-300">
                      {((converterAmount || 0) * (briefing?.currencies?.USD_SAR || 3.75)).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-[10px] font-mono text-[#80f7ff]/50 flex items-center justify-between pt-1">
                <span>🇦🇪 AED: {((converterAmount || 0) * (briefing?.currencies?.USD_AED || 3.67)).toFixed(1)}</span>
                <span>🇪🇺 EUR: {((converterAmount || 0) * (briefing?.currencies?.USD_EUR || 0.87)).toFixed(1)}</span>
              </div>
            </div>

            {/* Jarvis Morning Briefing Card (3 cols) */}
            <div className="lg:col-span-3 bg-gradient-to-br from-[#06192e] to-[#040e1c] border border-[#00f0ff]/40 rounded-xl p-4 shadow-[0_0_20px_rgba(0,240,255,0.08)] flex flex-col justify-between space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-[#00f0ff]" />
                  <span className="text-xs font-bold font-mono text-[#00f0ff]">Jarvis Intelligence</span>
                </div>
                <p className="text-[11px] font-mono text-[#80f7ff]/75 leading-relaxed">
                  Synthesize today&apos;s headlines, economic indicators, and war updates into an executive 1-minute audio/text digest.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => void handleGenerateSummary()}
                  disabled={generatingSummary}
                  className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-[#00f0ff] to-[#0088ff] text-[#030914] font-mono font-bold text-xs hover:shadow-[0_0_15px_rgba(0,240,255,0.4)] flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {generatingSummary ? (
                    <Spinner className="size-3.5 text-[#030914]" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  <span>{generatingSummary ? "Compiling..." : "Generate AI Briefing"}</span>
                </button>

                <button
                  onClick={() => {
                    const prompt = `Give me a full comprehensive morning briefing on today's dollar rate in Egypt, Middle East news, latest AI research, and tech startups fundraising.`;
                    sessionStorage.setItem("hermes_prefilled_prompt", prompt);
                    navigate("/chat");
                  }}
                  className="w-full py-1.5 px-3 rounded-lg bg-[#071d33] border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20 font-mono text-[11px] flex items-center justify-center gap-1.5 transition-all"
                >
                  <Send className="size-3" />
                  <span>Deep Brief in Chat</span>
                </button>
              </div>
            </div>
          </div>

          {/* 3. 4-Channel Live News Bulletin Section */}
          <div className="bg-[#051122]/90 border border-[#00f0ff]/25 rounded-xl p-4 sm:p-5 shadow-[0_0_20px_rgba(0,240,255,0.06)] space-y-4">
            {/* Channel Tabs & Search Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 border-b border-[#00f0ff]/15 pb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  {
                    id: "ai" as NewsChannel,
                    labelEn: "AI & Tech",
                    labelAr: "الذكاء الاصطناعي",
                    icon: Cpu,
                    badgeColor: "text-cyan-300 border-cyan-400/40 bg-cyan-500/10",
                  },
                  {
                    id: "economics" as NewsChannel,
                    labelEn: "Economics & Markets",
                    labelAr: "الاقتصاد والأسواق",
                    icon: TrendingUp,
                    badgeColor: "text-emerald-300 border-emerald-400/40 bg-emerald-500/10",
                  },
                  {
                    id: "gaza" as NewsChannel,
                    labelEn: "Gaza & Palestine",
                    labelAr: "الحرب على غزة",
                    icon: Flame,
                    badgeColor: "text-rose-300 border-rose-400/40 bg-rose-500/10",
                  },
                  {
                    id: "fundraising" as NewsChannel,
                    labelEn: "Startups & VC",
                    labelAr: "الاستثمار وريادة الأعمال",
                    icon: Rocket,
                    badgeColor: "text-amber-300 border-amber-400/40 bg-amber-500/10",
                  },
                ].map((channel) => {
                  const Icon = channel.icon;
                  const isSelected = selectedChannel === channel.id;
                  const count = briefing?.news?.[channel.id]?.length || 0;
                  return (
                    <button
                      key={channel.id}
                      onClick={() => {
                        setSelectedChannel(channel.id);
                        setNewsFilterQuery("");
                      }}
                      className={cn(
                        "px-3 py-2 rounded-lg text-xs font-mono flex items-center gap-2 transition-all border",
                        isSelected
                          ? "bg-[#00f0ff]/20 border-[#00f0ff] text-[#00f0ff] font-bold shadow-[0_0_12px_rgba(0,240,255,0.25)]"
                          : "bg-[#030914] border-[#00f0ff]/20 text-[#80f7ff]/60 hover:text-[#00f0ff] hover:border-[#00f0ff]/40"
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{channel.labelAr}</span>
                      <span className="text-[10px] text-[#80f7ff]/50">({channel.labelEn})</span>
                      <span className={cn("px-1.5 py-0.2 rounded-full text-[10px] border", channel.badgeColor)}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* In-channel search */}
              <div className="relative w-full md:w-64">
                <Search className="size-3.5 text-[#00f0ff]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={newsFilterQuery}
                  onChange={(e) => setNewsFilterQuery(e.target.value)}
                  placeholder="Filter news stories..."
                  className="w-full bg-[#030914] border border-[#00f0ff]/30 focus:border-[#00f0ff] text-xs text-[#00f0ff] pl-8 pr-7 py-1.5 rounded-lg outline-none placeholder-[#80f7ff]/40 font-mono"
                />
                {newsFilterQuery && (
                  <button
                    onClick={() => setNewsFilterQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Articles Grid */}
            {briefingLoading ? (
              <div className="flex flex-col items-center justify-center p-16 space-y-3">
                <Spinner className="size-8 text-[#00f0ff]" />
                <p className="text-xs font-mono text-[#80f7ff]/60">Streaming live intelligence feeds...</p>
              </div>
            ) : currentNewsList.length === 0 ? (
              <div className="p-12 text-center text-xs font-mono text-[#80f7ff]/60 space-y-2">
                <Newspaper className="size-8 text-[#00f0ff]/40 mx-auto" />
                <div>No news stories matching your filter.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {currentNewsList.map((article, idx) => (
                  <div
                    key={`${article.link}-${idx}`}
                    className="bg-[#030914] border border-[#00f0ff]/20 hover:border-[#00f0ff]/60 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all duration-200 hover:shadow-[0_0_16px_rgba(0,240,255,0.08)] group"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#80f7ff]/60">
                        <span className="px-2 py-0.5 rounded bg-[#07192c] border border-[#00f0ff]/30 text-[#00f0ff] font-medium">
                          {article.source || "News Feed"}
                        </span>
                        <span>{article.pub_date ? article.pub_date.split(" ").slice(0, 4).join(" ") : "Today"}</span>
                      </div>

                      <h3 className="text-xs sm:text-sm font-bold font-mono text-slate-100 group-hover:text-[#00f0ff] transition-colors line-clamp-3 leading-snug">
                        {article.title}
                      </h3>

                      {article.description && (
                        <p className="text-[11px] text-[#80f7ff]/70 font-mono line-clamp-2 leading-relaxed">
                          {article.description}
                        </p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-[#00f0ff]/10 flex items-center justify-between gap-2">
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded bg-[#07192c] border border-[#00f0ff]/30 text-[11px] font-mono text-[#00f0ff] hover:bg-[#00f0ff]/20 flex items-center gap-1 transition-colors"
                      >
                        <span>Read Source</span>
                        <ExternalLink className="size-3" />
                      </a>

                      <button
                        onClick={() => handleSendStoryToChat(article)}
                        title="Analyze and discuss this story with Jarvis"
                        className="px-2.5 py-1 rounded bg-gradient-to-r from-[#00f0ff]/20 to-[#0088ff]/20 border border-[#00f0ff]/40 text-[11px] font-mono text-[#00f0ff] hover:border-[#00f0ff] flex items-center gap-1.5 transition-all"
                      >
                        <Bot className="size-3" />
                        <span>Discuss with Jarvis</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Executive Summary Modal */}
          {summaryModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#051122] border border-[#00f0ff]/50 rounded-xl max-w-2xl w-full p-5 shadow-[0_0_30px_rgba(0,240,255,0.2)] space-y-4 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-[#00f0ff]/20 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-[#00f0ff]" />
                    <h3 className="text-sm font-bold font-mono text-[#00f0ff]">
                      Jarvis Executive Morning Briefing (الموجز الإخباري الذكي)
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      if (isSpeaking) window.speechSynthesis.cancel();
                      setIsSpeaking(false);
                      setSummaryModalOpen(false);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="bg-[#030914] border border-[#00f0ff]/20 rounded-lg p-4 font-mono text-xs text-slate-100 whitespace-pre-line leading-relaxed max-h-96 overflow-y-auto">
                  {summaryText}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#00f0ff]/15">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      outlined
                      onClick={handleSpeakBriefing}
                      className={cn(
                        "font-mono text-xs flex items-center gap-1.5",
                        isSpeaking
                          ? "bg-amber-500/20 border-amber-400 text-amber-300"
                          : "border-[#00f0ff]/40 text-[#00f0ff] hover:bg-[#00f0ff]/20"
                      )}
                    >
                      {isSpeaking ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                      <span>{isSpeaking ? "Stop Voice" : "Listen Aloud (قراءة صوتية)"}</span>
                    </Button>

                    <Button
                      size="sm"
                      outlined
                      onClick={() => {
                        void copyTextToClipboard(summaryText);
                        showToast("Copied executive brief to clipboard", "success");
                      }}
                      className="border-[#00f0ff]/40 text-[#00f0ff] hover:bg-[#00f0ff]/20 font-mono text-xs flex items-center gap-1.5"
                    >
                      <Copy className="size-3.5" />
                      <span>Copy Text</span>
                    </Button>
                  </div>

                  <button
                    onClick={() => {
                      sessionStorage.setItem("hermes_prefilled_prompt", summaryText);
                      setSummaryModalOpen(false);
                      navigate("/chat");
                    }}
                    className="py-1.5 px-3 rounded-lg bg-gradient-to-r from-[#00f0ff] to-[#0088ff] text-[#030914] font-mono font-bold text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,240,255,0.3)]"
                  >
                    <Send className="size-3" />
                    <span>Open in Jarvis Chat</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PUBLIC APIS DIRECTORY CATALOG (1,890+ APIS)                        */}
      {/* ========================================================================= */}
      {activeTab === "catalog" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* Telemetry Stats Grid */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="bg-[#040e1a]/80 border border-[#00f0ff]/20 rounded-xl p-3 shadow-[0_0_10px_rgba(0,240,255,0.03)]">
                <div className="text-[10px] font-mono uppercase text-[#80f7ff]/60 flex items-center gap-1.5">
                  <Layers className="size-3 text-[#00f0ff]" /> Total APIs
                </div>
                <div className="text-xl font-bold font-mono text-[#00f0ff] mt-0.5">
                  {stats.total_apis.toLocaleString()}
                </div>
              </div>

              <div className="bg-[#040e1a]/80 border border-[#00f0ff]/20 rounded-xl p-3 shadow-[0_0_10px_rgba(0,240,255,0.03)]">
                <div className="text-[10px] font-mono uppercase text-[#80f7ff]/60 flex items-center gap-1.5">
                  <Filter className="size-3 text-cyan-400" /> Categories
                </div>
                <div className="text-xl font-bold font-mono text-cyan-300 mt-0.5">
                  {stats.total_categories}
                </div>
              </div>

              <div className="bg-[#040e1a]/80 border border-[#00f0ff]/20 rounded-xl p-3 shadow-[0_0_10px_rgba(0,240,255,0.03)]">
                <div className="text-[10px] font-mono uppercase text-emerald-400/70 flex items-center gap-1.5">
                  <Zap className="size-3 text-emerald-400" /> No Auth (Free)
                </div>
                <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                  {stats.no_auth_count.toLocaleString()}
                </div>
              </div>

              <div className="bg-[#040e1a]/80 border border-[#00f0ff]/20 rounded-xl p-3 shadow-[0_0_10px_rgba(0,240,255,0.03)]">
                <div className="text-[10px] font-mono uppercase text-teal-400/70 flex items-center gap-1.5">
                  <ShieldCheck className="size-3 text-teal-400" /> HTTPS Supported
                </div>
                <div className="text-xl font-bold font-mono text-teal-300 mt-0.5">
                  {stats.https_percentage}%
                </div>
              </div>

              <div className="bg-[#040e1a]/80 border border-[#00f0ff]/20 rounded-xl p-3 shadow-[0_0_10px_rgba(0,240,255,0.03)] col-span-2 sm:col-span-1">
                <div className="text-[10px] font-mono uppercase text-amber-400/70 flex items-center gap-1.5">
                  <Key className="size-3 text-amber-400" /> API Key / OAuth
                </div>
                <div className="text-xl font-bold font-mono text-amber-300 mt-0.5">
                  {(stats.apikey_count + stats.oauth_count).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {/* Filter Toolbar */}
          <div className="bg-[#071526]/80 border border-[#00f0ff]/20 rounded-xl p-4 space-y-3">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Search bar */}
              <div className="relative flex-1">
                <Search className="size-4 text-[#00f0ff]/60 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search across 1,890+ APIs (e.g. weather, bitcoin, dogs, github, spotify, geocoding)..."
                  className="w-full bg-[#030a14] border border-[#00f0ff]/30 focus:border-[#00f0ff] text-xs text-[#00f0ff] pl-9.5 pr-8 py-2.5 rounded-lg outline-none placeholder-[#80f7ff]/40 font-mono shadow-[inset_0_0_10px_rgba(0,240,255,0.05)] transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Category Dropdown */}
              <div className="flex items-center gap-2">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-[#030a14] border border-[#00f0ff]/30 focus:border-[#00f0ff] text-xs text-[#00f0ff] px-3 py-2 rounded-lg outline-none font-mono cursor-pointer"
                >
                  <option value="all">All Categories ({stats?.total_categories || 52})</option>
                  {categories.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.category} ({c.count})
                    </option>
                  ))}
                </select>

                {/* View Mode Toggle */}
                <div className="hidden sm:flex items-center bg-[#030a14] border border-[#00f0ff]/30 rounded-lg p-0.5">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-mono rounded",
                      viewMode === "grid"
                        ? "bg-[#00f0ff]/20 text-[#00f0ff] font-bold"
                        : "text-[#80f7ff]/50 hover:text-[#00f0ff]"
                    )}
                  >
                    Cards
                  </button>
                  <button
                    onClick={() => setViewMode("table")}
                    className={cn(
                      "px-2.5 py-1 text-xs font-mono rounded",
                      viewMode === "table"
                        ? "bg-[#00f0ff]/20 text-[#00f0ff] font-bold"
                        : "text-[#80f7ff]/50 hover:text-[#00f0ff]"
                    )}
                  >
                    Table
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Filter Badges */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#00f0ff]/10 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#80f7ff]/50 mr-1">Auth Requirement:</span>
                {[
                  { id: "all", label: "All" },
                  { id: "free", label: "Free / No Key" },
                  { id: "apiKey", label: "API Key" },
                  { id: "OAuth", label: "OAuth" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setAuthFilter(tab.id)}
                    className={cn(
                      "px-2.5 py-1 rounded text-[11px] border transition-all",
                      authFilter === tab.id
                        ? "bg-[#00f0ff]/20 border-[#00f0ff] text-[#00f0ff] font-bold shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                        : "bg-[#030a14] border-[#00f0ff]/20 text-[#80f7ff]/60 hover:text-[#00f0ff] hover:border-[#00f0ff]/40"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#80f7ff]/80">
                  <input
                    type="checkbox"
                    checked={httpsOnly}
                    onChange={(e) => setHttpsOnly(e.target.checked)}
                    className="accent-[#00f0ff] size-3.5 rounded"
                  />
                  <span>HTTPS Only</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#80f7ff]/80">
                  <input
                    type="checkbox"
                    checked={corsOnly}
                    onChange={(e) => setCorsOnly(e.target.checked)}
                    className="accent-[#00f0ff] size-3.5 rounded"
                  />
                  <span>CORS: Yes</span>
                </label>
              </div>
            </div>
          </div>

          {/* Results Header */}
          <div className="flex items-center justify-between text-xs font-mono text-[#80f7ff]/60 px-1">
            <div>
              Showing <span className="text-[#00f0ff] font-bold">{apis.length}</span> of{" "}
              <span className="text-[#00f0ff] font-bold">{totalCount}</span> public APIs
              {selectedCategory !== "all" && <span> in category &quot;{selectedCategory}&quot;</span>}
              {debouncedSearch && <span> matching &quot;{debouncedSearch}&quot;</span>}
            </div>
            {totalPages > 1 && (
              <div>
                Page {page} of {totalPages}
              </div>
            )}
          </div>

          {/* Loading state */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-16 space-y-3">
              <Spinner className="size-8 text-[#00f0ff]" />
              <p className="text-xs font-mono text-[#80f7ff]/60">Scanning public APIs catalog...</p>
            </div>
          ) : apis.length === 0 ? (
            <div className="bg-[#071526]/40 border border-[#00f0ff]/20 rounded-xl p-12 text-center space-y-3">
              <Globe className="size-10 text-[#00f0ff]/40 mx-auto" />
              <h3 className="text-sm font-bold font-mono text-[#00f0ff]">No matching public APIs found</h3>
              <p className="text-xs font-mono text-[#80f7ff]/60 max-w-md mx-auto">
                Try adjusting your search query, clearing filters, or picking &quot;All Categories&quot;.
              </p>
              <Button
                size="sm"
                outlined
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                  setAuthFilter("all");
                  setHttpsOnly(false);
                  setCorsOnly(false);
                }}
                className="border-[#00f0ff]/40 text-[#00f0ff] hover:bg-[#00f0ff]/20 font-mono text-xs"
              >
                Clear All Filters
              </Button>
            </div>
          ) : viewMode === "grid" ? (
            /* Card Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {apis.map((apiItem) => {
                const pingInfo = pingStates[apiItem.url];
                const isCopied = copiedUrl === apiItem.url;
                return (
                  <div
                    key={`${apiItem.category}-${apiItem.name}-${apiItem.url}`}
                    className="bg-[#051122]/80 border border-[#00f0ff]/20 hover:border-[#00f0ff]/50 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all duration-200 hover:shadow-[0_0_16px_rgba(0,240,255,0.08)] group"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold font-mono text-[#00f0ff] group-hover:text-cyan-300 transition-colors flex items-center gap-1.5">
                            {apiItem.name}
                          </h3>
                          <span className="text-[10px] font-mono text-cyan-400/70 uppercase">
                            {apiItem.category}
                          </span>
                        </div>

                        {/* Auth Badge */}
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-mono font-medium",
                            apiItem.auth.toLowerCase() === "no" || !apiItem.auth
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                              : "bg-amber-500/20 text-amber-300 border border-amber-400/40"
                          )}
                        >
                          {apiItem.auth.toLowerCase() === "no" || !apiItem.auth ? "Free / No Key" : apiItem.auth}
                        </span>
                      </div>

                      <p className="text-xs text-[#80f7ff]/75 font-mono line-clamp-3 leading-relaxed">
                        {apiItem.description}
                      </p>
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-[#00f0ff]/10">
                      {/* Protocol Tags */}
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex items-center gap-1",
                              apiItem.https ? "text-emerald-400" : "text-rose-400"
                            )}
                          >
                            <Lock className="size-2.5" />
                            {apiItem.https ? "HTTPS" : "HTTP"}
                          </span>
                          <span className="text-[#80f7ff]/40">•</span>
                          <span className="text-[#80f7ff]/70">
                            CORS: <span className="text-[#00f0ff]">{apiItem.cors}</span>
                          </span>
                        </div>

                        {/* Live Ping status badge if tested */}
                        {pingInfo?.result && (
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] flex items-center gap-1",
                              pingInfo.result.alive
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            )}
                          >
                            {pingInfo.result.alive ? (
                              <>
                                <CheckCircle2 className="size-2.5 text-emerald-400" />
                                {pingInfo.result.status_code || 200} ({pingInfo.result.latency_ms}ms)
                              </>
                            ) : (
                              <>
                                <XCircle className="size-2.5 text-rose-400" /> Offline
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5">
                        <a
                          href={apiItem.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 px-2 py-1.5 rounded-lg bg-[#07192c] border border-[#00f0ff]/30 text-xs font-mono text-[#00f0ff] hover:bg-[#00f0ff]/20 flex items-center justify-center gap-1.5 transition-colors text-center"
                        >
                          <span>Docs</span>
                          <ExternalLink className="size-3" />
                        </a>

                        <button
                          onClick={() => void handleTestPing(apiItem)}
                          disabled={pingInfo?.loading}
                          title="Test if API responds"
                          className="px-2.5 py-1.5 rounded-lg bg-[#07192c] border border-[#00f0ff]/30 text-xs font-mono text-[#80f7ff] hover:text-[#00f0ff] hover:border-[#00f0ff] flex items-center justify-center transition-colors disabled:opacity-50"
                        >
                          {pingInfo?.loading ? (
                            <Spinner className="size-3 text-[#00f0ff]" />
                          ) : (
                            <Activity className="size-3.5 text-cyan-300" />
                          )}
                        </button>

                        <button
                          onClick={() => handleCopyUrl(apiItem.url)}
                          title="Copy endpoint URL"
                          className="px-2.5 py-1.5 rounded-lg bg-[#07192c] border border-[#00f0ff]/30 text-xs font-mono text-[#80f7ff] hover:text-[#00f0ff] hover:border-[#00f0ff] flex items-center justify-center transition-colors"
                        >
                          {isCopied ? (
                            <Check className="size-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </button>

                        <button
                          onClick={() => handleSendToChat(apiItem)}
                          title="Ask Jarvis / Hermes Agent to integrate this API"
                          className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-[#00f0ff] to-[#0088ff] text-[#040d1a] hover:shadow-[0_0_12px_rgba(0,240,255,0.4)] flex items-center justify-center transition-all font-bold text-xs"
                        >
                          <Send className="size-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View */
            <div className="bg-[#051122]/90 border border-[#00f0ff]/20 rounded-xl overflow-x-auto shadow-[0_0_16px_rgba(0,240,255,0.05)]">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#030913] border-b border-[#00f0ff]/20 text-[#00f0ff] text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">API Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Auth</th>
                    <th className="px-4 py-3">HTTPS</th>
                    <th className="px-4 py-3">CORS</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#00f0ff]/10">
                  {apis.map((apiItem) => (
                    <tr key={`${apiItem.category}-${apiItem.name}`} className="hover:bg-[#00f0ff]/5 transition-colors">
                      <td className="px-4 py-3 font-bold text-[#00f0ff] whitespace-nowrap">
                        {apiItem.name}
                      </td>
                      <td className="px-4 py-3 text-cyan-300/80 whitespace-nowrap">
                        {apiItem.category}
                      </td>
                      <td className="px-4 py-3 text-[#80f7ff]/75 max-w-md truncate">
                        {apiItem.description}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px]",
                            apiItem.auth.toLowerCase() === "no" || !apiItem.auth
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-amber-500/20 text-amber-300"
                          )}
                        >
                          {apiItem.auth.toLowerCase() === "no" || !apiItem.auth ? "Free" : apiItem.auth}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={apiItem.https ? "text-emerald-400" : "text-rose-400"}>
                          {apiItem.https ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#80f7ff]/80 whitespace-nowrap">
                        {apiItem.cors}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <a
                            href={apiItem.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-[#00f0ff] hover:text-white"
                            title="Open Docs"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                          <button
                            onClick={() => handleSendToChat(apiItem)}
                            className="p-1 text-[#00f0ff] hover:text-white"
                            title="Ask Jarvis to integrate"
                          >
                            <Send className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-[#00f0ff]/20 font-mono text-xs">
              <Button
                size="sm"
                outlined
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20"
              >
                Previous
              </Button>

              <span className="text-[#80f7ff]/70">
                Page {page} of {totalPages}
              </span>

              <Button
                size="sm"
                outlined
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}
