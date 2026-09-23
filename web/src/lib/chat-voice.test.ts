import { describe, expect, it } from "vitest";
import {
  containsArabic,
  containsLatin,
  chooseOpenRouterTts,
  detectDominantScript,
  getVoicePauseTimeoutMs,
  nextAutoRecognitionLang,
  normalizeVoicePrompt,
  OPENROUTER_TTS_SPECS,
  recognitionTranscript,
  resolveServerTranscript,
  VOICE_ENDPOINT_CONTINUATION_BONUS_MS,
  VOICE_ENDPOINT_FINAL_PUNCT_MS,
  VOICE_ENDPOINT_MAX_MS,
} from "./chat-voice";

describe("chat-voice utilities", () => {
  it("detects Arabic script accurately", () => {
    expect(containsArabic("ازيك يا هيرميس")).toBe(true);
    expect(containsArabic("hello world")).toBe(false);
    expect(containsArabic("hello يا صديقي")).toBe(true);
  });

  it("detects Latin script accurately", () => {
    expect(containsLatin("hello world")).toBe(true);
    expect(containsLatin("ازيك")).toBe(false);
    expect(containsLatin("Hermes عربي")).toBe(true);
  });

  it("identifies dominant script for auto-adaptive switching", () => {
    expect(detectDominantScript("صباح الخير يا هيرميس")).toBe("ar");
    expect(detectDominantScript("Good morning Hermes")).toBe("en");
    expect(detectDominantScript("12345 ... !?")).toBe("neutral");
    // Mixed: dominant script wins
    expect(detectDominantScript("اكتبلي كود Python")).toBe("ar");
    expect(detectDominantScript("Please write python code for me")).toBe("en");
  });

  it("endpoints faster on stable final results than on interim text", () => {
    // Pure-function timing contract: no wall-clock waits, only the mapping
    // from recognition stability to delay. A final result must always wait
    // less than the same draft seen as interim-only text.
    const drafts = ["I want you to fix this", "خلص الشغل ده", "Run the command"];
    for (const draft of drafts) {
      expect(getVoicePauseTimeoutMs(draft, { isFinal: true })).toBeLessThan(
        getVoicePauseTimeoutMs(draft, { isFinal: false }),
      );
    }
  });

  it("submits terminally-punctuated final results on the fast rung", () => {
    expect(getVoicePauseTimeoutMs("Fix this now.", { isFinal: true })).toBe(
      VOICE_ENDPOINT_FINAL_PUNCT_MS,
    );
    expect(getVoicePauseTimeoutMs("خلص الشغل ده!", { isFinal: true })).toBe(
      VOICE_ENDPOINT_FINAL_PUNCT_MS,
    );
    // Same text as interim-only input must NOT take the fast rung.
    expect(getVoicePauseTimeoutMs("Fix this now.", { isFinal: false })).toBeGreaterThan(
      VOICE_ENDPOINT_FINAL_PUNCT_MS,
    );
  });

  it("holds the turn open on continuation words in either language", () => {
    const withContinuation = getVoicePauseTimeoutMs("Run the command and", {
      isFinal: true,
    });
    const complete = getVoicePauseTimeoutMs("Run the command", { isFinal: true });
    expect(withContinuation - complete).toBe(VOICE_ENDPOINT_CONTINUATION_BONUS_MS);

    const withContinuationAr = getVoicePauseTimeoutMs("عاوزك تساعدني علشان", {
      isFinal: true,
    });
    const completeAr = getVoicePauseTimeoutMs("عاوزك تساعدني", { isFinal: true });
    expect(withContinuationAr - completeAr).toBe(VOICE_ENDPOINT_CONTINUATION_BONUS_MS);
  });

  it("keeps every endpoint delay within the responsiveness/robustness band", () => {
    const drafts = [
      "I want you to fix this",
      "Fix this now.",
      "Run the command and",
      "Can you help me because",
      "عاوزك تساعدني علشان",
      "شغل الموسيقى و",
      "خلص الشغل ده!",
      "   ",
    ];
    for (const draft of drafts) {
      for (const isFinal of [true, false]) {
        const timeout = getVoicePauseTimeoutMs(draft, { isFinal });
        expect(timeout).toBeGreaterThanOrEqual(VOICE_ENDPOINT_FINAL_PUNCT_MS);
        expect(timeout).toBeLessThanOrEqual(VOICE_ENDPOINT_MAX_MS);
      }
    }
    // A numeric second argument still works as an explicit base (back-compat
    // with callers that pass a base delay directly).
    expect(getVoicePauseTimeoutMs("I want you to fix this", 1400)).toBe(1400);
    expect(getVoicePauseTimeoutMs("Run the command and", 1400)).toBe(
      1400 + VOICE_ENDPOINT_CONTINUATION_BONUS_MS,
    );
  });

  it("normalizes prompts and extracts transcripts", () => {
    expect(normalizeVoicePrompt("  hello \n\t  world  ")).toBe("hello world");
    expect(
      recognitionTranscript({
        resultIndex: 0,
        results: [
          { 0: { transcript: "part one" }, isFinal: true },
          { 0: { transcript: "part two" }, isFinal: false },
        ],
      }),
    ).toEqual({
      final: "part one",
      interim: "part two",
    });
  });
});

