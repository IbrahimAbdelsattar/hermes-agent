import { Button } from "@nous-research/ui/ui/components/button";
import {
  Globe,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Send,
  User,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
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
  detectDominantScript,
  getVoicePauseTimeoutMs,
  nextAutoRecognitionLang,
  normalizeVoicePrompt,
  STT_MODE_LABELS,
  TTS_ENGINE_LABELS,
  VOICE_PERSONA_LABELS,
  VOICE_PERSONA_STORAGE_KEY,
  type SttMode,
  type TtsEngine,
  type VoiceLanguageMode,
  type VoicePersona,
  type VoiceRecognitionEvent,
} from "@/lib/chat-voice";
import { mergeSentencesForNetworkTts, stopOpenRouterAudio, TtsPrefetchPipeline } from "@/lib/chat-voice-tts";
import { transcribeAudioBlob } from "@/lib/server-transcribe";
import { speakWithNabra, stopNabraAudio } from "@/utils/jarvisSpeechUtils";
import {
  classifyJevFastPath,
  evaluateJevIntent,
  executeJevFastPath,
  isJevFastPathEnabled,
  setJevFastPathEnabled,
} from "@/utils/jarvisJevClient";
import { JarvisUltronVoiceOrb } from "./JarvisUltronVoiceOrb";

const VOICE_LANG_STORAGE_KEY = "hermes_chat_voice_lang";
const ORB_MODE_STORAGE_KEY = "hermes_chat_orb_mode";
const STT_MODE_STORAGE_KEY = "hermes_chat_stt_mode";
const TTS_ENGINE_STORAGE_KEY = "hermes_chat_tts_engine";
const SPEECH_STORAGE_KEY = "hermes_chat_speech_enabled";

/**
 * Max buffered utterance audio: ~2min at the 1s MediaRecorder timeslice.
 * Bounds memory when the mic stays on idly; normal turns keep the full
 * capture from session start.
 */
const MAX_UTTERANCE_CHUNKS = 120;
/** Upper bound for the recorder's async stop handshake on submit. */
const UTTERANCE_STOP_TIMEOUT_MS = 1500;

/** The component's baseline "nothing happening" status. */
const VOICE_READY_STATUS = "Voice ready";

/**
 * Statuses the speech pump itself writes. On a normal drain they must not
 * outlive the audio: with the mic off, maybeResumeListening never restarts
 * recognition (the thing that normally refreshes the status), so the stale
 * "Hermes speaking" would sit on screen indefinitely. Statuses written by
 * other paths while the pump was awaiting (mute, new message, reconnect)
 * are not in this set and are never overwritten.
 */
const PUMP_OWNED_STATUSES = new Set([
  "Hermes speaking",
  "OpenRouter TTS unavailable — using the browser voice",
  "Flux is English-only — used Fish for Arabic",
]);

/**
 * The user's explicit Voice choice. `null` means they never touched the
 * Voice toggle, so spoken replies simply follow the mic: enabling the Mic
 * enables speech. An explicit choice (persisted) always wins over the
 * default so a deliberate mute survives reloads.
 */
