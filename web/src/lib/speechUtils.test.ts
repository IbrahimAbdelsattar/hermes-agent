import { describe, expect, it, vi } from 'vitest';
import {
  cleanSpokenText,
  extractNextSpokenSentence,
  PipelinedAudioQueue,
  splitTextIntoSentences,
} from './speechUtils';

describe('speechUtils - Streaming Sentence Pipeline', () => {
  it('cleanSpokenText removes completed and active reasoning think tags', () => {
    const textWithCompletedThink = '<think>Checking system telemetry...</think>All systems are online.';
    expect(cleanSpokenText(textWithCompletedThink)).toBe('All systems are online.');

    const textWithActiveThink = '<think>Model is currently contemplating';
    expect(cleanSpokenText(textWithActiveThink)).toBe('');

    const textWithTailThink = 'First answer.<think>Evaluating follow-up';
    expect(cleanSpokenText(textWithTailThink)).toBe('First answer.');
  });

  it('extractNextSpokenSentence extracts sentences sequentially with English and Arabic terminators', () => {
    const textEn = 'Hello sir! All systems operational. How can I assist you?';
    const first = extractNextSpokenSentence(textEn, 0);
    expect(first?.sentence).toBe('Hello sir!');
    expect(first?.nextIndex).toBe(10);


    const second = extractNextSpokenSentence(textEn, first!.nextIndex);
    expect(second?.sentence).toBe('All systems operational.');

    const third = extractNextSpokenSentence(textEn, second!.nextIndex);
    expect(third?.sentence).toBe('How can I assist you?');

    const fourth = extractNextSpokenSentence(textEn, third!.nextIndex);
    expect(fourth).toBeNull();

    // Arabic punctuation: . ! ؟ ؛
    const textAr = 'أهلاً بك يا فندم! كيف أساعدك اليوم؟ جارفيس مستعد.';
    const arFirst = extractNextSpokenSentence(textAr, 0);
    expect(arFirst?.sentence).toBe('أهلاً بك يا فندم!');

    const arSecond = extractNextSpokenSentence(textAr, arFirst!.nextIndex);
    expect(arSecond?.sentence).toBe('كيف أساعدك اليوم؟');

    const arThird = extractNextSpokenSentence(textAr, arSecond!.nextIndex);
    expect(arThird?.sentence).toBe('جارفيس مستعد.');

    // Long unpunctuated stream should split at word boundary for zero latency
    const unpunctuated = 'This is a long continuous stream of words without any punctuation to test the latency split';
    const split = extractNextSpokenSentence(unpunctuated, 0);
    expect(split).not.toBeNull();
    expect(split?.sentence.length).toBeGreaterThan(25);
    expect(unpunctuated.startsWith(split!.sentence)).toBe(true);
  });

  it('splitTextIntoSentences preserves existing splitting contract', () => {
    const sentences = splitTextIntoSentences('Sentence one. Sentence two! Sentence three?');
    expect(sentences).toEqual(['Sentence one.', 'Sentence two!', 'Sentence three?']);
  });

  it('PipelinedAudioQueue executes tasks in order and notifies speaking change', async () => {
    const events: string[] = [];
    const onSpeaking = vi.fn();
    const queue = new PipelinedAudioQueue(onSpeaking);

    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      events.push('sentence_1');
    });

    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 10));
      events.push('sentence_2');
    });

    await queue.waitUntilDone();

    expect(events).toEqual(['sentence_1', 'sentence_2']);
    expect(onSpeaking).toHaveBeenCalledWith(true);
    expect(onSpeaking).toHaveBeenCalledWith(false);
  });

  it('PipelinedAudioQueue supports clean abort on barge-in / interruption', async () => {
    const events: string[] = [];
    const queue = new PipelinedAudioQueue();

    queue.enqueue(async (signal) => {
      await new Promise((r) => setTimeout(r, 50));
      if (!signal.aborted) events.push('task_1');
    });

    queue.enqueue(async (signal) => {
      await new Promise((r) => setTimeout(r, 50));
      if (!signal.aborted) events.push('task_2');
    });

    // Abort after small delay
    setTimeout(() => {
      queue.abort();
    }, 10);

    await queue.waitUntilDone();

    // task_2 should never have executed
    expect(events).not.toContain('task_2');
  });
});
