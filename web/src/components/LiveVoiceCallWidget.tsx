import React, { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  Calendar,
  History,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { authedFetch, type SessionInfo } from '@/lib/api';
import { AudioWaveformVisualizer } from './AudioWaveformVisualizer';
import {
  getVoicesSafely,
  isArabic,
  pickArabicVoice,
  pickEnglishVoice,
  sanitizeTextForSpeech,
  splitTextIntoSentences,
} from '../lib/speechUtils';
import { parseMusicCommand, findBestTrackIndex } from '../utils/musicCommander';
import { DEFAULT_DEMO_TRACKS } from './MusicPlayerWidget';

type CallStatus = 'idle' | 'starting' | 'active';
type Speaker = 'user' | 'assistant' | 'system';
export type VoicePersona = 'jarvis' | 'gwen';
export type CallLanguage = 'Arabic' | 'English' | 'Auto';

export interface CallMessage {
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
  activeSessionId?: string | null;
  activeSessionTitle?: string;
  callSessions?: SessionInfo[];
  isHistoryLoading?: boolean;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (sessionId: string) => void;
  onRefreshSessions?: () => void;
  initialMessages?: CallMessage[];
}

const messageId = () => Math.random().toString(36).substring(2, 9);

export const LiveVoiceCallWidget: React.FC<LiveVoiceCallWidgetProps> = ({
  initialPersona = 'jarvis',
  onSendMessage,
  onClose,
  activeSessionId,
  activeSessionTitle,
  callSessions = [],
  isHistoryLoading = false,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRefreshSessions,
  initialMessages,
}) => {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [selectedPersona, setSelectedPersona] = useState<VoicePersona>(initialPersona);
  const [selectedLanguage, setSelectedLanguage] = useState<CallLanguage>('Arabic');
  const [showHistory, setShowHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micStatus, setMicStatus] = useState('Microphone standby');
  const [recognitionStatus, setRecognitionStatus] = useState('Speech engine ready');
  const [detectedLanguage, setDetectedLanguage] = useState<'English' | 'Arabic'>('Arabic');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [messages, setMessages] = useState<CallMessage[]>(
    initialMessages && initialMessages.length > 0
      ? initialMessages
      : [
          {
            id: messageId(),
            sender: 'system',
            text: 'Jarvis & Gwen Live Voice Sentinel ready. Press "Start Call" to initiate hands-free voice conversation with persistent memory.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]
  );

  const messagesRef = useRef<CallMessage[]>(messages);
  const statusRef = useRef<CallStatus>('idle');
  const mutedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const recognitionRunningRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionVersionRef = useRef(0);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  const languageRef = useRef<CallLanguage>('Arabic');
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const speakerOnRef = useRef(speakerOn);
  const silenceTimerRef = useRef<any>(null);
  const speechAccumulatorRef = useRef<string>('');

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
      messagesRef.current = initialMessages;
    }
  }, [initialMessages]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    languageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  useEffect(() => {
    speakerOnRef.current = speakerOn;
  }, [speakerOn]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

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

  const rearmTimerRef = useRef<any>(null);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {
        // ignore
      }
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false);
    isSpeakingRef.current = false;
  }, []);

  const stopRecognition = useCallback(() => {
    if (rearmTimerRef.current) {
      clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {
        // ignore
      }
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }
    recognitionRef.current = null;
    recognitionRunningRef.current = false;
  }, []);

  const speakWithBrowser = useCallback(
    async (text: string): Promise<void> => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const arabic = isArabic(text);
      const voices = await getVoicesSafely();
      const voice = arabic
        ? pickArabicVoice(voices, selectedPersona)
        : pickEnglishVoice(voices, selectedPersona);

      const sentences = splitTextIntoSentences(text);
      if (sentences.length === 0) return;

      for (const sentence of sentences) {
        if (statusRef.current !== 'active' || !speakerOnRef.current || !isSpeakingRef.current) break;

        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(sentence);
          utterance.lang = arabic ? 'ar-EG' : 'en-US';
          utterance.rate = arabic ? 1.0 : selectedPersona === 'gwen' ? 1.05 : 1.02;
          utterance.pitch = selectedPersona === 'gwen' ? 1.05 : 0.94;
          if (voice) utterance.voice = voice;

          let keepAliveTimer: any = null;
          const cleanup = () => {
            if (keepAliveTimer) clearInterval(keepAliveTimer);
            resolve();
          };

          utterance.onend = cleanup;
          utterance.onerror = cleanup;

          keepAliveTimer = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
              clearInterval(keepAliveTimer);
            } else {
              window.speechSynthesis.resume();
            }
          }, 1500);

          window.speechSynthesis.speak(utterance);
        });
      }
    },
    [selectedPersona]
  );

  const scheduleRearm = useCallback((delayMs = 250) => {
    if (rearmTimerRef.current) {
      clearTimeout(rearmTimerRef.current);
    }
    rearmTimerRef.current = setTimeout(() => {
      if (
        statusRef.current === 'active' &&
        !mutedRef.current &&
        !isSpeakingRef.current &&
        !isProcessingRef.current
      ) {
        startRecognition();
      }
    }, delayMs);
  }, []);

  const createRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setRecognitionStatus('Speech recognition unavailable — use typed input fallback');
      return null;
    }

    // Clean up old instance if present
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    const currentLang = languageRef.current;
    recognition.lang = currentLang === 'English' ? 'en-US' : 'ar-EG';

    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      const lang = languageRef.current;
      setRecognitionStatus(`Listening actively (${lang === 'English' ? 'English' : 'Arabic - مصرية'})`);
      if (!isSpeakingRef.current && !isProcessingRef.current) {
        setMicStatus('Listening...');
      }
    };

    recognition.onresult = (event: any) => {
      if (isSpeakingRef.current || isProcessingRef.current) {
        return;
      }

      let capturedChunks = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const chunk = String(event.results[index][0]?.transcript || '').trim();
        if (event.results[index].isFinal) {
          speechAccumulatorRef.current = speechAccumulatorRef.current
            ? `${speechAccumulatorRef.current} ${chunk}`
            : chunk;
        } else {
          capturedChunks = capturedChunks ? `${capturedChunks} ${chunk}` : chunk;
        }
      }

      const currentDraft = (
        speechAccumulatorRef.current + (capturedChunks ? ` ${capturedChunks}` : '')
      ).trim();

      if (currentDraft) {
        setInterimTranscript(currentDraft);
        setMicStatus(`Listening: "${currentDraft.slice(-45)}"`);

        // Debounced silence detection: wait 850ms after user pauses before submitting
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        silenceTimerRef.current = setTimeout(() => {
          const finalSpokenText = (
            speechAccumulatorRef.current || currentDraft
          ).trim();

          if (
            finalSpokenText &&
            statusRef.current === 'active' &&
            !isProcessingRef.current &&
            !isSpeakingRef.current
          ) {
            speechAccumulatorRef.current = '';
            setInterimTranscript('');
            setMicStatus('Processing speech turn...');
            void submitTurn(finalSpokenText);
          }
        }, 850);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setRecognitionStatus('Microphone permission denied — typed input active');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setRecognitionStatus(`Speech recognition note: ${event.error || 'unknown'}`);
      }
    };

    recognition.onend = () => {
      recognitionRunningRef.current = false;
      if (
        statusRef.current === 'active' &&
        !mutedRef.current &&
        !isSpeakingRef.current &&
        !isProcessingRef.current
      ) {
        scheduleRearm(200);
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [scheduleRearm]);

  const startRecognition = useCallback(() => {
    if (
      statusRef.current !== 'active' ||
      mutedRef.current ||
      isSpeakingRef.current ||
      isProcessingRef.current
    ) {
      return;
    }

    try {
      let recognition = recognitionRef.current;
      if (!recognition || !recognitionRunningRef.current) {
        recognition = createRecognition();
      }
      if (!recognition) return;

      const currentLang = languageRef.current;
      recognition.lang = currentLang === 'English' ? 'en-US' : 'ar-EG';
      recognition.start();
      recognitionRunningRef.current = true;
    } catch (err: any) {
      if (err?.name === 'InvalidStateError' || String(err?.message || '').includes('already started')) {
        recognitionRunningRef.current = true;
      } else {
        scheduleRearm(350);
      }
    }
  }, [createRecognition, scheduleRearm]);

  const speak = useCallback(
    async (rawText: string): Promise<void> => {
      const text = sanitizeTextForSpeech(rawText);
      if (!text || !speakerOnRef.current || statusRef.current !== 'active') return;

      stopSpeaking();
      stopRecognition();
      setIsSpeaking(true);
      isSpeakingRef.current = true;
      setMicStatus('Jarvis is speaking...');

      try {
        const controller = new AbortController();
        const abortTimeout = setTimeout(() => controller.abort(), 6500);
        const response = await authedFetch('/api/audio/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(abortTimeout);

        if (response && response.ok) {
          const data = (await response.json().catch(() => null)) as {
            ok?: boolean;
            data_url?: string;
          } | null;

          if (data?.ok && data.data_url && isSpeakingRef.current) {
            const audio = new Audio(data.data_url);
            audioRef.current = audio;
            await new Promise<void>((resolve) => {
              const done = () => {
                audioRef.current = null;
                resolve();
              };
              audio.onended = done;
              audio.onerror = done;
              audio.play().catch(done);
            });
            return;
          }
        }
        await speakWithBrowser(text);
      } catch {
        await speakWithBrowser(text);
      } finally {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (statusRef.current === 'active' && !mutedRef.current && !isProcessingRef.current) {
          setMicStatus('Listening...');
          scheduleRearm(250);
        }
      }
    },
    [scheduleRearm, speakWithBrowser, stopRecognition, stopSpeaking]
  );

  const sendChatTurn = useCallback(
    async (text: string, sessionVersion: number) => {
      let reply = '';

      const musicCmd = parseMusicCommand(text);
      if (musicCmd) {
        window.dispatchEvent(
          new CustomEvent('jarvis:music:command', {
            detail: musicCmd,
          })
        );

        const isAr = isArabic(text);
        if (musicCmd.action === 'pause') {
          reply = isAr
            ? (selectedPersona === 'gwen' ? 'وقفتلك الموسيقى يا باشا تماماً.' : 'تم إيقاف تشغيل الموسيقى يا فندم فوراً.')
            : (selectedPersona === 'gwen' ? 'Music paused, boss!' : 'Music playback suspended, sir.');
        } else if (musicCmd.action === 'resume') {
          reply = isAr
            ? (selectedPersona === 'gwen' ? 'رجعت شغلتلك التراك يا باشا.' : 'تم استئناف تشغيل الموسيقى يا فندم.')
            : (selectedPersona === 'gwen' ? 'Resumed audio playback, boss!' : 'Resuming music playback, sir.');
        } else if (musicCmd.action === 'next') {
          reply = isAr
            ? (selectedPersona === 'gwen' ? 'شغلتلك التراك اللي بعده يا باشا.' : 'جاري الانتقال إلى التراك التالي يا فندم.')
            : (selectedPersona === 'gwen' ? 'Advancing to next track, boss!' : 'Advancing to the next track, sir.');
        } else if (musicCmd.action === 'prev') {
          reply = isAr
            ? (selectedPersona === 'gwen' ? 'رجعتلك للتراك اللي قبله يا باشا.' : 'جاري الرجوع إلى التراك السابق يا فندم.')
            : (selectedPersona === 'gwen' ? 'Previous track coming up, boss!' : 'Returning to previous track, sir.');
        } else {
          const targetIdx = findBestTrackIndex(musicCmd.query || '', DEFAULT_DEMO_TRACKS);
          const matched = DEFAULT_DEMO_TRACKS[targetIdx];
          const trackTitle = matched ? matched.title : (musicCmd.query || 'التراك المختار');
          reply = isAr
            ? (selectedPersona === 'gwen' ? `عيوني يا باشا! بشغلك ${trackTitle} حالاً.` : `تحت أمرك يا فندم، جاري تشغيل ${trackTitle} فوراً.`)
            : (selectedPersona === 'gwen' ? `Playing ${trackTitle} for you, boss!` : `Right away, sir. Commencing playback of ${trackTitle}.`);
        }

        // Notify backend session asynchronously so memory reflects the command
        if (onSendMessage) {
          onSendMessage(text, selectedPersona).catch(() => {});
        }
      } else if (onSendMessage) {
        try {
          reply = await onSendMessage(text, selectedPersona);
        } catch (err) {
          console.warn('[voice] onSendMessage failed:', err);
          const isAr = isArabic(text);
          const errMsg = err instanceof Error ? err.message : String(err || 'Communication error');
          if (selectedPersona === 'gwen') {
            reply = isAr
              ? `عذراً يا باشا، واجهت مشكلة في الاتصال بالنظام (${errMsg}). تقدر تكرر كلامك؟`
              : `Pardon me, boss! I encountered a connection issue (${errMsg}). Could you repeat your question?`;
          } else {
            reply = isAr
              ? `عذراً يا فندم، تعذر إتمام المعالجة عبر النواة المركزية (${errMsg}). يرجى تكرار الأمر.`
              : `Apologies, sir. Unable to communicate with the core intelligence (${errMsg}). Please repeat your request.`;
          }
        }
      }

      if (!reply) {
        const isAr = isArabic(text);
        if (selectedPersona === 'gwen') {
          reply = isAr
            ? `أهلاً يا باشا! أنا جوين مع حضرتك وسامعاك كويس جداً.`
            : `Hello boss! Gwen here, standing by for your instructions.`;
        } else {
          reply = isAr
            ? `تحت أمرك يا فندم، جارفيس في الخدمة وبانتظار توجيهاتك.`
            : `At your service, sir. Systems operational and standing by for your command.`;
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
      if (!text || isProcessingRef.current) return;
      if (statusRef.current !== 'active') {
        appendMessage('system', 'Please start the call session first by clicking "Start Call".');
        return;
      }

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      speechAccumulatorRef.current = '';

      stopSpeaking();
      stopRecognition();
      setInterimTranscript('');
      const arabic = isArabic(text);
      setDetectedLanguage(arabic ? 'Arabic' : 'English');
      appendMessage('user', text);

      setIsProcessing(true);
      isProcessingRef.current = true;
      setMicStatus('Jarvis is processing your request...');

      const sessionVersion = sessionVersionRef.current;
      try {
        await sendChatTurn(text, sessionVersion);
      } catch (error) {
        if (sessionVersion === sessionVersionRef.current && statusRef.current === 'active') {
          const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
          appendMessage('system', `Could not reach AI voice engine.${detail}`);
        }
      } finally {
        if (sessionVersion === sessionVersionRef.current) {
          setIsProcessing(false);
          isProcessingRef.current = false;
          if (statusRef.current === 'active' && !mutedRef.current && !isSpeakingRef.current) {
            setMicStatus('Listening...');
            scheduleRearm(250);
          }
        }
      }
    },
    [appendMessage, scheduleRearm, sendChatTurn, stopRecognition, stopSpeaking]
  );

  // Recognition Watchdog: Automatically re-arm if active and idling
  useEffect(() => {
    if (status !== 'active') return;

    const watchdog = setInterval(() => {
      if (
        statusRef.current === 'active' &&
        !mutedRef.current &&
        !isSpeakingRef.current &&
        !isProcessingRef.current &&
        !recognitionRunningRef.current
      ) {
        startRecognition();
      }
    }, 1500);

    return () => clearInterval(watchdog);
  }, [status, startRecognition]);

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
    stopRecognition();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setMicStatus('Microphone released');
    appendMessage('system', 'Voice call session terminated.');
  }, [appendMessage, stopRecognition, stopSpeaking]);

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
        stopRecognition();
      } else if (statusRef.current === 'active') {
        scheduleRearm(150);
      }
      return next;
    });
  }, [scheduleRearm, stopRecognition, stopSpeaking]);

  const handleTypedSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!typedInput.trim()) return;
    const text = typedInput.trim();
    setTypedInput('');
    void submitTurn(text);
  };

  const filteredSessions = useMemo(() => {
    if (!historySearch.trim()) return callSessions;
    const q = historySearch.toLowerCase();
    return callSessions.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.preview && s.preview.toLowerCase().includes(q)) ||
        s.id.toLowerCase().includes(q)
    );
  }, [callSessions, historySearch]);

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

        <div className="flex flex-wrap items-center gap-2">
          {/* Call History Drawer Toggle */}
          <button
            onClick={() => setShowHistory((prev) => !prev)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold font-mono flex items-center gap-1.5 transition-all ${
              showHistory
                ? 'bg-[#00f0ff] text-slate-950 shadow-[0_0_12px_rgba(0,240,255,0.4)]'
                : 'bg-[#020b14] border border-[#00f0ff]/40 text-[#80f7ff] hover:bg-[#00f0ff]/10 hover:border-[#00f0ff]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History ({callSessions.length})</span>
          </button>

          {/* New Call Button */}
          {onNewSession && (
            <button
              onClick={() => {
                onNewSession();
                setShowHistory(false);
              }}
              title="Start a fresh voice call session"
              className="px-2.5 py-1 rounded-lg text-xs font-semibold font-mono bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20 transition-all flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          )}

          {/* Language selector tabs */}
          <div className="flex bg-[#030712] border border-[#00f0ff]/30 rounded-lg p-1 text-xs">
            <button
              onClick={() => {
                setSelectedLanguage('Arabic');
                languageRef.current = 'Arabic';
                stopRecognition();
                scheduleRearm(150);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                selectedLanguage === 'Arabic'
                  ? 'bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/50 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                  : 'text-[#80f7ff]/50 hover:text-[#e5e2e1]'
              }`}
            >
              عربي (EG)
            </button>
            <button
              onClick={() => {
                setSelectedLanguage('English');
                languageRef.current = 'English';
                stopRecognition();
                scheduleRearm(150);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                selectedLanguage === 'English'
                  ? 'bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/50 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                  : 'text-[#80f7ff]/50 hover:text-[#e5e2e1]'
              }`}
            >
              English
            </button>
            <button
              onClick={() => {
                setSelectedLanguage('Auto');
                languageRef.current = 'Auto';
                stopRecognition();
                scheduleRearm(150);
              }}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                selectedLanguage === 'Auto'
                  ? 'bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/50 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                  : 'text-[#80f7ff]/50 hover:text-[#e5e2e1]'
              }`}
            >
              Auto
            </button>
          </div>

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
        {/* Active Session & Memory Bar */}
        <div className="bg-[#020b14] border border-[#00f0ff]/20 px-3 py-2 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#00f0ff] animate-pulse" />
            <span className="text-[#80f7ff]/70">Session:</span>
            <span className="text-[#00f0ff] font-bold truncate max-w-xs md:max-w-md">
              {activeSessionTitle || (activeSessionId ? `Session ${activeSessionId.slice(0, 14)}` : 'Live Continuous Session')}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#80f7ff]/60">
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Persistent Memory Active
            </span>
            <span>•</span>
            <span>{messages.filter((m) => m.sender !== 'system').length} turns</span>
          </div>
        </div>

        {/* Call History Panel (Drawer) */}
        {showHistory && (
          <div className="bg-[#051120] border border-[#00f0ff]/40 rounded-xl p-4 space-y-3 font-mono shadow-[0_0_25px_rgba(0,240,255,0.15)] animate-in fade-in-50 duration-200">
            <div className="flex items-center justify-between border-b border-[#00f0ff]/20 pb-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#00f0ff]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#00f0ff]">
                  Jarvis Voice Sessions & Call History
                </span>
                <span className="text-[10px] bg-[#00f0ff]/20 text-[#00f0ff] px-1.5 py-0.5 rounded-full">
                  {callSessions.length} saved
                </span>
              </div>
              <div className="flex items-center gap-2">
                {onNewSession && (
                  <button
                    onClick={() => {
                      onNewSession();
                      setShowHistory(false);
                    }}
                    className="px-2.5 py-1 bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-slate-950 font-bold rounded text-[11px] flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-3 h-3" /> Start New Call Session
                  </button>
                )}
                {onRefreshSessions && (
                  <button
                    onClick={onRefreshSessions}
                    className="p-1 text-slate-400 hover:text-[#00f0ff] transition-colors"
                    title="Refresh list"
                  >
                    <Radio className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Filter Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search past conversations and projects..."
                className="w-full bg-[#020b14] border border-[#00f0ff]/25 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#00f0ff]"
              />
            </div>

            {/* Session Cards List */}
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {isHistoryLoading ? (
                <div className="flex items-center justify-center py-6 text-xs text-[#00f0ff] gap-2">
                  <LoaderCircle className="w-4 h-4 animate-spin" /> Loading call history from memory...
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500 font-sans">
                  {callSessions.length === 0
                    ? 'No past voice call sessions found yet. Start talking to begin recording persistent history!'
                    : 'No sessions match your search query.'}
                </div>
              ) : (
                filteredSessions.map((s: SessionInfo) => {
                  const isCurrent = s.id === activeSessionId;
                  const timeFormatted = s.last_active
                    ? new Date(s.last_active * 1000).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Recent';

                  return (
                    <div
                      key={s.id}
                      className={`p-2.5 rounded-lg border transition-all flex items-center justify-between gap-3 text-xs ${
                        isCurrent
                          ? 'bg-[#00f0ff]/15 border-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.25)]'
                          : 'bg-[#020b14]/80 border-[#00f0ff]/20 hover:border-[#00f0ff]/50 hover:bg-[#020b14]'
                      }`}
                    >
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200 truncate">
                            {s.title || `Session ${s.id.slice(0, 12)}`}
                          </span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.2 bg-[#00f0ff]/30 text-[#00f0ff] rounded text-[10px] font-bold uppercase">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-[#80f7ff]/60" />
                            {timeFormatted}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-[#80f7ff]/60" />
                            {s.message_count} turns
                          </span>
                        </div>
                        {s.preview && (
                          <p className="text-[11px] text-slate-400/80 truncate font-sans">
                            {s.preview}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => {
                            onSelectSession?.(s.id);
                            setShowHistory(false);
                          }}
                          className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
                            isCurrent
                              ? 'bg-[#00f0ff] text-slate-950'
                              : 'bg-[#00f0ff]/20 text-[#00f0ff] hover:bg-[#00f0ff]/30'
                          }`}
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>{isCurrent ? 'Current' : 'Resume'}</span>
                        </button>
                        {onDeleteSession && (
                          <button
                            onClick={() => {
                              if (window.confirm('Delete this conversation history from memory?')) {
                                onDeleteSession(s.id);
                              }
                            }}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors rounded hover:bg-rose-950/40"
                            title="Delete session"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

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
            <span className="text-[10px] text-[#80f7ff]/60 uppercase">Sentinel Engine & Mic</span>
            <span className="text-xs truncate text-[#80f7ff]">{micStatus} • {recognitionStatus}</span>
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

            {isSpeaking && (
              <button
                onClick={() => {
                  stopSpeaking();
                  if (statusRef.current === 'active' && !mutedRef.current && !isProcessingRef.current) {
                    setMicStatus('Listening...');
                    scheduleRearm(100);
                  }
                }}
                className="px-4 py-2.5 bg-amber-500/20 border border-amber-500 text-amber-300 rounded-lg text-xs font-bold flex items-center gap-1.5 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)] hover:bg-amber-500/30 transition-all"
              >
                <Radio className="w-4 h-4 text-amber-400" /> Interrupt Speaking
              </button>
            )}
          </div>

          <div className="text-[11px] font-mono text-[#80f7ff]/60 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[#00f0ff] animate-pulse" /> Full Duplex Sentinel
          </div>
        </div>
      </div>
    </div>
  );
};
