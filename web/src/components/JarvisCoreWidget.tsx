import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Volume2,
  VolumeX,
  Sparkles,
  Copy,
  Check,
  Timer,
  Play,
  Pause,
  RotateCcw,
  Zap,
  Network,
  MessageSquare,
  Columns,
  Target,
  CheckCircle2,
} from 'lucide-react';
import type { JarvisMessage, BiometricTelemetry } from '@/types/jarvis';
import {
  formatDisplayContentWithPunctuation,
  speakWithNabra,
  stopNabraAudio,
} from '@/utils/jarvisSpeechUtils';
import { cacheEngine } from '@/utils/jarvisCacheManager';
import { copyTextToClipboard } from '@/lib/clipboard';
import { JarvisNetworkGraph, type GraphNode } from '@/components/JarvisNetworkGraph';

interface JarvisCoreWidgetProps {
  biometrics?: BiometricTelemetry;
  onSendMessage?: (text: string) => Promise<string>;
}

const DEFAULT_BIOMETRICS: BiometricTelemetry = {
  heartRate: 72,
  hrv: 64,
  energyLevel: 88,
  stressIndex: 18,
  focusScore: 94,
  sleepQuality: 85,
  circadianPhase: 'Peak Focus',
  cameraPulseActive: true,
  lastSyncTimestamp: 'Just now',
};