const readStoredSpeechPreference = (): "on" | "off" | null => {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(SPEECH_STORAGE_KEY);
    return saved === "on" || saved === "off" ? saved : null;
  } catch {
    return null;
  }
};

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
  const storedSpeechPreference = readStoredSpeechPreference();
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(storedSpeechPreference === "on");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState(VOICE_READY_STATUS);
  const [draft, setDraft] = useState("");
  const [pauseCountdown, setPauseCountdown] = useState<number | null>(null);

  const [stageMode, setStageMode] = useState<"compact" | "expanded">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(ORB_MODE_STORAGE_KEY);
        if (saved === "compact" || saved === "expanded") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "compact";
  });

  const [languageMode, setLanguageMode] = useState<VoiceLanguageMode>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(VOICE_LANG_STORAGE_KEY);
        if (saved === "en" || saved === "ar" || saved === "auto") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "en";
  });

  const languageModeRef = useRef<VoiceLanguageMode>(languageMode);
  const activeAutoLangRef = useRef<"en-US" | "ar-EG">("en-US");

  const [sttMode, setSttMode] = useState<SttMode>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STT_MODE_STORAGE_KEY);
        if (saved === "browser" || saved === "server") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "browser";
  });

  const [ttsEngine, setTtsEngine] = useState<TtsEngine>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(TTS_ENGINE_STORAGE_KEY);
        if (saved === "browser" || saved === "flux" || saved === "fish") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "browser";
  });

  const [voicePersona, setVoicePersona] = useState<VoicePersona>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(VOICE_PERSONA_STORAGE_KEY);
        if (saved === "jarvis" || saved === "gwen") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "jarvis";
  });

  const voicePersonaRef = useRef<VoicePersona>(voicePersona);
  useEffect(() => {
    voicePersonaRef.current = voicePersona;
  }, [voicePersona]);

  const [jevEnabled, setJevEnabled] = useState<boolean>(() => isJevFastPathEnabled());
  const jevEnabledRef = useRef<boolean>(jevEnabled);
  useEffect(() => {
    jevEnabledRef.current = jevEnabled;
  }, [jevEnabled]);

  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const liveEnabledRef = useRef(false);
  const speechEnabledRef = useRef(storedSpeechPreference === "on");
  const speechExplicitRef = useRef(storedSpeechPreference !== null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const recognitionRunningRef = useRef(false);
  const assistantBusyRef = useRef(false);
  const waitingForReplyRef = useRef(false);

  const speechAccumulatorRef = useRef("");
  const interimDraftRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // "STT: Server" mode: MediaRecorder captures the utterance while browser
  // recognition still drives endpointing; the backend transcribes the blob.
  const utteranceRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  // Bounded retry for Chrome's InvalidStateError when a session starts too
  // soon after the previous one ended.
  const startRetryCountRef = useRef(0);

  const rawReplyRef = useRef("");
  const spokenIndexRef = useRef(0);
  const speechQueueRef = useRef<string[]>([]);
  const speakingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const prefetchPipelineRef = useRef<TtsPrefetchPipeline | null>(null);
  const mountedRef = useRef(true);
  const startListeningRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    languageModeRef.current = languageMode;
  }, [languageMode]);

  const sttModeRef = useRef<SttMode>(sttMode);
  const ttsEngineRef = useRef<TtsEngine>(ttsEngine);

  useEffect(() => {
    sttModeRef.current = sttMode;
  }, [sttMode]);
  useEffect(() => {
    ttsEngineRef.current = ttsEngine;
  }, [ttsEngine]);

  /** Begin capturing the current utterance (server STT mode only). */
  const startUtteranceRecorder = useCallback(() => {
    if (sttModeRef.current !== "server") return;
    if (utteranceRecorderRef.current || !mediaStreamRef.current) return;
    if (typeof MediaRecorder === "undefined") return;
    recordedChunksRef.current = [];
    try {
      const recorder = new MediaRecorder(mediaStreamRef.current);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          // Drop the oldest slices past the cap so an idle mic left on
          // indefinitely cannot grow the buffer without bound.
          const excess = recordedChunksRef.current.length - MAX_UTTERANCE_CHUNKS;
          if (excess > 0) recordedChunksRef.current.splice(0, excess);
        }
      };
      // Timeslice keeps partial audio usable even if the tab dies mid-turn.
      recorder.start(1000);
      utteranceRecorderRef.current = recorder;
    } catch {
      // Recording is best-effort; the browser transcript remains the fallback.
    }
  }, []);

  /** Stop the utterance recorder and resolve with the captured blob (or null). */
  const stopUtteranceRecorder = useCallback((): Promise<Blob | null> => {
    const recorder = utteranceRecorderRef.current;
    utteranceRecorderRef.current = null;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve(null);
    }
    return new Promise<Blob | null>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => finish(null), UTTERANCE_STOP_TIMEOUT_MS);
      const finish = (blob: Blob | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(blob);
      };
      recorder.onstop = () => {
        finish(new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      try {
        recorder.stop();
      } catch {
        finish(null);
      }
    });
  }, []);

  const startAudioAnalyser = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!liveEnabledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      // The mic stream can resolve after recognition already started: kick
      // off server-STT capture now so the utterance onset is not clipped.
      if (sttModeRef.current === "server" && recognitionRunningRef.current) {
        startUtteranceRecorder();
      }
      const AudioCtxCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxCtor) {
        const ctx = new AudioCtxCtor();
        audioContextRef.current = ctx;
        if (ctx.state === "suspended") {
          void ctx.resume();
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        setMicAnalyser(analyser);
      }
    } catch (e) {
      console.warn("[ChatVoiceControls] Mic audio analyser setup note:", e);
    }
  }, [startUtteranceRecorder]);

  const stopAudioAnalyser = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicAnalyser(null);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPauseCountdown(null);
  }, []);

  const stopRecognition = useCallback(() => {
    clearSilenceTimer();
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
  }, [clearSilenceTimer]);

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

  const submitCurrentDraftRef = useRef<() => boolean>(() => false);
  const toggleLiveRef = useRef<() => void>(() => undefined);

  const submitTranscribed = useCallback(
    (finalPrompt: string, note: string) => {
      // Jev fast-path intent triage (<1ms local check, plus OpenRouter Decisions)
      if (jevEnabledRef.current) {
        const isAr = languageModeRef.current === "ar" || /[\u0600-\u06FF]/.test(finalPrompt);
        const persona = voicePersonaRef.current;
        const fastDecision = classifyJevFastPath(finalPrompt, isAr);
        if (fastDecision && fastDecision.bypass_llm) {
          setStatus(`Jev: ${fastDecision.route}`);
          if (speechEnabledRef.current && fastDecision.spoken_confirmation) {
            void speakWithNabra(fastDecision.spoken_confirmation, persona, false);
          }
          void executeJevFastPath(fastDecision);
          waitingForReplyRef.current = false;
          assistantBusyRef.current = false;
          if (fastDecision.route === "standby") {
            toggleLiveRef.current();
          } else {
            maybeResumeListening();
          }
          return true;
        }

        // For ambiguous non-fast-path intents, evaluate via OpenRouter Decisions asynchronously
        void (async () => {
          try {
            const decision = await evaluateJevIntent(
              finalPrompt,
              isAr ? "arabic_egyptian" : "english",
              persona,
            );
            if (decision.bypass_llm && decision.confidence >= 0.85) {
              setStatus(`Jev: ${decision.route} (${decision.provider})`);
              if (speechEnabledRef.current && decision.spoken_confirmation) {
                void speakWithNabra(decision.spoken_confirmation, persona, false);
              }
              void executeJevFastPath(decision);
            }
          } catch {
            // ignore
          }
        })();
      }

      if (onSubmit(finalPrompt)) {
        setStatus(note);
        return true;
      }
      waitingForReplyRef.current = false;
      assistantBusyRef.current = false;
      setStatus("Chat is reconnecting");
      maybeResumeListening();
      return false;
    },
    [maybeResumeListening, onSubmit],
  );

  const submitCurrentDraft = useCallback((): boolean => {
    clearSilenceTimer();
    const fullText = (
      speechAccumulatorRef.current +
      (interimDraftRef.current ? ` ${interimDraftRef.current}` : "")
    ).trim();
    const prompt = normalizeVoicePrompt(fullText);
    if (!prompt) return false;

    // Clear the draft synchronously so a second trigger racing the first
    // (silence timer vs Send click) can never resubmit the same utterance.
    speechAccumulatorRef.current = "";
    interimDraftRef.current = "";
    setDraft("");

    waitingForReplyRef.current = true;
    assistantBusyRef.current = true;
    stopRecognition();
    const recording = stopUtteranceRecorder();

    if (sttModeRef.current !== "server") {
      return submitTranscribed(prompt, "Sent to Hermes");
    }

    // Server mode: transcribe the captured recording, then submit the
    // backend's transcript. The browser draft is the fallback when the
    // request fails or the provider hears nothing, so the turn is never
    // dropped by the accurate path.
    setStatus("Transcribing on server…");
    void (async () => {
      let finalPrompt = prompt;
      try {
        const blob = await recording;
        if (blob && blob.size > 0) {
          finalPrompt = await transcribeAudioBlob(blob, prompt);
        }
      } catch {
        // keep the browser draft
      }
      if (!mountedRef.current) return;
      submitTranscribed(finalPrompt, "Sent to Hermes (server transcript)");
    })();
    return true;
  }, [clearSilenceTimer, stopRecognition, stopUtteranceRecorder, submitTranscribed]);

  useEffect(() => {
    submitCurrentDraftRef.current = submitCurrentDraft;
  }, [submitCurrentDraft]);

  /** Restart the pause countdown + silence timer for the buffered draft. */
  const armPauseTimer = useCallback(
    (draftText: string, isFinal = false) => {
      clearSilenceTimer();
      const timeoutMs = getVoicePauseTimeoutMs(draftText, { isFinal });
      const deadline = Date.now() + timeoutMs;
      setPauseCountdown(Math.ceil(timeoutMs / 1000));

      countdownIntervalRef.current = setInterval(() => {
        const remainingMs = Math.max(0, deadline - Date.now());
        setPauseCountdown(Math.ceil(remainingMs / 1000));
        if (remainingMs <= 0 && countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }, 200);

      silenceTimerRef.current = setTimeout(() => {
        submitCurrentDraftRef.current();
      }, timeoutMs);
    },
    [clearSilenceTimer],
  );

  const pumpSpeechQueue = useCallback(async () => {
    if (speakingRef.current || !speechEnabledRef.current) {
      return;
    }
    speakingRef.current = true;
    setIsAssistantSpeaking(true);
    const generation = speechGenerationRef.current;
    stopRecognition();
    setStatus("Hermes speaking");

    const engine = ttsEngineRef.current;
    const persona = voicePersonaRef.current;
    const useNetwork = engine !== "browser";

    // For network TTS: merge short sentences and prefetch audio in parallel
    // so the next sentence's audio is already downloaded when the current
    // one finishes playing — eliminating the inter-sentence gap.
    if (useNetwork) {
      const raw = speechQueueRef.current.splice(0);
      const merged = mergeSentencesForNetworkTts(raw);
      const pipeline = new TtsPrefetchPipeline(engine, persona);
      prefetchPipelineRef.current = pipeline;
      pipeline.enqueue(merged);

      while (
        mountedRef.current &&
        speechEnabledRef.current &&
        generation === speechGenerationRef.current &&
        pipeline.hasNext()
      ) {
        // Drain newly arrived sentences into the pipeline as they stream in.
        if (speechQueueRef.current.length > 0) {
          const fresh = speechQueueRef.current.splice(0);
          const freshMerged = mergeSentencesForNetworkTts(fresh);
          pipeline.enqueue(freshMerged);
        }
        const result = await pipeline.playNext();
        if (generation !== speechGenerationRef.current) break;
        if (result.fallbackToFish) {
          setStatus("Flux is English-only — used Fish for Arabic");
        }
        // Prefetch failed for this sentence: fall back to browser voice.
        // A cancellation during the await must not double-speak.
        if (!result.spoke && generation === speechGenerationRef.current) {
          setStatus("OpenRouter TTS unavailable — using the browser voice");
          // Recover the failed sentence and any remaining pipeline entries
          // so the browser-voice loop below can speak them.
          const remaining = pipeline.drainTexts();
          if (result.text) speechQueueRef.current.unshift(result.text);
          speechQueueRef.current.push(...remaining);
          pipeline.cancel();
          break;
        }
      }
      prefetchPipelineRef.current = null;
    }

    // Browser voice path (also serves as fallback when OpenRouter fails).
    while (
      mountedRef.current &&
      speechEnabledRef.current &&
      generation === speechGenerationRef.current
    ) {
      const next = speechQueueRef.current.shift();
      if (!next) break;
      await speakWithNabra(next, persona, false);
    }

    if (generation !== speechGenerationRef.current) return;
    speakingRef.current = false;
    setIsAssistantSpeaking(false);
    // The drain finished normally: hand the status line back. Only a status
    // the pump itself wrote is replaced — anything another path wrote while
    // the pump was awaiting (mute, new message, reconnect) wins.
    setStatus((current) =>
      PUMP_OWNED_STATUSES.has(current) ? VOICE_READY_STATUS : current,
    );
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
    recognition.continuous = true;
    recognition.interimResults = true;

    const mode = languageModeRef.current;
    let targetLang = "en-US";
    if (mode === "ar") {
      targetLang = "ar-EG";
    } else if (mode === "auto") {
      targetLang = activeAutoLangRef.current || "en-US";
    } else {
      targetLang = "en-US";
    }
    recognition.lang = targetLang;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      startRetryCountRef.current = 0;
      recognitionRunningRef.current = true;
      // Server STT mode: begin capturing BEFORE the first word so the
      // backend transcript includes the utterance onset. No-op when already
      // recording — recognition restarts mid-turn must not discard audio —
      // and each submitted turn stops the recorder, so the next turn starts
      // a fresh capture here.
      if (sttModeRef.current === "server") startUtteranceRecorder();
      setListening(true);
      const label =
        mode === "ar"
          ? "Arabic"
          : mode === "en"
            ? "English"
            : `Auto (${targetLang === "ar-EG" ? "AR" : "EN"})`;
      setStatus(`Listening (${label}) — speak your command`);
    };

    recognition.onresult = (event) => {
      let finalChunks = "";
      let interimChunks = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = String(res?.[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (res.isFinal) {
          finalChunks = finalChunks ? `${finalChunks} ${text}` : text;
        } else {
          interimChunks = interimChunks ? `${interimChunks} ${text}` : text;
        }
      }

      if (finalChunks) {
        speechAccumulatorRef.current = speechAccumulatorRef.current
          ? `${speechAccumulatorRef.current} ${finalChunks}`
          : finalChunks;
      }
      interimDraftRef.current = interimChunks;

      const currentDraft = (
        speechAccumulatorRef.current +
        (interimChunks ? ` ${interimChunks}` : "")
      ).trim();

      if (!currentDraft) return;

      setDraft(currentDraft);

      // Backstop: capture normally starts on recognition start (before the
      // first word); retry here in case the mic stream was not ready then.
      // The recorder runs until the draft is submitted.
      if (!utteranceRecorderRef.current) startUtteranceRecorder();

      const hasFinalText = speechAccumulatorRef.current.trim().length > 0;

      // In auto mode, adapt language on detected script. Web Speech cannot
      // change lang mid-session: when the script flips, restart the session
      // with the new language while keeping the buffered draft — otherwise
      // the rest of the utterance keeps being Latinized by the old engine.
      if (languageModeRef.current === "auto") {
        const nextLang = nextAutoRecognitionLang(
          activeAutoLangRef.current,
          detectDominantScript(currentDraft),
        );
        if (nextLang !== activeAutoLangRef.current) {
          activeAutoLangRef.current = nextLang;
          stopRecognition();
          armPauseTimer(currentDraft, hasFinalText);
          window.setTimeout(() => startListeningRef.current(), 250);
          return;
        }
      }

      armPauseTimer(currentDraft, hasFinalText);
    };

    recognition.onerror = (event) => {
      const denied =
        event.error === "not-allowed" || event.error === "service-not-allowed";
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
      // Rearm even while a draft is buffered: Chrome ends a continuous
      // session after a few seconds of silence (or a no-speech/network
      // error), and speech dictated afterwards must still be captured into
      // the pending draft instead of being lost until the turn completes.
      // maybeResumeListening keeps its own guards (live, connected, not
      // busy/waiting-for-reply/speaking).
      maybeResumeListening();
      // Auto mode: a session that ended with no script evidence probes the
      // other language next time — an en-US session fed Arabic yields
      // Latinized text, which script detection alone can never recover from.
      if (
        languageModeRef.current === "auto" &&
        !speechAccumulatorRef.current &&
        !interimDraftRef.current
      ) {
        activeAutoLangRef.current = nextAutoRecognitionLang(
          activeAutoLangRef.current,
          "neutral",
        );
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      recognitionRunningRef.current = false;
      // Chrome throws InvalidStateError when a new session starts too soon
      // after the previous one ended; retry with backoff before giving up so
      // hands-free does not silently die with the toggle still on.
      if (startRetryCountRef.current < 2) {
        startRetryCountRef.current += 1;
        window.setTimeout(() => startListeningRef.current(), 400);
      } else {
        startRetryCountRef.current = 0;
        liveEnabledRef.current = false;
        setLiveEnabled(false);
        setStatus("Could not start the microphone");
      }
    }
  }, [
    armPauseTimer,
    connected,
    maybeResumeListening,
    startUtteranceRecorder,
    stopRecognition,
  ]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  /**
   * Browsers gate SpeechSynthesis and audio autoplay behind a user gesture.
   * The Mic/Voice toggle IS that gesture: prime the synthesis engine inside
   * it (a muted, empty utterance) so the first spoken reply — which arrives
   * later, from a network event outside any gesture — is not silently
   * swallowed by the autoplay policy. Keyboard activation (Enter/Space)
   * dispatches click too, so both input paths unlock speech.
   */
  const primeSpeechForGesture = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }, []);

  const toggleLive = useCallback(() => {
    const next = !liveEnabledRef.current;
    liveEnabledRef.current = next;
    setLiveEnabled(next);
    clearSilenceTimer();
    startRetryCountRef.current = 0;
    speechAccumulatorRef.current = "";
    interimDraftRef.current = "";
    setDraft("");
    if (next) {
      // Spoken replies follow the mic by default: a live call speaks unless
      // the user explicitly muted Voice (that choice is persisted and wins).
      if (!speechExplicitRef.current) {
        speechEnabledRef.current = true;
        setSpeechEnabled(true);
      }
      primeSpeechForGesture();
      setStatus(connected ? "Starting microphone" : "Chat is reconnecting");
      window.setTimeout(() => startListeningRef.current(), 0);
      void startAudioAnalyser();
    } else {
      waitingForReplyRef.current = false;
      stopRecognition();
      void stopUtteranceRecorder();
      stopAudioAnalyser();
      setStatus("Microphone off");
    }
  }, [
    clearSilenceTimer,
    connected,
    primeSpeechForGesture,
    startAudioAnalyser,
    stopAudioAnalyser,
    stopRecognition,
    stopUtteranceRecorder,
  ]);
  toggleLiveRef.current = toggleLive;

  const toggleSttMode = useCallback(() => {
    const next: SttMode = sttModeRef.current === "browser" ? "server" : "browser";
    sttModeRef.current = next;
    setSttMode(next);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STT_MODE_STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
    if (next === "browser") {
      void stopUtteranceRecorder();
      setStatus("Browser speech recognition (fast, on-device engine)");
    } else {
      // Record from the next utterance on; a live draft keeps its browser
      // transcript as the fallback if capture starts too late.
      if (liveEnabledRef.current && mediaStreamRef.current) startUtteranceRecorder();
      setStatus("Server transcription on (backend STT provider)");
    }
  }, [startUtteranceRecorder, stopUtteranceRecorder]);

  const toggleTtsEngine = useCallback(() => {
    const order: TtsEngine[] = ["browser", "flux", "fish"];
    const next = order[(order.indexOf(ttsEngineRef.current) + 1) % order.length];
    ttsEngineRef.current = next;
    setTtsEngine(next);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(TTS_ENGINE_STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
    if (next !== "browser") stopOpenRouterAudio();
    setStatus(
      next === "browser"
        ? "Browser voice replies (fast)"
        : next === "flux"
          ? "Flux TTS on (English-only; Arabic falls back to Fish)"
          : "Fish TTS on (multilingual)",
    );
  }, []);

  const toggleVoicePersona = useCallback(() => {
    const next: VoicePersona = voicePersonaRef.current === "jarvis" ? "gwen" : "jarvis";
    voicePersonaRef.current = next;
    setVoicePersona(next);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(VOICE_PERSONA_STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
    setStatus(`Voice persona: ${VOICE_PERSONA_LABELS[next]}`);
  }, []);

  const toggleJev = useCallback(() => {
    const next = !jevEnabledRef.current;
    jevEnabledRef.current = next;
    setJevEnabled(next);
    setJevFastPathEnabled(next);
    setStatus(`Jev fast-path: ${next ? "Enabled (OpenRouter Decisions)" : "Disabled"}`);
  }, []);

  const toggleLanguage = useCallback(() => {
    const prev = languageModeRef.current;
    const next: VoiceLanguageMode =
      prev === "en" ? "ar" : prev === "ar" ? "auto" : "en";
    languageModeRef.current = next;
    setLanguageMode(next);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(VOICE_LANG_STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
    if (next === "ar") {
      activeAutoLangRef.current = "ar-EG";
    } else if (next === "en") {
      activeAutoLangRef.current = "en-US";
    }
    if (liveEnabledRef.current) {
      stopRecognition();
      window.setTimeout(() => startListeningRef.current(), 10);
    }
  }, [stopRecognition]);

  const toggleStageMode = useCallback((mode: "compact" | "expanded") => {
    setStageMode(mode);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(ORB_MODE_STORAGE_KEY, mode);
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleSpeech = useCallback(() => {
    const next = !speechEnabledRef.current;
    speechEnabledRef.current = next;
    setSpeechEnabled(next);
    // An explicit Voice choice persists and overrides the speak-with-mic
    // default on future sessions.
    speechExplicitRef.current = true;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(SPEECH_STORAGE_KEY, next ? "on" : "off");
      } catch {
        // ignore
      }
    }
    if (next) {
      primeSpeechForGesture();
      setStatus("Spoken replies on");
      drainReply(false);
    } else {
      speechGenerationRef.current += 1;
      speechQueueRef.current = [];
      speakingRef.current = false;
      setIsAssistantSpeaking(false);
      if (prefetchPipelineRef.current) {
        prefetchPipelineRef.current.cancel();
        prefetchPipelineRef.current = null;
      }
      stopNabraAudio();
      stopOpenRouterAudio();
      setStatus("Spoken replies off");
      maybeResumeListening();
    }
  }, [drainReply, maybeResumeListening, primeSpeechForGesture]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSilenceTimer();
      stopRecognition();
      void stopUtteranceRecorder();
      stopAudioAnalyser();
      stopNabraAudio();
      stopOpenRouterAudio();
    };
  }, [clearSilenceTimer, stopAudioAnalyser, stopRecognition, stopUtteranceRecorder]);

  useEffect(() => {
    if (!connected) {
      stopRecognition();
      // A reply pending across a PTY drop will never arrive on this link;
      // unlatch so hands-free can resume once the chat reconnects.
      waitingForReplyRef.current = false;
      assistantBusyRef.current = false;
      setStatus("Chat is reconnecting");
    } else {
      // The PTY link is back: clear the stale reconnect note, but leave any
      // live status another path wrote after the drop (listening, speaking,
      // error, explicit Voice choice) untouched — and never touch the stored
      // speech preference itself.
      setStatus((current) =>
        current === "Chat is reconnecting" ? VOICE_READY_STATUS : current,
      );
      maybeResumeListening();
      // A draft buffered when the link dropped lost its pause timer (cleared
      // by stopRecognition); re-arm so it still auto-submits.
      const buffered = (
        speechAccumulatorRef.current +
        (interimDraftRef.current ? ` ${interimDraftRef.current}` : "")
      ).trim();
      if (buffered && liveEnabledRef.current) {
        armPauseTimer(
          normalizeVoicePrompt(buffered),
          speechAccumulatorRef.current.trim().length > 0,
        );
      }
    }
  }, [armPauseTimer, connected, maybeResumeListening, stopRecognition]);

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
      setIsAssistantSpeaking(false);
      if (prefetchPipelineRef.current) {
        prefetchPipelineRef.current.cancel();
        prefetchPipelineRef.current = null;
      }
      stopRecognition();
      stopNabraAudio();
      stopOpenRouterAudio();
      void stopUtteranceRecorder();
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
        setStatus(VOICE_READY_STATUS);
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
  }, [channel, drainReply, feed, liveEnabled, maybeResumeListening, speechEnabled, stopRecognition, stopUtteranceRecorder]);

  const voiceSupported = speechRecognitionConstructor() !== null;
  const langLabel =
    languageMode === "en" ? "EN" : languageMode === "ar" ? "عربي" : "Auto";
  const langTitle =
    languageMode === "en"
      ? "Language: English (click to switch to Arabic)"
      : languageMode === "ar"
        ? "Language: Arabic - مصرية (click to switch to Auto)"
        : "Language: Auto-Adaptive (click to switch to English)";
  const sttLabel = `STT: ${STT_MODE_LABELS[sttMode]}`;
  const sttTitle =
    sttMode === "browser"
      ? "Transcription: browser Web Speech engine (click for server transcription — more accurate, adds upload latency)"
      : "Transcription: server STT provider via /api/audio/transcribe (click for browser Web Speech — lower latency)";
  const ttsLabel = `TTS: ${TTS_ENGINE_LABELS[ttsEngine]}`;
  const ttsTitle =
    ttsEngine === "browser"
      ? "Replies: fast browser voice (click for OpenRouter Flux TTS — English-only)"
      : ttsEngine === "flux"
        ? "Replies: OpenRouter Flux TTS (deepgram/flux-tts:free, English-only; Arabic text is spoken with Fish) (click for Fish)"
        : "Replies: OpenRouter Fish TTS (fish-audio/s2.1-pro-free:free, multilingual) (click for the fast browser voice)";
  const personaLabel = `Voice: ${voicePersona === "jarvis" ? "Male" : "Female"}`;
  const personaTitle =
    voicePersona === "jarvis"
      ? "Voice persona: Male (Jarvis) (click to switch to Female / Gwen)"
      : "Voice persona: Female (Gwen) (click to switch to Male / Jarvis)";

  return (
    <div className="mb-2 flex shrink-0 flex-col gap-1.5" style={{ color: foreground }}>
      {stageMode === "expanded" ? (
        <div className="relative w-full overflow-hidden rounded-xl border border-[#00d2c4]/30 bg-gradient-to-b from-[#00d2c4]/15 via-black/70 to-black/90 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-[#00d2c4]/20 pb-2">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#00d2c4] animate-pulse" />
              <span className="font-mono text-xs font-bold tracking-widest text-[#00d2c4] uppercase">
                Hermes Quantum Stage
              </span>
              <span className="rounded bg-[#00d2c4]/15 px-1.5 py-0.5 font-mono text-[10px] text-[#00d2c4]/90">
                {listening ? "LISTENING" : isAssistantSpeaking ? "SPEAKING" : "STANDBY"}
              </span>
            </div>
            <Button
              ghost
              size="sm"
              onClick={() => toggleStageMode("compact")}
              title="Minimize to compact bar"
              aria-label="Minimize 3D Voice Stage"
              className="h-6 w-6 p-0 border border-white/10 hover:border-[#00d2c4]/40"
            >
              <Minimize2 className="h-3 w-3 text-white/70" />
            </Button>
          </div>

          <div className="relative my-2 flex h-[190px] w-full items-center justify-center overflow-hidden">
            <JarvisUltronVoiceOrb
              themeMode={voicePersona === "gwen" ? "gwen" : "hermes"}
              selectedPersona={voicePersona}
              isActive={liveEnabled || speechEnabled}
              isSpeaking={isAssistantSpeaking}
              isUserSpeaking={listening && Boolean(draft)}
              analyser={micAnalyser}
              className="w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2 text-xs">
            <Button
              ghost
              size="sm"
              onClick={toggleLive}
              disabled={!voiceSupported}
              aria-pressed={liveEnabled}
              title={
                voiceSupported
                  ? "Toggle hands-free speech recognition"
                  : "Speech recognition unavailable"
              }
              className="h-7 gap-1.5 border border-current/25 px-2 hover:border-[#00d2c4]/50"
            >
              {liveEnabled ? <Mic className="h-3.5 w-3.5 text-[#00d2c4]" /> : <MicOff className="h-3.5 w-3.5" />}
              {listening ? "Listening" : liveEnabled ? "Live mic" : "Mic"}
            </Button>
            <Button
              ghost
              size="sm"
              onClick={toggleLanguage}
              title={langTitle}
              aria-label={`Speech recognition language: ${langLabel}`}
              className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
            >
              <Globe className="h-3.5 w-3.5 opacity-80 text-[#00d2c4]" />
              <span>{langLabel}</span>
            </Button>
            <Button
              ghost
              size="sm"
              onClick={toggleSttMode}
              title={sttTitle}
              aria-label={`Transcription mode: ${STT_MODE_LABELS[sttMode]}`}
              className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
            >
              <span>{sttLabel}</span>
            </Button>
            <Button
              ghost
              size="sm"
              onClick={toggleTtsEngine}
              title={ttsTitle}
              aria-label={`Reply voice: ${TTS_ENGINE_LABELS[ttsEngine]}`}
              className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
            >
              <span>{ttsLabel}</span>
            </Button>
            <Button
              ghost
              size="sm"
              onClick={toggleVoicePersona}
              title={personaTitle}
              aria-label={`Voice persona: ${VOICE_PERSONA_LABELS[voicePersona]}`}
              className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
            >
              <User className="h-3.5 w-3.5 opacity-80 text-[#00d2c4]" />
              <span>{personaLabel}</span>
            </Button>
            <Button
              ghost
              size="sm"
              onClick={toggleJev}
              title={
                jevEnabled
                  ? "Jev fast intent routing: Enabled (via OpenRouter Decisions ~typesafe/jev-latest, sub-150ms triage)"
                  : "Jev fast intent routing: Disabled (click to enable)"
              }
              aria-label={`Jev fast routing: ${jevEnabled ? "Enabled" : "Disabled"}`}
              aria-pressed={jevEnabled}
              className={`h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px] ${
                jevEnabled ? "text-[#00d2c4] border-[#00d2c4]/50" : "opacity-60"
              }`}
            >
              <Zap className={`h-3.5 w-3.5 ${jevEnabled ? "text-[#00d2c4] fill-[#00d2c4]/30" : ""}`} />
              <span>{jevEnabled ? "Jev: On" : "Jev: Off"}</span>
            </Button>
            <Button
              ghost
              size="sm"
              onClick={toggleSpeech}
              aria-pressed={speechEnabled}
              title="Toggle spoken Hermes replies"
              className="h-7 gap-1.5 border border-current/25 px-2"
            >
              {speechEnabled ? <Volume2 className="h-3.5 w-3.5 text-[#00d2c4]" /> : <VolumeX className="h-3.5 w-3.5" />}
              {speechEnabled ? "Voice on" : "Voice off"}
            </Button>
            {draft ? (
              <Button
                ghost
                size="sm"
                onClick={() => void submitCurrentDraft()}
                title="Send now without waiting for pause"
                className="h-7 gap-1 border border-success/40 bg-success/15 px-2 text-success hover:bg-success/25"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send{pauseCountdown ? ` (${pauseCountdown}s)` : ""}</span>
              </Button>
            ) : null}
            <span className="min-w-0 flex-1 truncate opacity-75" role="status">
              {draft || status}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-[#00d2c4]/25 bg-black/40 px-2 py-1.5 text-xs shadow-lg backdrop-blur-md"
          aria-label="Hermes chat voice controls"
        >
          {/* Mini 3D Voice Orb */}
          <div
            className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#00d2c4]/40 bg-black/60 shadow-[0_0_12px_rgba(0,210,196,0.3)] cursor-pointer hover:scale-105 transition-transform"
            onClick={() => toggleStageMode("expanded")}
            title="Click to open full 3D Quantum Voice Stage"
          >
            <JarvisUltronVoiceOrb
              isMini
              themeMode={voicePersona === "gwen" ? "gwen" : "hermes"}
              selectedPersona={voicePersona}
              isActive={liveEnabled || speechEnabled}
              isSpeaking={isAssistantSpeaking}
              isUserSpeaking={listening && Boolean(draft)}
              analyser={micAnalyser}
              className="h-full w-full pointer-events-none"
            />
          </div>

          <Button
            ghost
            size="sm"
            onClick={toggleLive}
            disabled={!voiceSupported}
            aria-pressed={liveEnabled}
            title={
              voiceSupported
                ? "Toggle hands-free speech recognition"
                : "Speech recognition unavailable"
            }
            className="h-7 gap-1.5 border border-current/25 px-2 hover:border-[#00d2c4]/50"
          >
            {liveEnabled ? <Mic className="h-3.5 w-3.5 text-[#00d2c4]" /> : <MicOff className="h-3.5 w-3.5" />}
            {listening ? "Listening" : liveEnabled ? "Live mic" : "Mic"}
          </Button>
          <Button
            ghost
            size="sm"
            onClick={toggleLanguage}
            title={langTitle}
            aria-label={`Speech recognition language: ${langLabel}`}
            className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
          >
            <Globe className="h-3.5 w-3.5 opacity-80 text-[#00d2c4]" />
            <span>{langLabel}</span>
          </Button>
          <Button
            ghost
            size="sm"
            onClick={toggleSttMode}
            title={sttTitle}
            aria-label={`Transcription mode: ${STT_MODE_LABELS[sttMode]}`}
            className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
          >
            <span>{sttLabel}</span>
          </Button>
          <Button
            ghost
            size="sm"
            onClick={toggleTtsEngine}
            title={ttsTitle}
            aria-label={`Reply voice: ${TTS_ENGINE_LABELS[ttsEngine]}`}
            className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
          >
            <span>{ttsLabel}</span>
          </Button>
          <Button
            ghost
            size="sm"
            onClick={toggleVoicePersona}
            title={personaTitle}
            aria-label={`Voice persona: ${VOICE_PERSONA_LABELS[voicePersona]}`}
            className="h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px]"
          >
            <User className="h-3.5 w-3.5 opacity-80 text-[#00d2c4]" />
            <span>{personaLabel}</span>
          </Button>
          <Button
            ghost
            size="sm"
            onClick={toggleJev}
            title={
              jevEnabled
                ? "Jev fast intent routing: Enabled (via OpenRouter Decisions ~typesafe/jev-latest, sub-150ms triage)"
                : "Jev fast intent routing: Disabled (click to enable)"
            }
            aria-label={`Jev fast routing: ${jevEnabled ? "Enabled" : "Disabled"}`}
            aria-pressed={jevEnabled}
            className={`h-7 gap-1.5 border border-current/25 px-2 font-mono text-[11px] ${
              jevEnabled ? "text-[#00d2c4] border-[#00d2c4]/50" : "opacity-60"
            }`}
          >
            <Zap className={`h-3.5 w-3.5 ${jevEnabled ? "text-[#00d2c4] fill-[#00d2c4]/30" : ""}`} />
            <span>{jevEnabled ? "Jev: On" : "Jev: Off"}</span>
          </Button>
          <Button
            ghost
            size="sm"
            onClick={toggleSpeech}
            aria-pressed={speechEnabled}
            title="Toggle spoken Hermes replies"
            className="h-7 gap-1.5 border border-current/25 px-2"
          >
            {speechEnabled ? <Volume2 className="h-3.5 w-3.5 text-[#00d2c4]" /> : <VolumeX className="h-3.5 w-3.5" />}
            {speechEnabled ? "Voice on" : "Voice off"}
          </Button>
          {draft ? (
            <Button
              ghost
              size="sm"
              onClick={() => void submitCurrentDraft()}
              title="Send now without waiting for pause"
              className="h-7 gap-1 border border-success/40 bg-success/15 px-2 text-success hover:bg-success/25"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send{pauseCountdown ? ` (${pauseCountdown}s)` : ""}</span>
            </Button>
          ) : null}
          <span className="min-w-0 flex-1 truncate opacity-75" role="status">
            {draft || status}
          </span>
          <Button
            ghost
            size="sm"
            onClick={() => toggleStageMode("expanded")}
            title="Expand 3D Neural Voice Stage"
            aria-label="Expand 3D Voice Stage"
            className="h-7 w-7 p-0 border border-current/20 text-[#00d2c4] hover:border-[#00d2c4]/60"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}