describe("auto language probing", () => {
  // Regression: auto mode started en-US and could never recover Arabic —
  // an en-US engine returns *Latinized* text for Arabic speech, so script
  // detection alone commits to English forever. The probe must alternate
  // when a session ends without script evidence.
  it("commits to the detected script", () => {
    expect(nextAutoRecognitionLang("en-US", "ar")).toBe("ar-EG");
    expect(nextAutoRecognitionLang("ar-EG", "en")).toBe("en-US");
    expect(nextAutoRecognitionLang("en-US", "en")).toBe("en-US");
    expect(nextAutoRecognitionLang("ar-EG", "ar")).toBe("ar-EG");
  });

  it("alternates the probe language when a session ends without script evidence", () => {
    expect(nextAutoRecognitionLang("en-US", "neutral")).toBe("ar-EG");
    expect(nextAutoRecognitionLang("ar-EG", "neutral")).toBe("en-US");
  });
});

describe("server transcript fallback", () => {
  // The turn must never be dropped because the accurate path failed.
  it("uses the server transcript when the provider returned one", () => {
    expect(
      resolveServerTranscript({ ok: true, transcript: " الحقيقية " }, "latin gibberish"),
    ).toBe("الحقيقية");
  });

  it("falls back to the browser draft on failure, empty transcript, or bad payload", () => {
    expect(resolveServerTranscript(null, "browser draft")).toBe("browser draft");
    expect(resolveServerTranscript({ ok: true, transcript: "" }, "browser draft")).toBe("browser draft");
    expect(resolveServerTranscript({ ok: false, transcript: "x" }, "browser draft")).toBe("browser draft");
    expect(resolveServerTranscript({ ok: true, transcript: "  " }, "  browser   draft ")).toBe(
      "browser draft",
    );
  });
});

describe("OpenRouter TTS routing", () => {
  // The OpenRouter catalog lists Flux as English-only: Arabic text must
  // never be sent to it — it reroutes to the multilingual Fish model.
  it("never routes Arabic text to the English-only Flux model", () => {
    expect(chooseOpenRouterTts("صباح الخير يا هيرميس", "flux")).toEqual({
      ...OPENROUTER_TTS_SPECS.fish,
      fallbackToFish: true,
    });
    expect(chooseOpenRouterTts("اكتبلي كود Python", "flux").model_id).toBe(
      OPENROUTER_TTS_SPECS.fish.model_id,
    );
  });

  it("keeps each engine on its own documented voice", () => {
    expect(chooseOpenRouterTts("Good morning Hermes", "flux")).toEqual({
      ...OPENROUTER_TTS_SPECS.flux,
      fallbackToFish: false,
    });
    expect(chooseOpenRouterTts("Good morning Hermes", "fish")).toEqual({
      ...OPENROUTER_TTS_SPECS.fish,
      fallbackToFish: false,
    });
    expect(chooseOpenRouterTts("صباح الخير", "fish").voice_id).toBe(
      "b347db033a6549378b48d00acb0d06cd",
    );
    expect(chooseOpenRouterTts("Hello there", "flux").voice_id).toBe("flux-alexis-en");
  });
});
