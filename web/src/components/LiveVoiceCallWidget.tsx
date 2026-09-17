import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Cpu,
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AudioWaveformVisualizer } from './AudioWaveformVisualizer';
import { getVoicesSafely, isArabic, pickArabicVoice, sanitizeTextForSpeech } from '../lib/speechUtils';

type CallStatus = 'idle' | 'starting' | 'active';
type Speaker = 'user' | 'assistant' | 'system';
export type VoicePersona = 'jarvis' | 'gwen';

interface CallMessage {
  id: string;
  sender: Speaker;
  text: string;
  persona?: VoicePersona;
  timestamp: string;
}

export interface LiveVoiceCallWidgetProps {
  initialPersona?: VoicePersona;
  onSendMessage?: (text: string, persona: VoicePersona) => Promise<string>;
  onClose?: () => void;
}

const messageId = () => Math.random().toString(36).substring(2, 9);

export const LiveVoiceCallWidget: React.FC<LiveVoiceCallWidgetProps> = ({
  initialPersona = 'jarvis',
  onSendMessage,
  onClose,
}) => {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [selectedPersona, setSelectedPersona] = useState<VoicePersona>(initialPersona);
  const [isMuted, setIsMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micStatus, setMicStatus] = useState('Microphone standby');
  const [recognitionStatus, setRecognitionStatus] = useState('Speech engine ready');
  const [detectedLanguage, setDetectedLanguage] = useState<'English' | 'Arabic'>('English');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [messages, setMessages] = useState<CallMessage[]>([
    {
      id: messageId(),
      sender: 'system',
      text: 'Jarvis & Gwen Live Voice Sentinel ready. Press "Start Call" to initiate hands-free voice conversation.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const messagesRef = useRef<CallMessage[]>(messages);
  const statusRef = useRef<CallStatus>('idle');
  const mutedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const recognitionRunningRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionVersionRef = useRef(0);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  const replaceMessages = useCallback((next: CallMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const appendMessage = useCallback(
    (sender: Speaker, text: string, persona?: VoicePersona) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const next = [...messagesRef.current, { id: messageId(), sender, text, persona, timestamp }];
      replaceMessages(next);
    },
    [replaceMessages]
  );

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speakWithBrowser = useCallback(async (text: string): Promise<void> => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const arabic = isArabic(text);
    utterance.lang = arabic ? 'ar-EG' : 'en-US';
    
    if (arabic) {
      const voices = await getVoicesSafely();
      const voice = pickArabicVoice(voices);
      if (voice) utterance.voice = voice;
    }
    
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const speak = useCallback(
    async (rawText: string): Promise<void> => {
      const text = sanitizeTextForSpeech(rawText);
      if (!text || !speakerOn || statusRef.current !== 'active') return;
      stopSpeaking();
      setIsSpeaking(true);
      try {
        // Try calling Hermes Agent /api/audio/speak endpoint first if available
        const response = await fetch('/api/audio/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: selectedPersona === 'gwen' ? 'Sarah' : 'Christopher',
            language: isArabic(text) ? 'ar' : 'en',
          }),
        }).catch(() => null);

        if (response && response.ok) {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('audio')) {
            const url = URL.createObjectURL(await response.blob());
            const audio = new Audio(url);
            audioRef.current = audio;
            await new Promise<void>((resolve) => {
              const done = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              audio.onended = done;
              audio.onerror = done;
              audio.play().catch(done);
            });
            audioRef.current = null;
            return;
          }
        }
        await speakWithBrowser(text);
      } catch {
        await speakWithBrowser(text);
      } finally {
        setIsSpeaking(false);
      }
    },
    [speakerOn, selectedPersona, speakWithBrowser, stopSpeaking]
  );

  const sendChatTurn = useCallback(
    async (text: string, sessionVersion: number) => {
      let reply = '';
      if (onSendMessage) {
        reply = await onSendMessage(text, selectedPersona);
      } else {
        // Default local response generator fallback
        const isAr = isArabic(text);
        if (selectedPersona === 'gwen') {
          reply = isAr
            ? `أهلاً يا باشا! أنا جوين مع حضرتك. سمعتك بتقول: "${text}". أنا جاهزة لأي أمر أو استفسار!`
            : `Hello! I am Gwen. I heard you say: "${text}". I'm here and fully synchronized to assist you.`;
        } else {
          reply = isAr
            ? `تحياتي يا هندسة! معك جارفيس. استلمت طلبك: "${text}". جاري المعالجة والمتابعة فوراً.`
            : `Greetings. Jarvis online. I received your request: "${text}". Executing system tasks.`;
        }
      }

      if (sessionVersion !== sessionVersionRef.current || statusRef.current !== 'active') return;
      appendMessage('assistant', reply, selectedPersona);
      await speak(reply);
    },
    [appendMessage, onSendMessage, selectedPersona, speak]
  );

  const submitTurn = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isProcessing) return;
      if (statusRef.current !== 'active') {
        appendMessage('system', 'Please start the call session first by clicking "Start Call".');
        return;
      }
      stopSpeaking();
      setInterimTranscript('');
      const arabic = isArabic(text);
      setDetectedLanguage(arabic ? 'Arabic' : 'English');
      appendMessage('user', text);

      setIsProcessing(true);
      const sessionVersion = sessionVersionRef.current;
      try {
        await sendChatTurn(text, sessionVersion);
      } catch (error) {
        if (sessionVersion === sessionVersionRef.current && statusRef.current === 'active') {
          const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
          appendMessage('system', `Could not reach AI voice engine.${detail}`);
        }
      } finally {
        if (sessionVersion === sessionVersionRef.current) setIsProcessing(false);
      }
    },
    [appendMessage, isProcessing, sendChatTurn, stopSpeaking]
  );

  const startRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || recognitionRunningRef.current || statusRef.current !== 'active' || mutedRef.current) return;
    try {
      recognition.start();
    } catch {
      // Chromium throws if start is called while a previous stop is settling.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognitionStatus('Speech recognition unavailable — use typed input fallback');
      return;
    }
    setRecognitionStatus('Browser speech recognition available');
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setRecognitionStatus('Listening (Auto Arabic / English speech detection)');
    };
    recognition.onspeechstart = () => stopSpeaking();
    recognition.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const chunk = String(event.results[index][0]?.transcript || '').trim();
        if (event.results[index].isFinal) finalText += ` ${chunk}`;
        else interimText += ` ${chunk}`;
      }
      setInterimTranscript(interimText.trim());
      if (finalText.trim()) {
        const final = finalText.trim();
        recognition.lang = isArabic(final) ? 'ar-EG' : 'en-US';
        void submitTurn(final);
        recognition.stop();
      }
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setRecognitionStatus('Microphone permission denied — typed input active');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setRecognitionStatus(`Speech recognition error: ${event.error || 'unknown'}`);
      }
    };
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      if (statusRef.current === 'active' && !mutedRef.current) window.setTimeout(startRecognition, 250);
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // Ignore abort errors
      }
      recognitionRef.current = null;
    };
  }, [startRecognition, stopSpeaking, submitTurn]);

  useEffect(() => {
    if (status !== 'active') return;
    const timer = window.setInterval(() => setDurationSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [messages, interimTranscript]);

  useEffect(() => {
    return () => {
      sessionVersionRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopSpeaking();
    };
  }, [stopSpeaking]);

  const startCall = useCallback(async () => {
    if (statusRef.current !== 'idle') return;
    setStatus('starting');
    statusRef.current = 'starting';
    setMicStatus('Requesting microphone permission...');
    setDurationSeconds(0);
    sessionVersionRef.current += 1;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        setMicStatus('Microphone active & capture bound');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'permission unavailable';
      setMicStatus(`Microphone unavailable: ${detail}. Typed input active.`);
    }
    statusRef.current = 'active';
    setStatus('active');
    appendMessage(
      'assistant',
      selectedPersona === 'gwen'
        ? 'أهلاً بك يا باشا! أنا جوين، الخط المباشر شغال مع جارفيس وهيرميس إيجينت.'
        : 'Jarvis online. Live voice call session initialized with Hermes Agent.',
      selectedPersona
    );
    window.setTimeout(startRecognition, 0);
  }, [appendMessage, selectedPersona, startRecognition]);

  const endCall = useCallback(() => {
    sessionVersionRef.current += 1;
    statusRef.current = 'idle';
    setStatus('idle');
    setIsProcessing(false);
    setDurationSeconds(0);
    setInterimTranscript('');
    stopSpeaking();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setMicStatus('Microphone released');
    appendMessage('system', 'Voice call session terminated.');
  }, [appendMessage, stopSpeaking]);

  const toggleMicMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
        });
      }
      if (next) {
        stopSpeaking();
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {
            // Ignore
          }
        }
      } else if (statusRef.current === 'active') {
        window.setTimeout(startRecognition, 200);
      }
      return next;
    });
  }, [startRecognition, stopSpeaking]);

  const handleTypedSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!typedInput.trim()) return;
    const text = typedInput.trim();
    setTypedInput('');
    void submitTurn(text);
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-[#030712] border border-[#00f0ff]/30 rounded-xl shadow-[0_0_30px_rgba(0,240,255,0.15)] text-[#e5e2e1] overflow-hidden flex flex-col font-sans relative">
      {/* Header Bar */}
      <div className="bg-[#071526] border-b border-[#00f0ff]/20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${status === 'active' ? 'bg-[#00f0ff] animate-ping' : 'bg-slate-600'}`} />
            <div className={`w-3 h-3 rounded-full absolute top-0 left-0 ${status === 'active' ? 'bg-[#00f0ff]' : 'bg-slate-500'}`} />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-wider uppercase text-[#00f0ff] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#ffb700]" /> JARVIS LIVE VOICE SENTINEL
            </h2>
            <p className="text-[11px] font-mono text-[#80f7ff]/70">
              Hermes Agent Integration • Status: <span className="text-[#00f0ff] uppercase">{status}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Persona selector tabs */}
          <div className="flex bg-[#030712] border border-[#00f0ff]/30 rounded-lg p-1 text-xs">
            <button
              onClick={() => setSelectedPersona('jarvis')}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                selectedPersona === 'jarvis'
                  ? 'bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/50'
                  : 'text-[#80f7ff]/50 hover:text-[#e5e2e1]'
              }`}
            >
              Jarvis (Male AI)
            </button>
            <button
              onClick={() => setSelectedPersona('gwen')}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                selectedPersona === 'gwen'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                  : 'text-[#80f7ff]/50 hover:text-[#e5e2e1]'
              }`}
            >
              Gwen (Female AI)
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Body Grid */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Telemetry Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
          <div className="bg-[#071526]/80 border border-[#00f0ff]/20 p-2.5 rounded-lg flex flex-col justify-center">
            <span className="text-[10px] text-[#80f7ff]/60 uppercase">Call Duration</span>
            <span className="text-base font-bold text-[#00f0ff]">{formatTime(durationSeconds)}</span>
          </div>

          <div className="bg-[#071526]/80 border border-[#00f0ff]/20 p-2.5 rounded-lg flex flex-col justify-center">
            <span className="text-[10px] text-[#80f7ff]/60 uppercase">Detected Speech</span>
            <span className="text-sm font-semibold text-amber-300">{detectedLanguage}</span>
          </div>

          <div className="bg-[#071526]/80 border border-[#00f0ff]/20 p-2.5 rounded-lg flex flex-col justify-center col-span-2 md:col-span-2">
            <span className="text-[10px] text-[#80f7ff]/60 uppercase">Sentinel Engine Status</span>
            <span className="text-xs truncate text-[#80f7ff]">{recognitionStatus}</span>
          </div>
        </div>

        {/* Real-time Waveform Canvas */}
        <AudioWaveformVisualizer
          analyser={null}
          isActive={status === 'active'}
          isAgentSpeaking={isSpeaking}
          isMuted={isMuted}
          accentColor={selectedPersona === 'gwen' ? '#f59e0b' : '#00f0ff'}
          realVolumeMeter={status === 'active' && !isMuted ? 45 : 0}
        />

        {/* Transcript Conversation Feed */}
        <div className="bg-[#071526]/50 border border-[#00f0ff]/20 rounded-xl p-4 h-64 overflow-y-auto space-y-3 font-mono text-xs shadow-inner">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.sender === 'user'
                  ? 'items-end'
                  : msg.sender === 'assistant'
                  ? 'items-start'
                  : 'items-center text-center my-2'
              }`}
            >
              {msg.sender === 'system' ? (
                <span className="px-3 py-1 bg-slate-900/80 border border-slate-700/60 rounded-full text-[10px] text-slate-400">
                  {msg.text}
                </span>
              ) : (
                <div
                  className={`max-w-[80%] rounded-xl p-3 space-y-1 ${
                    msg.sender === 'user'
                      ? 'bg-[#00f0ff]/10 border border-[#00f0ff]/40 text-[#e5e2e1]'
                      : msg.persona === 'gwen'
                      ? 'bg-amber-950/40 border border-amber-500/40 text-amber-100'
                      : 'bg-cyan-950/40 border border-cyan-500/40 text-cyan-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-[10px] opacity-70 font-semibold border-b border-white/10 pb-1">
                    <span className="flex items-center gap-1">
                      {msg.sender === 'user' ? (
                        'USER (YOU)'
                      ) : (
                        <>
                          <Bot className="w-3 h-3 text-[#00f0ff]" />
                          {msg.persona === 'gwen' ? 'GWEN AI' : 'JARVIS AI'}
                        </>
                      )}
                    </span>
                    <span>{msg.timestamp}</span>
                  </div>
                  <p className="text-xs leading-relaxed font-sans font-normal whitespace-pre-wrap">{msg.text}</p>
                </div>
              )}
            </div>
          ))}

          {interimTranscript && (
            <div className="flex flex-col items-end">
              <div className="max-w-[80%] bg-[#00f0ff]/5 border border-[#00f0ff]/30 text-slate-300 italic rounded-xl p-2.5 text-xs">
                Listening: "{interimTranscript}..."
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex items-center gap-2 text-xs text-[#00f0ff] animate-pulse">
              <LoaderCircle className="w-4 h-4 animate-spin" /> Processing speech turn...
            </div>
          )}

          <div ref={conversationEndRef} />
        </div>

        {/* Typed Input Fallback Form */}
        <form onSubmit={handleTypedSubmit} className="flex gap-2">
          <input
            type="text"
            value={typedInput}
            onChange={(e) => setTypedInput(e.target.value)}
            placeholder={status === 'active' ? 'Type message fallback or command...' : 'Start call to begin typing...'}
            disabled={status !== 'active'}
            className="flex-1 bg-[#071526] border border-[#00f0ff]/30 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00f0ff] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status !== 'active' || !typedInput.trim()}
            className="px-4 py-2 bg-[#00f0ff]/20 border border-[#00f0ff] hover:bg-[#00f0ff]/30 text-[#00f0ff] rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        </form>

        {/* Main Action Controls */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#00f0ff]/20">
          <div className="flex items-center gap-2">
            {status === 'idle' ? (
              <button
                onClick={startCall}
                className="px-5 py-2.5 bg-[#00f0ff] hover:bg-[#00f0ff]/90 text-slate-950 font-bold rounded-lg text-xs tracking-wider uppercase flex items-center gap-2 shadow-[0_0_15px_rgba(0,240,255,0.4)] transition-all"
              >
                <Phone className="w-4 h-4" /> Start Call
              </button>
            ) : (
              <button
                onClick={endCall}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs tracking-wider uppercase flex items-center gap-2 shadow-[0_0_15px_rgba(225,29,72,0.4)] transition-all"
              >
                <PhoneOff className="w-4 h-4" /> End Call
              </button>
            )}

            <button
              onClick={toggleMicMute}
              disabled={status !== 'active'}
              className={`px-4 py-2.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 ${
                isMuted
                  ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                  : 'bg-[#071526] border-[#00f0ff]/30 text-slate-200 hover:border-[#00f0ff]'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-[#00f0ff]" />}
              {isMuted ? 'Muted' : 'Mic Active'}
            </button>

            <button
              onClick={() => setSpeakerOn(!speakerOn)}
              className={`px-4 py-2.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                !speakerOn
                  ? 'bg-amber-950/60 border-amber-500 text-amber-300'
                  : 'bg-[#071526] border-[#00f0ff]/30 text-slate-200 hover:border-[#00f0ff]'
              }`}
            >
              {!speakerOn ? <VolumeX className="w-4 h-4 text-amber-400" /> : <Volume2 className="w-4 h-4 text-[#00f0ff]" />}
              {!speakerOn ? 'Speaker Off' : 'Speaker On'}
            </button>
          </div>

          <div className="text-[11px] font-mono text-[#80f7ff]/60 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[#00f0ff] animate-pulse" /> Full Duplex Sentinel
          </div>
        </div>
      </div>
    </div>
  );
};
