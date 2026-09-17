import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic, Bot, Music2, Globe, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { usePageHeader } from "@/contexts/usePageHeader";
import { cn } from "@/lib/utils";
import { LiveVoiceCallWidget, type VoicePersona } from "@/components/LiveVoiceCallWidget";
import { JarvisCoreWidget } from "@/components/JarvisCoreWidget";
import { MusicPlayerWidget } from "@/components/MusicPlayerWidget";
import { LiveWorldFeedWidget } from "@/components/LiveWorldFeedWidget";
import { GatewayClient } from "@/lib/gatewayClient";

export type JarvisTab = "call" | "core" | "music" | "feed";

export default function JarvisCallPage() {
  const { setEnd } = usePageHeader();
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from URL path or search query
  const getInitialTab = (): JarvisTab => {
    const path = location.pathname;
    if (path.includes("/jarvis-core")) return "core";
    if (path.includes("/jarvis-music")) return "music";
    if (path.includes("/jarvis-feed")) return "feed";
    if (path.includes("/jarvis-call")) return "call";

    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    if (tabParam === "core" || tabParam === "music" || tabParam === "feed" || tabParam === "call") {
      return tabParam;
    }
    return "call";
  };

  const [activeTab, setActiveTab] = useState<JarvisTab>(getInitialTab);

  useEffect(() => {
    setActiveTab(getInitialTab());
  }, [location.pathname, location.search]);

  const handleTabChange = (tab: JarvisTab) => {
    setActiveTab(tab);
    navigate(`/jarvis?tab=${tab}`, { replace: true });
  };

  const gatewayRef = useRef<GatewayClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    setEnd(
      <div className="flex items-center gap-2 text-xs font-mono text-[#00f0ff]">
        <Sparkles className="size-3.5 animate-pulse text-[#ffb700]" />
        <span>JARVIS COMMAND CENTER</span>
      </div>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd]);

  useEffect(() => {
    const gw = new GatewayClient();
    gatewayRef.current = gw;
    gw.connect().catch((err) => {
      console.warn("[jarvis] Gateway connection deferred or offline:", err);
    });

    return () => {
      gw.close();
      gatewayRef.current = null;
    };
  }, []);

  const handleSendMessage = useCallback(async (text: string, persona: VoicePersona = "jarvis"): Promise<string> => {
    const gw = gatewayRef.current;
    if (!gw) {
      throw new Error("Gateway client not initialized");
    }

    if (gw.connectionState !== "open") {
      await gw.connect();
    }

    let sid = sessionIdRef.current;
    if (!sid) {
      const created = await gw.request<{ session_id: string }>("session.create", {
        title: `Jarvis Assistant (${persona === "gwen" ? "Gwen" : "Jarvis Mark 85"})`,
      });
      sid = created.session_id;
      sessionIdRef.current = sid;
    }

    return new Promise<string>((resolve, reject) => {
      let fullText = "";
      const timeout = setTimeout(() => {
        cleanup();
        if (fullText.trim()) {
          resolve(fullText.trim());
        } else {
          sessionIdRef.current = null;
          reject(new Error("Voice response timed out"));
        }
      }, 45000);

      const offDelta = gw.on("message.delta", (ev) => {
        if (ev.session_id === sid && ev.payload?.text) {
          fullText += ev.payload.text;
        }
      });

      const offComplete = gw.on("message.complete", (ev) => {
        if (ev.session_id === sid) {
          cleanup();
          const finalReply = fullText.trim() || String(ev.payload?.text || '').trim();
          resolve(
            finalReply ||
              (persona === "gwen"
                ? "تمام يا باشا، كل شيء جاهز وتحت السيطرة!"
                : "Understood, sir. Systems operational and standing by.")
          );
        }
      });

      const offError = gw.on("error", (ev) => {
        if (ev.session_id === sid) {
          cleanup();
          sessionIdRef.current = null;
          reject(new Error("Agent error received"));
        }
      });

      function cleanup() {
        clearTimeout(timeout);
        offDelta();
        offComplete();
        offError();
      }

      const isAr = /[\u0600-\u06FF]/.test(text);
      const personaInstruction = isAr
        ? `[تعليمات المكالمة الصوتية الحية: أنت في محادثة صوتية تفاعلية. أجب بإيجاز شديد في جملة أو جملتين فقط بلهجة مصرية مهذبة كشخصية ${persona === 'gwen' ? 'جوين' : 'جارفيس'}. ممنوع تماماً استخدام أي ماركداون أو رموز أو قوائم.] `
        : `[VOICE CALL MODE: Interactive voice call. Respond concisely in 1-2 spoken sentences only as ${persona === 'gwen' ? 'Gwen' : 'Jarvis'}. Absolutely no markdown, no symbols, no bullet lists.] `;

      gw.request("prompt.submit", { session_id: sid, text: `${personaInstruction}${text}` }).catch((err) => {
        cleanup();
        sessionIdRef.current = null;
        reject(err);
      });
    });
  }, []);

  return (
    <div
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6 space-y-4",
        "bg-[#030712] text-slate-100",
      )}
    >
      {/* Top Navigation Tabs Header */}
      <div className="bg-[#071526]/90 border border-[#00f0ff]/30 rounded-xl p-4 shadow-[0_0_20px_rgba(0,240,255,0.1)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#00f0ff] font-bold text-lg font-mono">
            <Sparkles className="size-5 text-[#ffb700] animate-pulse" />
            <span>J.A.R.V.I.S. Executive OS & Autonomous Hub</span>
          </div>
          <p className="text-xs text-[#80f7ff]/70 mt-1 max-w-2xl font-mono">
            Live Voice Sentinel, Chief of Staff AI Assistant, Holographic Audio Deck & Real-time Global Feeds integrated directly into Hermes Agent.
          </p>
        </div>

        {/* Tab Switcher Buttons */}
        <div className="flex items-center gap-1.5 bg-[#020b14] p-1.5 rounded-xl border border-[#00f0ff]/30 font-mono text-xs">
          <button
            onClick={() => handleTabChange("call")}
            className={cn(
              "px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all",
              activeTab === "call"
                ? "bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_12px_rgba(0,240,255,0.4)] border border-[#00f0ff]/40"
                : "text-[#80f7ff]/60 hover:text-[#00f0ff] border border-transparent",
            )}
          >
            <Mic className="size-3.5" />
            <span>Live Call</span>
          </button>

          <button
            onClick={() => handleTabChange("core")}
            className={cn(
              "px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all",
              activeTab === "core"
                ? "bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_12px_rgba(0,240,255,0.4)] border border-[#00f0ff]/40"
                : "text-[#80f7ff]/60 hover:text-[#00f0ff] border border-transparent",
            )}
          >
            <Bot className="size-3.5" />
            <span>Core Assistant</span>
          </button>

          <button
            onClick={() => handleTabChange("music")}
            className={cn(
              "px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all",
              activeTab === "music"
                ? "bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_12px_rgba(0,240,255,0.4)] border border-[#00f0ff]/40"
                : "text-[#80f7ff]/60 hover:text-[#00f0ff] border border-transparent",
            )}
          >
            <Music2 className="size-3.5" />
            <span>Music Player</span>
          </button>

          <button
            onClick={() => handleTabChange("feed")}
            className={cn(
              "px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all",
              activeTab === "feed"
                ? "bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_12px_rgba(0,240,255,0.4)] border border-[#00f0ff]/40"
                : "text-[#80f7ff]/60 hover:text-[#00f0ff] border border-transparent",
            )}
          >
            <Globe className="size-3.5" />
            <span>World Feed</span>
          </button>
        </div>
      </div>

      {/* Active Tab Viewport */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "call" && (
          <div className="flex-1 flex items-center justify-center">
            <LiveVoiceCallWidget
              initialPersona="jarvis"
              onSendMessage={(txt, p) => handleSendMessage(txt, p)}
            />
          </div>
        )}

        {activeTab === "core" && (
          <div className="flex-1 min-h-[550px]">
            <JarvisCoreWidget
              onSendMessage={(txt) => handleSendMessage(txt, "jarvis")}
            />
          </div>
        )}

        {activeTab === "music" && (
          <div className="flex-1 min-h-[500px]">
            <MusicPlayerWidget />
          </div>
        )}

        {activeTab === "feed" && (
          <div className="flex-1 min-h-[550px]">
            <LiveWorldFeedWidget />
          </div>
        )}
      </div>
    </div>
  );
}
