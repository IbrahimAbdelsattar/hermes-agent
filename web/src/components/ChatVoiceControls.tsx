import { Button } from "@nous-research/ui/ui/components/button";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EventsFeedClient } from "@/lib/eventsFeedClient";
import {
  EVENTS_MAX_RECONNECT_ATTEMPTS,
  eventsReconnectDelayMs,
  isEventsAuthRejection,
  shouldRetryEventsClose,
} from "@/lib/events-reconnect";
import {
  cleanSpokenText,
  extractNextSpokenSentence,
} from "@/lib/speechUtils";
import {
  normalizeVoicePrompt,
  recognitionTranscript,
  type VoiceRecognitionEvent,
} from "@/lib/chat-voice";
import { speakWithNabra, stopNabraAudio } from "@/utils/jarvisSpeechUtils";

interface ChatVoiceControlsProps {
  channel: string;
  connected: boolean;
  foreground: string;
  onSubmit: (text: string) => boolean;
}

interface RecognitionErrorLike {
  error?: string;
}

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: VoiceRecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

function speechRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (
    window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    }
  ).SpeechRecognition ?? (
    window as typeof window & { webkitSpeechRecognition?: RecognitionConstructor }
  ).webkitSpeechRecognition;
  return candidate ?? null;
}

export function ChatVoiceControls({
  channel,
  connected,
  foreground,
  onSubmit,
}: ChatVoiceControlsProps) {
  const feed = useMemo(() => new EventsFeedClient(), []);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Voice ready");
  const [draft, setDraft] = useState("");

  const liveEnabledRef = useRef(false);
  const speechEnabledRef = useRef(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const recognitionRunningRef = useRef(false);
  const assistantBusyRef = useRef(false);
  const waitingForReplyRef = useRef(false);
  const rawReplyRef = useRef("");
  const spokenIndexRef = useRef(0);
  const speechQueueRef = useRef<string[]>([]);
  const speakingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const startListeningRef = useRef<() => void>(() => undefined);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognitionRunningRef.current = false;
    setListening(false);
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // The browser may already have ended this recognition generation.
    }
  }, []);

  const maybeResumeListening = useCallback(() => {
    if (
      liveEnabledRef.current &&
      connected &&
      !assistantBusyRef.current &&
      !waitingForReplyRef.current &&
      !speakingRef.current
    ) {
      window.setTimeout(() => startListeningRef.current(), 180);
    }
  }, [connected]);

  const pumpSpeechQueue = useCallback(async () => {
    if (speakingRef.current || !speechEnabledRef.current) {
      return;
    }
    speakingRef.current = true;
    const generation = speechGenerationRef.current;
    stopRecognition();
    setStatus("Jarvis speaking");
    while (
      mountedRef.current &&
      speechEnabledRef.current &&
      generation === speechGenerationRef.current
    ) {
      const next = speechQueueRef.current.shift();
      if (!next) break;
      await speakWithNabra(next, "jarvis", false);
    }
    if (generation !== speechGenerationRef.current) return;
    speakingRef.current = false;
    maybeResumeListening();
  }, [maybeResumeListening, stopRecognition]);

  const drainReply = useCallback(
    (flush: boolean) => {
      const clean = cleanSpokenText(rawReplyRef.current);
      while (spokenIndexRef.current < clean.length) {
        const extracted = extractNextSpokenSentence(clean, spokenIndexRef.current);
        if (!extracted) break;
        speechQueueRef.current.push(extracted.sentence);
        spokenIndexRef.current = extracted.nextIndex;
      }
      if (flush) {
        const remainder = clean.slice(spokenIndexRef.current).trim();
        if (remainder) speechQueueRef.current.push(remainder);
        spokenIndexRef.current = clean.length;
      }
      void pumpSpeechQueue();
    },
    [pumpSpeechQueue],
  );

  const startListening = useCallback(() => {
    if (
      !liveEnabledRef.current ||
      !connected ||
      assistantBusyRef.current ||
      waitingForReplyRef.current ||
      speakingRef.current ||
      recognitionRunningRef.current
    ) {
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      liveEnabledRef.current = false;
      setLiveEnabled(false);
      setStatus("Speech recognition is unavailable in this browser");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language?.toLowerCase().startsWith("ar")
      ? "ar-EG"
      : "en-US";
    recognitionRef.current = recognition;
    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setListening(true);
      setStatus("Listening — speak your command");
    };
    recognition.onresult = (event) => {
      const transcript = recognitionTranscript(event);
      if (transcript.interim) setDraft(transcript.interim);
      const prompt = normalizeVoicePrompt(transcript.final);
      if (!prompt) return;
      setDraft(prompt);
      waitingForReplyRef.current = true;
      assistantBusyRef.current = true;
      stopRecognition();
      if (onSubmit(prompt)) {
        setDraft("");
        setStatus("Sent to Hermes");
      } else {
        waitingForReplyRef.current = false;
        assistantBusyRef.current = false;
        setStatus("Chat is reconnecting");
        maybeResumeListening();
      }
    };
    recognition.onerror = (event) => {
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      if (denied) {
        liveEnabledRef.current = false;
        setLiveEnabled(false);
        setStatus("Microphone permission was denied");
      } else if (event.error !== "aborted" && event.error !== "no-speech") {
        setStatus(`Speech recognition error: ${event.error ?? "unknown"}`);
      }
    };
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      maybeResumeListening();
    };
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      recognitionRunningRef.current = false;
      setStatus("Could not start the microphone");
    }
  }, [connected, maybeResumeListening, onSubmit, stopRecognition]);
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const toggleLive = useCallback(() => {
    const next = !liveEnabledRef.current;
    liveEnabledRef.current = next;
    setLiveEnabled(next);
    setDraft("");
    if (next) {
      setStatus(connected ? "Starting microphone" : "Chat is reconnecting");
      window.setTimeout(() => startListeningRef.current(), 0);
    } else {
      waitingForReplyRef.current = false;
      stopRecognition();
      setStatus("Microphone off");
    }
  }, [connected, stopRecognition]);

  const toggleSpeech = useCallback(() => {
    const next = !speechEnabledRef.current;
    speechEnabledRef.current = next;
    setSpeechEnabled(next);
    if (next) {
      setStatus("Spoken replies on");
      drainReply(false);
    } else {
      speechGenerationRef.current += 1;
      speechQueueRef.current = [];
      speakingRef.current = false;
      stopNabraAudio();
      setStatus("Spoken replies off");
      maybeResumeListening();
    }
  }, [drainReply, maybeResumeListening]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRecognition();
      stopNabraAudio();
    };
  }, [stopRecognition]);

  useEffect(() => {
    if (!connected) {
      stopRecognition();
      setStatus("Chat is reconnecting");
    } else {
      maybeResumeListening();
    }
  }, [connected, maybeResumeListening, stopRecognition]);

  useEffect(() => {
    if (!liveEnabled && !speechEnabled) {
      feed.close();
      return;
    }
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = async () => {
      try {
        await feed.connect(channel);
      } catch {
        if (!disposed && feed.lastCloseCode === null) scheduleReconnect();
      }
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer || attempt >= EVENTS_MAX_RECONNECT_ATTEMPTS) return;
      const delay = eventsReconnectDelayMs(attempt++);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };
    const offClose = feed.onClose((code) => {
      if (code !== undefined && isEventsAuthRejection(code)) return;
      if (shouldRetryEventsClose(code)) scheduleReconnect();
    });
    const offState = feed.onState((state) => {
      if (state === "open") attempt = 0;
    });
    const offStart = feed.on("message.start", () => {
      assistantBusyRef.current = true;
      waitingForReplyRef.current = true;
      rawReplyRef.current = "";
      spokenIndexRef.current = 0;
      speechGenerationRef.current += 1;
      speechQueueRef.current = [];
      speakingRef.current = false;
      stopRecognition();
      stopNabraAudio();
      setDraft("");
      setStatus("Hermes is working");
    });
    const offDelta = feed.on("message.delta", (event) => {
      const text = typeof event.payload?.text === "string" ? event.payload.text : "";
      if (!text) return;
      rawReplyRef.current += text;
      if (speechEnabledRef.current) drainReply(false);
    });
    const offComplete = feed.on("message.complete", (event) => {
      const finalText = typeof event.payload?.text === "string" ? event.payload.text : "";
      if (finalText && finalText.startsWith(rawReplyRef.current)) {
        rawReplyRef.current = finalText;
      } else if (!rawReplyRef.current && finalText) {
        rawReplyRef.current = finalText;
      }
      assistantBusyRef.current = false;
      waitingForReplyRef.current = false;
      if (speechEnabledRef.current && event.payload?.status !== "error") {
        drainReply(true);
      } else {
        setStatus("Voice ready");
        maybeResumeListening();
      }
    });

    void connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      offClose();
      offState();
      offStart();
      offDelta();
      offComplete();
      feed.close();
    };
  }, [channel, drainReply, feed, liveEnabled, maybeResumeListening, speechEnabled, stopRecognition]);

  const voiceSupported = speechRecognitionConstructor() !== null;
  return (
    <div
      className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded border border-current/20 bg-black/25 px-2 py-1.5 text-xs"
      style={{ color: foreground }}
      aria-label="Jarvis voice controls"
    >
      <Button
        ghost
        size="sm"
        onClick={toggleLive}
        disabled={!voiceSupported}
        aria-pressed={liveEnabled}
        title={voiceSupported ? "Toggle hands-free speech recognition" : "Speech recognition unavailable"}
        className="h-7 gap-1.5 border border-current/25 px-2"
      >
        {liveEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        {listening ? "Listening" : liveEnabled ? "Live mic" : "Mic"}
      </Button>
      <Button
        ghost
        size="sm"
        onClick={toggleSpeech}
        aria-pressed={speechEnabled}
        title="Toggle spoken Hermes replies"
        className="h-7 gap-1.5 border border-current/25 px-2"
      >
        {speechEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        {speechEnabled ? "Voice on" : "Voice off"}
      </Button>
      <span className="min-w-0 flex-1 truncate opacity-75" role="status">
        {draft || status}
      </span>
    </div>
  );
}