export const JarvisCoreWidget: React.FC<JarvisCoreWidgetProps> = ({
  biometrics = DEFAULT_BIOMETRICS,
  onSendMessage,
}) => {
  const [messages, setMessages] = useState<JarvisMessage[]>([
    {
      id: 'm-1',
      sender: 'jarvis',
      content:
        'مرحباً بك يا باشمهندس إبراهيم! أنا JARVIS، المساعد التنفيذي والتقني الخاص بك. جميع أنظمة SupplyMind، C-SAT، و Dawrly تحت المراقبة المستمرة. كيف يمكنني مساعدتك اليوم؟',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      technicalKeywords: ['SupplyMind AI', 'C-SAT', 'Dawrly', 'RAG Isolation', 'Biometric Sensor'],
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'graph' | 'split'>('chat');

  // Pomodoro Focus Timer & Deep Work Mode State
  const [isPomodoroActive, setIsPomodoroActive] = useState<boolean>(false);
  const [pomodoroMode, setPomodoroMode] = useState<'work' | 'break'>('work');
  const [timeLeft, setTimeLeft] = useState<number>(25 * 60);
  const [completedSessions, setCompletedSessions] = useState<number>(0);
  const [isDeepWorkMode, setIsDeepWorkMode] = useState<boolean>(false);

  // Daily Focus Goal Tracker State
  const [dailyFocusGoal, setDailyFocusGoal] = useState<string>('Audit SupplyMind PGvector RLS Tenant Isolation');
  const focusTargetMinutes = 60;
  const [focusElapsedSeconds, setFocusElapsedSeconds] = useState<number>(1620);
  const [isFocusGoalActive, setIsFocusGoalActive] = useState<boolean>(false);
  const [isFocusCompleted, setIsFocusCompleted] = useState<boolean>(false);
  const [isEditingFocusGoal, setIsEditingFocusGoal] = useState<boolean>(false);
  const [customGoalInput, setCustomGoalInput] = useState<string>(dailyFocusGoal);

  // Daily Focus Timer Effect
  useEffect(() => {
    let timerId: any = null;
    if (isFocusGoalActive && !isFocusCompleted) {
      timerId = setInterval(() => {
        setFocusElapsedSeconds((prev) => {
          const next = prev + 1;
          if (next >= focusTargetMinutes * 60) {
            setIsFocusCompleted(true);
            setIsFocusGoalActive(false);
            if (isSpeechEnabled) {
              void speakWithNabra('عاش يا إبراهيم باشا! لقد حققت 100% من هدف التركيز اليومي بنجاح.');
            }
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [isFocusGoalActive, isFocusCompleted, focusTargetMinutes, isSpeechEnabled]);

  const toggleFocusGoalTimer = () => {
    if (isFocusCompleted) return;
    setIsFocusGoalActive((prev) => !prev);
  };

  const handleMarkGoalCompleted = () => {
    const nextCompleted = !isFocusCompleted;
    setIsFocusCompleted(nextCompleted);
    if (nextCompleted) {
      setIsFocusGoalActive(false);
      setFocusElapsedSeconds(focusTargetMinutes * 60);
      if (isSpeechEnabled) {
        void speakWithNabra('عاش يا إبراهيم باشا! تم تأكيد إنجاز الهدف اليومي بنجاح!');
      }
    } else {
      setFocusElapsedSeconds(0);
    }
  };

  const resetFocusGoalTimer = () => {
    setIsFocusGoalActive(false);
    setIsFocusCompleted(false);
    setFocusElapsedSeconds(0);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const speakText = async (text: string) => {
    if (!isSpeechEnabled) return;
    stopNabraAudio();
    await speakWithNabra(text);
  };

  // Pomodoro Timer Countdown
  useEffect(() => {
    let timerId: any = null;
    if (isPomodoroActive && timeLeft > 0) {
      timerId = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isPomodoroActive && timeLeft === 0) {
      if (pomodoroMode === 'work') {
        setCompletedSessions((c) => c + 1);
        setPomodoroMode('break');
        setTimeLeft(5 * 60);
        void speakText(
          'عاش يا إبراهيم باشا! انتهت جلسة التركيز العميق (25 دقيقة). خذ استراحة لمدة 5 دقائق لإعادة شحن طاقتك.'
        );
      } else {
        setPomodoroMode('work');
        setTimeLeft(25 * 60);
        setIsPomodoroActive(false);
        void speakText(
          'يا إبراهيم! انتهت الاستراحة، مستعدون لجلسة التركيز التالية؟'
        );
      }
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [isPomodoroActive, timeLeft, pomodoroMode]);

  const togglePomodoro = () => {
    if (!isPomodoroActive) {
      setIsPomodoroActive(true);
      if (pomodoroMode === 'work') {
        void speakText('بدأت جلسة العمل العميق. 25 دقيقة من التركيز الهندسي تبدأ الآن.');
      } else {
        void speakText('بدأت فترة الاستراحة.');
      }
    } else {
      setIsPomodoroActive(false);
      void speakText('تم إيقاف مؤقت التركيز مؤقتاً.');
    }
  };

  const resetPomodoro = () => {
    setIsPomodoroActive(false);
    setPomodoroMode('work');
    setTimeLeft(25 * 60);
    void speakText('تمت إعادة تعيين مؤقت التركيز إلى 25 دقيقة.');
  };

  const toggleDeepWorkMode = () => {
    const nextState = !isDeepWorkMode;
    setIsDeepWorkMode(nextState);
    if (nextState) {
      if (!isPomodoroActive) {
        setIsPomodoroActive(true);
      }
      void speakText('تم تفعيل درع التركيز العميق! جميع الأنظمة في وضع الأداء الأقصى.');
    } else {
      void speakText('تم إلغاء وضع التركيز العميق.');
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const extractTechnicalKeywords = (content: string): string[] => {
    const pool = ['SupplyMind', 'PGvector', 'RLS', 'FastAPI', 'PyTorch', 'C-SAT', 'Dawrly', 'RAG', 'Hermes', 'Docker', 'Biometrics'];
    return pool.filter((kw) => content.toLowerCase().includes(kw.toLowerCase()));
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputValue;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: JarvisMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInputValue('');
    setIsLoading(true);

    try {
      let replyContent = '';

      // Check client AI response cache
      const cached = cacheEngine.getCachedAnswer('jarvis_chief', textToSend);
      if (cached) {
        replyContent = cached.replyText;
      } else if (onSendMessage) {
        // Send via Hermes Gateway
        replyContent = await onSendMessage(textToSend);
        cacheEngine.setCachedAnswer('jarvis_chief', textToSend, replyContent);
      } else {
        // Fallback realistic response
        await new Promise((r) => setTimeout(r, 900));
        replyContent = `يا باشمهندس إبراهيم، تلقيت أمرك: "${textToSend}". تم فحص أنظمة SupplyMind ومؤشرات التركيز (${biometrics.energyLevel}% طاقة). يتم تنفيذ الخطوات المطلوبة ومزامنة البيانات في الـ RAG Vectorstore بنجاح.`;
        cacheEngine.setCachedAnswer('jarvis_chief', textToSend, replyContent);
      }

      const jarvisReply: JarvisMessage = {
        id: `j-${Date.now()}`,
        sender: 'jarvis',
        content: replyContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        technicalKeywords: extractTechnicalKeywords(replyContent),
        isCached: !!cached,
      };

      setMessages((prev) => [...prev, jarvisReply]);
      if (isSpeechEnabled) {
        void speakText(replyContent);
      }
    } catch (err: any) {
      console.warn('Chat error:', err);
      const errorReply: JarvisMessage = {
        id: `j-${Date.now()}`,
        sender: 'jarvis',
        content: `يا باشمهندس، حدث خطأ أثناء الاتصال بالخادم: ${err?.message || 'Unknown error'}. يرجى التحقق من اتصال البوابة.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorReply]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    void copyTextToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleGraphNodeSelect = (node: GraphNode) => {
    void handleSendMessage(`Give me a diagnostic status and telemetry update for ${node.label} (${node.category}).`);
  };

  const focusPercent = Math.min(100, Math.round((focusElapsedSeconds / (focusTargetMinutes * 60)) * 100));

  return (
    <div
      className={`w-full h-full flex flex-col rounded-xl bg-[#040d1a]/95 border transition-all shadow-[0_0_25px_rgba(0,240,255,0.08)] ${
        isDeepWorkMode ? 'border-amber-400/80 shadow-[0_0_35px_rgba(255,183,0,0.25)]' : 'border-[#00f0ff]/30'
      }`}
    >
      {/* Telemetry Header Bar */}
      <div className="px-4 py-3 border-b border-[#00f0ff]/20 bg-[#071526]/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-[#00f0ff]/10 border border-[#00f0ff]/40 flex items-center justify-center text-[#00f0ff]">
            <Bot className="size-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#00f0ff] tracking-wide">JARVIS CHIEF OF STAFF</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-400/10 text-amber-300 border border-amber-400/30">
                MARK 85
              </span>
            </div>
            <p className="text-[11px] text-[#80f7ff]/60">Executive Assistant & AI Systems Architect</p>
          </div>
        </div>

        {/* View Switcher & Audio Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#020b14] p-1 rounded-lg border border-[#00f0ff]/20">
            <button
              onClick={() => setViewMode('chat')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-all ${
                viewMode === 'chat' ? 'bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_10px_rgba(0,240,255,0.3)]' : 'text-[#80f7ff]/60 hover:text-[#00f0ff]'
              }`}
            >
              <MessageSquare className="size-3.5" /> Chat
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-all ${
                viewMode === 'graph' ? 'bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_10px_rgba(0,240,255,0.3)]' : 'text-[#80f7ff]/60 hover:text-[#00f0ff]'
              }`}
            >
              <Network className="size-3.5" /> Topology
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition-all ${
                viewMode === 'split' ? 'bg-[#00f0ff]/20 text-[#00f0ff] font-bold shadow-[0_0_10px_rgba(0,240,255,0.3)]' : 'text-[#80f7ff]/60 hover:text-[#00f0ff]'
              }`}
            >
              <Columns className="size-3.5" /> Split
            </button>
          </div>

          <button
            onClick={() => setIsSpeechEnabled(!isSpeechEnabled)}
            className={`p-2 rounded-lg border transition-all ${
              isSpeechEnabled
                ? 'bg-[#00f0ff]/10 border-[#00f0ff]/40 text-[#00f0ff]'
                : 'bg-slate-800/40 border-slate-700 text-slate-400'
            }`}
            title={isSpeechEnabled ? 'Mute Speech Output' : 'Enable Speech Output'}
          >
            {isSpeechEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        </div>
      </div>

      {/* Pomodoro Focus Timer & Deep Work Bar */}
      <div
        className={`px-4 py-2 border-b transition-all flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono ${
          isDeepWorkMode
            ? 'bg-amber-950/30 border-amber-400/40 text-amber-200'
            : 'bg-[#031120]/70 border-[#00f0ff]/15 text-[#80f7ff]'
        }`}
      >
        {/* Daily Focus Goal Bar */}
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Target className="size-4 text-[#ffb700] shrink-0" />
          <span className="text-[11px] text-[#ffb700] font-bold uppercase shrink-0">FOCUS GOAL:</span>
          {isEditingFocusGoal ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={customGoalInput}
                onChange={(e) => setCustomGoalInput(e.target.value)}
                className="bg-[#040e1b] border border-[#00f0ff]/40 text-xs px-2 py-0.5 rounded text-cyan-200 flex-1 outline-none"
              />
              <button
                onClick={() => {
                  setDailyFocusGoal(customGoalInput);
                  setIsEditingFocusGoal(false);
                }}
                className="px-2 py-0.5 bg-[#00f0ff]/20 text-[#00f0ff] rounded text-[10px]"
              >
                Save
              </button>
            </div>
          ) : (
            <span
              onClick={() => setIsEditingFocusGoal(true)}
              className="text-[11px] text-cyan-100 truncate cursor-pointer hover:underline"
              title="Click to edit goal"
            >
              {dailyFocusGoal}
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00f0ff]/10 text-[#00f0ff] shrink-0">
            {focusPercent}% ({Math.floor(focusElapsedSeconds / 60)}/{focusTargetMinutes}m)
          </span>
          <button
            onClick={toggleFocusGoalTimer}
            className="p-1 text-cyan-300 hover:text-cyan-100"
            title={isFocusGoalActive ? 'Pause Goal Timer' : 'Start Goal Timer'}
          >
            {isFocusGoalActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            onClick={resetFocusGoalTimer}
            className="p-1 text-slate-400 hover:text-cyan-300"
            title="Reset Goal Timer"
          >
            <RotateCcw className="size-3" />
          </button>
          <button
            onClick={handleMarkGoalCompleted}
            className={`p-1 transition-colors ${
              isFocusCompleted ? 'text-emerald-400' : 'text-slate-400 hover:text-emerald-300'
            }`}
            title="Mark Goal as Completed"
          >
            <CheckCircle2 className="size-3.5" />
          </button>
        </div>

        {/* 25-Min Pomodoro Sprint */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#07172b] border border-[#00f0ff]/30">
            <Timer className="size-3.5 text-amber-400" />
            <span className="font-bold tabular-nums text-amber-300">{formatTimer(timeLeft)}</span>
            <span className="text-[10px] text-cyan-400 uppercase">({pomodoroMode})</span>
            {completedSessions > 0 && (
              <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-300">
                #{completedSessions}
              </span>
            )}
          </div>

          <button
            onClick={togglePomodoro}
            className="p-1.5 rounded bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/30 transition-all"
            title={isPomodoroActive ? 'Pause Pomodoro' : 'Start Pomodoro'}
          >
            {isPomodoroActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>

          <button
            onClick={resetPomodoro}
            className="p-1.5 rounded bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/30 transition-all"
            title="Reset Pomodoro"
          >
            <RotateCcw className="size-3.5" />
          </button>

          <button
            onClick={toggleDeepWorkMode}
            className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 font-bold transition-all ${
              isDeepWorkMode
                ? 'bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(255,183,0,0.5)]'
                : 'bg-amber-400/10 text-amber-300 border border-amber-400/40 hover:bg-amber-400/20'
            }`}
          >
            <Zap className="size-3" /> DEEP WORK
          </button>
        </div>
      </div>

      {/* Quick Command Prompt Chips */}
      <div className="px-4 py-2 bg-[#051120]/60 border-b border-[#00f0ff]/10 flex items-center gap-2 overflow-x-auto scrollbar-none text-[11px] font-mono">
        <span className="text-[#ffb700] shrink-0 flex items-center gap-1 font-bold">
          <Sparkles className="size-3" /> COMMANDS:
        </span>
        <button
          onClick={() => handleSendMessage('Review SupplyMind AI multi-tenant PGvector schema and verify tenant data isolation rules.')}
          className="px-2.5 py-1 bg-[#07172b] border border-[#00f0ff]/30 hover:border-[#00f0ff] text-[#c8c6c5] hover:text-[#00f0ff] rounded whitespace-nowrap transition-colors"
        >
          🔒 SupplyMind Tenant Isolation
        </button>
        <button
          onClick={() => handleSendMessage('Draft a structured lesson plan for Deep Learning CNN architecture for my weekend AI class.')}
          className="px-2.5 py-1 bg-[#07172b] border border-[#00f0ff]/30 hover:border-[#00f0ff] text-[#c8c6c5] hover:text-[#00f0ff] rounded whitespace-nowrap transition-colors"
        >
          🎓 PyTorch CNN Class Plan
        </button>
        <button
          onClick={() => handleSendMessage('Assess my current energy level (88%) and recommend the best high-impact coding task for the next 2 hours.')}
          className="px-2.5 py-1 bg-[#07172b] border border-[#00f0ff]/30 hover:border-[#00f0ff] text-[#c8c6c5] hover:text-[#00f0ff] rounded whitespace-nowrap transition-colors"
        >
          ⚡ Energy Task Recommendation
        </button>
        <button
          onClick={() => handleSendMessage('Review C-SAT survey QR node scalability and suggest FastAPI performance optimization.')}
          className="px-2.5 py-1 bg-[#07172b] border border-[#00f0ff]/30 hover:border-[#00f0ff] text-[#c8c6c5] hover:text-[#00f0ff] rounded whitespace-nowrap transition-colors"
        >
          📊 C-SAT QR Latency
        </button>
      </div>

      {/* Main Content Area: Chat or Graph or Split */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {viewMode === 'graph' ? (
          <div className="flex-1 p-3 overflow-hidden flex flex-col justify-center">
            <JarvisNetworkGraph onNodeSelect={handleGraphNodeSelect} height={420} />
          </div>
        ) : viewMode === 'split' ? (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 overflow-y-auto">
            {/* Left: Chat Feed */}
            <div className="flex flex-col min-h-[380px] bg-[#020914]/80 rounded-lg border border-[#00f0ff]/20 p-3 overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {messages.map((m) => (
                  <MessageCard key={m.id} message={m} copiedId={copiedId} onCopy={handleCopy} onSpeak={speakText} />
                ))}
                {isLoading && <LoadingMessage />}
                <div ref={messagesEndRef} />
              </div>
            </div>
            {/* Right: Topology */}
            <div className="flex flex-col justify-center">
              <JarvisNetworkGraph onNodeSelect={handleGraphNodeSelect} height={380} />
            </div>
          </div>
        ) : (
          /* Pure Chat View */
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.map((m) => (
              <MessageCard key={m.id} message={m} copiedId={copiedId} onCopy={handleCopy} onSpeak={speakText} />
            ))}
            {isLoading && <LoadingMessage />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Chat Input Bar */}
      <div className="p-3 border-t border-[#00f0ff]/20 bg-[#071526]/90">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Command J.A.R.V.I.S. regarding SupplyMind, C-SAT, Dawrly, PyTorch classes..."
            className="flex-1 bg-[#040e1b] border border-[#00f0ff]/30 focus:border-[#00f0ff] text-xs text-[#00f0ff] px-3.5 py-2.5 rounded-lg outline-none placeholder-[#80f7ff]/40 font-mono transition-all shadow-[inset_0_0_8px_rgba(0,240,255,0.05)]"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#00f0ff] to-[#0088ff] text-[#040d1a] font-bold text-xs flex items-center gap-1.5 hover:shadow-[0_0_15px_rgba(0,240,255,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="size-3.5" />
            <span>EXECUTE</span>
          </button>
        </form>
      </div>
    </div>
  );
};

function MessageCard({
  message,
  copiedId,
  onCopy,
  onSpeak,
}: {
  message: JarvisMessage;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
  onSpeak: (text: string) => void;
}) {
  const isUser = message.sender === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group`}>
      <div
        className={`max-w-[85%] rounded-xl p-3.5 text-xs leading-relaxed font-sans shadow-md border ${
          isUser
            ? 'bg-gradient-to-br from-[#062445] to-[#0a3560] border-[#00f0ff]/40 text-cyan-100 rounded-tr-none'
            : 'bg-[#06182c]/90 border-[#00f0ff]/25 text-slate-200 rounded-tl-none'
        }`}
      >
        <div className="flex items-center justify-between gap-4 mb-1 text-[10px] font-mono text-[#80f7ff]/60 border-b border-[#00f0ff]/10 pb-1">
          <span className="font-bold flex items-center gap-1">
            {isUser ? 'IBRAHIM (COMMANDER)' : 'JARVIS MARK 85'}
            {message.isCached && (
              <span className="px-1 rounded bg-[#00f0ff]/10 text-[#00f0ff] text-[9px]">CACHED</span>
            )}
          </span>
          <span>{message.timestamp}</span>
        </div>

        <p className="whitespace-pre-wrap">{formatDisplayContentWithPunctuation(message.content)}</p>

        {message.technicalKeywords && message.technicalKeywords.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-[#00f0ff]/10 flex flex-wrap gap-1.5">
            {message.technicalKeywords.map((kw, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff]"
              >
                #{kw}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onCopy(message.id, message.content)}
          className="p-1 rounded text-[#80f7ff]/50 hover:text-[#00f0ff]"
          title="Copy message"
        >
          {copiedId === message.id ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
        </button>
        {!isUser && (
          <button
            onClick={() => onSpeak(message.content)}
            className="p-1 rounded text-[#80f7ff]/50 hover:text-[#00f0ff]"
            title="Read Aloud"
          >
            <Volume2 className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingMessage() {
  return (
    <div className="flex items-start gap-2 text-xs font-mono text-[#00f0ff] p-2 animate-pulse">
      <Bot className="size-4 animate-spin" />
      <span>JARVIS computing neural response...</span>
    </div>
  );
}

export default JarvisCoreWidget;
