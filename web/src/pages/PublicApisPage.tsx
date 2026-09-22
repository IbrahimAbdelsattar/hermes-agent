import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Activity,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Filter,
  Globe,
  Key,
  Layers,
  Lock,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { cn } from "@/lib/utils";

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

export default function PublicApisPage() {
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [apis, setApis] = useState<PublicApiItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Filters
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

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Reset page on filter changes
  useEffect(() => {
    setPage(1);
  }, [selectedCategory, authFilter, httpsOnly, corsOnly]);

  // Fetch stats and categories once
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

  // Fetch APIs according to current filters & pagination
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
      showToast("Could not load public APIs catalog", "destructive");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, selectedCategory, authFilter, httpsOnly, corsOnly, page, pageSize, showToast]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    void fetchApis();
  }, [fetchApis]);

  // Sync catalog from GitHub upstream
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/public-apis/sync", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      showToast(
        `Synchronized ${result.total_apis} APIs across ${result.total_categories} categories from GitHub!`,
        "default"
      );
      void loadMetadata();
      void fetchApis();
    } catch (err) {
      console.error("Sync failed:", err);
      showToast("Sync failed. Check network connectivity.", "destructive");
    } finally {
      setSyncing(false);
    }
  };

  // Test / Ping an API endpoint
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

  // Copy API URL
  const handleCopyUrl = (url: string) => {
    void navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // Send to Jarvis / Chat page
  const handleSendToChat = (apiItem: PublicApiItem) => {
    const prompt = `Can you help me integrate and test the "${apiItem.name}" API (${apiItem.url}) in my project? Category: ${apiItem.category}. Description: ${apiItem.description}. Auth: ${apiItem.auth}.`;
    sessionStorage.setItem("hermes_prefilled_prompt", prompt);
    navigate("/chat");
  };

  // Random surprise me
  const handleSurpriseMe = async () => {
    try {
      const res = await fetch("/api/public-apis/random?count=1");
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const picked = data.items[0];
          setSearchQuery(picked.name);
          showToast(`Found: ${picked.name} (${picked.category})`, "default");
        }
      }
    } catch (err) {
      console.warn("Random API query failed:", err);
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
              1,890+ LIVE APIS
            </span>
          </div>
          <p className="text-xs text-[#80f7ff]/75 font-mono max-w-3xl leading-relaxed">
            Curated repository of free developer APIs, datasets, and endpoints synchronized from{" "}
            <a
              href="https://github.com/public-apis/public-apis.git"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00f0ff] underline hover:text-[#80f7ff] inline-flex items-center gap-0.5"
            >
              public-apis/public-apis <ExternalLink className="size-3" />
            </a>
            . Hermes Agent and Jarvis have full native access to search, discover, and integrate these services.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSurpriseMe}
            className="px-3 py-1.5 rounded-lg bg-[#0b2238] border border-[#00f0ff]/30 text-xs font-mono text-[#80f7ff] hover:text-[#00f0ff] hover:border-[#00f0ff] flex items-center gap-1.5 transition-all"
            title="Pick a random API for inspiration"
          >
            <Sparkles className="size-3.5 text-amber-300" />
            <span>Surprise Me</span>
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="bg-[#0b2238] border-[#00f0ff]/40 text-[#00f0ff] hover:bg-[#00f0ff]/20 text-xs font-mono flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,240,255,0.15)]"
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin text-[#00f0ff]")} />
            <span>{syncing ? "Syncing GitHub..." : "Sync Catalog"}</span>
          </Button>
        </div>
      </div>

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
            variant="outline"
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
            variant="outline"
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
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20"
          >
            Next
          </Button>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
