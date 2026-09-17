import { useLayoutEffect } from "react";
import { Mic, Shield, Sparkles, Volume2 } from "lucide-react";
import { usePageHeader } from "@/contexts/usePageHeader";
import { cn } from "@/lib/utils";
import { LiveVoiceCallWidget } from "@/components/LiveVoiceCallWidget";

export default function JarvisCallPage() {
  const { setEnd } = usePageHeader();

  useLayoutEffect(() => {
    setEnd(
      <div className="flex items-center gap-2 text-xs font-mono text-[#00f0ff]">
        <Sparkles className="size-3.5 animate-pulse text-[#ffb700]" />
        <span>JARVIS LIVE VOICE SENTINEL</span>
      </div>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd]);

  return (
    <div
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6 space-y-6",
        "bg-[#030712] text-slate-100",
      )}
    >
      {/* Header Overview Card */}
      <div className="bg-[#071526]/90 border border-[#00f0ff]/30 rounded-xl p-5 shadow-[0_0_20px_rgba(0,240,255,0.1)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#00f0ff] font-bold text-lg">
            <Mic className="size-5 text-[#00f0ff] animate-pulse" />
            <span>Jarvis & Gwen Live Voice Call Console</span>
          </div>
          <p className="text-xs text-[#80f7ff]/70 mt-1 max-w-2xl">
            Real-time, full-duplex voice call interface integrated directly into Hermes Agent. Speak naturally in English or Egyptian Arabic with Jarvis (Male AI) or Gwen (Female AI - Sarah/ElevenLabs).
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="px-3 py-1.5 bg-[#00f0ff]/10 border border-[#00f0ff]/40 rounded-lg text-[#00f0ff] flex items-center gap-1.5">
            <Volume2 className="size-4" /> WebAudio Stream
          </div>
          <div className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 rounded-lg text-amber-300 flex items-center gap-1.5">
            <Shield className="size-4" /> Auto ar-EG / en-US
          </div>
        </div>
      </div>

      {/* Main Live Call Sentinel Widget */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <LiveVoiceCallWidget initialPersona="jarvis" />
      </div>
    </div>
  );
}
