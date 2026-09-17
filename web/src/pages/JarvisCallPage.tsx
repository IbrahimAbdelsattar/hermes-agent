import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic, Bot, Music2, Globe, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { usePageHeader } from "@/contexts/usePageHeader";
import { cn } from "@/lib/utils";
import { LiveVoiceCallWidget, type VoicePersona, type CallMessage } from "@/components/LiveVoiceCallWidget";
import { JarvisCoreWidget } from "@/components/JarvisCoreWidget";
import { MusicPlayerWidget } from "@/components/MusicPlayerWidget";
import { LiveWorldFeedWidget } from "@/components/LiveWorldFeedWidget";
import { GatewayClient } from "@/lib/gatewayClient";
import { api, type SessionInfo } from "@/lib/api";

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

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("JARVIS_ACTIVE_SESSION_ID");
    }
    return null;
  });
  const [activeSessionTitle, setActiveSessionTitle] = useState<string>("");
  const [callSessions, setCallSessions] = useState<SessionInfo[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [initialMessages, setInitialMessages] = useState<CallMessage[]>([]);

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

  // Sync ref with state
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const refreshCallSessions = useCallback(async () => {
    setIsHistoryLoading(true);
    try {
      const res = await api.getSessions(50, 0, undefined, "recent");
      if (res && Array.isArray(res.sessions)) {
        setCallSessions(res.sessions);
        if (sessionIdRef.current) {
          const current = res.sessions.find((s) => s.id === sessionIdRef.current);
          if (current?.title) {
            setActiveSessionTitle(current.title);
          }
        }
      }
    } catch (err) {
      console.warn("[jarvis] Failed loading call sessions:", err);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCallSessions();
  }, [refreshCallSessions]);

  // Hydrate messages when activeSessionId changes or on load
  useEffect(() => {
    const sid = activeSessionId;
    if (!sid) return;

    api
      .getSessionMessages(sid)
      .then((res) => {
        if (res && Array.isArray(res.messages)) {
          const mapped: CallMessage[] = res.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => {
              const raw = m.content || "";
              const clean = raw
                .replace(/^\[(?:تعليمات المكالمة الصوتية الحية|VOICE CALL MODE)[^\]]*\]\s*/i, "")
                .trim();
              return {
                id: Math.random().toString(36).substring(2, 9),
                sender: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
                text: clean,
                persona: "jarvis" as VoicePersona,
                timestamp: m.timestamp
                  ? new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              };
            });
          if (mapped.length > 0) {
            setInitialMessages(mapped);
          }
        }
      })
      .catch((err) => {
        console.warn("[jarvis] Failed hydrating active session messages:", err);
      });
  }, [activeSessionId]);

  const handleSelectSession = useCallback(
    async (sid: string) => {
      sessionIdRef.current = sid;
      setActiveSessionId(sid);
      localStorage.setItem("JARVIS_ACTIVE_SESSION_ID", sid);

      const found = callSessions.find((s) => s.id === sid);
      if (found?.title) {
        setActiveSessionTitle(found.title);
      }

      const gw = gatewayRef.current;
      if (gw) {
        if (gw.connectionState !== "open") {
          await gw.connect();
        }
        try {
          await gw.request("session.resume", { session_id: sid });
        } catch (err) {
          console.warn("[jarvis] session.resume via gateway deferred:", err);
        }
      }

      try {
        const res = await api.getSessionMessages(sid);
        if (res && Array.isArray(res.messages)) {
          const mapped: CallMessage[] = res.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => {
              const raw = m.content || "";
              const clean = raw
                .replace(/^\[(?:تعليمات المكالمة الصوتية الحية|VOICE CALL MODE)[^\]]*\]\s*/i, "")
                .trim();
              return {
                id: Math.random().toString(36).substring(2, 9),
                sender: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
                text: clean,
                persona: "jarvis" as VoicePersona,
                timestamp: m.timestamp
                  ? new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              };
            });
          if (mapped.length > 0) {
            setInitialMessages(mapped);
          }
        }
      } catch (err) {
        console.warn("[jarvis] Failed loading session messages:", err);
      }
    },
    [callSessions]
  );

  const handleNewSession = useCallback(() => {
    sessionIdRef.current = null;
    setActiveSessionId(null);
    setActiveSessionTitle("");
    localStorage.removeItem("JARVIS_ACTIVE_SESSION_ID");
    setInitialMessages([
      {
        id: Math.random().toString(36).substring(2, 9),
        sender: "system",
        text: "New Jarvis Voice Sentinel session ready. Memory & system capabilities synchronized. Click 'Start Call' to begin.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  }, []);

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      try {
        await api.deleteSession(sid);
        if (sessionIdRef.current === sid) {
          handleNewSession();
        }
        await refreshCallSessions();
      } catch (err) {
        console.warn("[jarvis] Failed deleting session:", err);
      }
    },
    [handleNewSession, refreshCallSessions]
  );

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

  const handleSendMessage = useCallback(
    async (text: string, persona: VoicePersona = "jarvis"): Promise<string> => {
      const gw = gatewayRef.current;
      if (!gw) {
        throw new Error("Gateway client not initialized");
      }

      if (gw.connectionState !== "open") {
        await gw.connect();
      }

      let sid = sessionIdRef.current;
      if (!sid) {
        const nowStr = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const title = `Jarvis Voice Sentinel (${persona === "gwen" ? "Gwen" : "Jarvis"}) - ${nowStr}`;
        const created = await gw.request<{ session_id: string }>("session.create", {
          title,
        });
        sid = created.session_id;
        sessionIdRef.current = sid;
        setActiveSessionId(sid);
        setActiveSessionTitle(title);
        localStorage.setItem("JARVIS_ACTIVE_SESSION_ID", sid);
        void refreshCallSessions();
      }

      return new Promise<string>((resolve, reject) => {
        let fullText = "";
        const timeout = setTimeout(() => {
          cleanup();
          if (fullText.trim()) {
            resolve(fullText.trim());
          } else {
            sessionIdRef.current = null;
            setActiveSessionId(null);
            localStorage.removeItem("JARVIS_ACTIVE_SESSION_ID");
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
            void refreshCallSessions();
            const finalReply = fullText.trim() || String(ev.payload?.text || "").trim();
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
            setActiveSessionId(null);
            localStorage.removeItem("JARVIS_ACTIVE_SESSION_ID");
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
          ? `[تعليمات المكالمة الصوتية الحية: أنت في مكالمة صوتية مستمرة ولديك ذاكرة كاملة لجلساتنا السابقة ومشاريعنا المتفق عليها. إذا سأل المستخدم عن مشروع أو أمر تم الاتفاق عليه سابقاً، تذكره فوراً واستحضر تفاصيله واستمر عليه. أجب بإيجاز شديد في جملة أو جملتين فقط بلهجة مصرية مهذبة كشخصية ${persona === 'gwen' ? 'جوين' : 'جارفيس'}. ممنوع تماماً استخدام أي ماركداون أو رموز أو قوائم.] `
          : `[VOICE CALL MODE: Continuous voice call with persistent memory. You recall all previous agreements, project details, and tasks discussed with the user. If asked about an ongoing project or task, recall it immediately and maintain continuity. Respond concisely in 1-2 spoken sentences only as ${persona === 'gwen' ? 'Gwen' : 'Jarvis'}. Absolutely no markdown, no symbols, no bullet lists.] `;

        gw.request("prompt.submit", { session_id: sid, text: `${personaInstruction}${text}` }).catch((err) => {
          cleanup();
          sessionIdRef.current = null;
          setActiveSessionId(null);
          localStorage.removeItem("JARVIS_ACTIVE_SESSION_ID");
          reject(err);
        });
      });
    },
    [refreshCallSessions]
  );

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
              activeSessionId={activeSessionId}
              activeSessionTitle={activeSessionTitle}
              callSessions={callSessions}
              isHistoryLoading={isHistoryLoading}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onDeleteSession={handleDeleteSession}
              onRefreshSessions={refreshCallSessions}
              initialMessages={initialMessages}
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
