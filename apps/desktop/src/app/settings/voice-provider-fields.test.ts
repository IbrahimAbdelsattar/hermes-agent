import { describe, expect, it } from 'vitest'

import {
  BUILTIN_TTS_PROVIDER_KEYS,
  CURATED_FIELD_SCHEMAS,
  ENUM_OPTIONS,
  FIELD_DESCRIPTIONS,
  FIELD_LABELS,
  FREE_INPUT_KEYS,
  SECTIONS
} from './constants'
import { fieldCopyForSchemaKey } from './field-copy'
import { voiceProviderKeys } from './voice-provider-fields'

const voiceKeys = SECTIONS.find(s => s.id === 'voice')?.keys ?? []

describe('voiceProviderKeys', () => {
  it('derives per-provider field keys from the curated Voice section', () => {
    expect(voiceProviderKeys('tts', 'openai')).toEqual([
      'tts.openai.model',
      'tts.openai.voice',
      'tts.openai.speed',
      'tts.openai.base_url',
      'tts.openai.language',
      'tts.openai.instructions',
      'tts.openai.response_format',
      'tts.openai.consent_attestation',
      'tts.openai.pcm_sample_rate',
      'tts.openai.max_text_length'
    ])
    expect(voiceProviderKeys('tts', 'elevenlabs')).toEqual([
      'tts.elevenlabs.voice_id',
      'tts.elevenlabs.model_id',
      'tts.elevenlabs.speed',
      'tts.elevenlabs.streaming_model_id',
      'tts.elevenlabs.base_url',
      'tts.elevenlabs.wss_url',
      'tts.elevenlabs.max_text_length'
    ])
    expect(voiceProviderKeys('tts', 'edge')).toEqual([
      'tts.edge.voice',
      'tts.edge.speed',
      'tts.edge.max_text_length'
    ])
    expect(voiceProviderKeys('tts', 'openrouter')).toEqual([
      'tts.openrouter.model',
      'tts.openrouter.voice',
      'tts.openrouter.speed',
      'tts.openrouter.base_url',
      'tts.openrouter.response_format',
      'tts.openrouter.max_text_length'
    ])
  })

  it('covers every built-in TTS provider the Capabilities picker offers', () => {
    // Every provider key the backend TOOL_CATEGORIES["tts"] rows can carry
    // (tts_provider values) must resolve to at least one config field, so the
    // Capabilities panel never renders a silently-empty settings block.
    for (const provider of BUILTIN_TTS_PROVIDER_KEYS) {
      expect(voiceProviderKeys('tts', provider).length, provider).toBeGreaterThan(0)
      expect(ENUM_OPTIONS['tts.provider'], provider).toContain(provider)
    }
  })

  it('scopes to the exact provider segment (no prefix bleed)', () => {
    expect(voiceProviderKeys('tts', 'mini')).toEqual([])
    expect(voiceProviderKeys('stt', 'openai')).toEqual(['stt.openai.model'])
  })
})

describe('voice field option coverage', () => {
  it('offers the current gpt-4o-mini-tts voice set, not just the tts-1 six', () => {
    const voices = ENUM_OPTIONS['tts.openai.voice']

    for (const voice of ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'marin', 'sage', 'verse', 'shimmer']) {
      expect(voices).toContain(voice)
    }
  })

  it('keeps voice/model name fields free-input so custom IDs are typeable', () => {
    for (const key of [
      'tts.openai.voice',
      'tts.openai.model',
      'tts.elevenlabs.voice_id',
      'tts.elevenlabs.model_id',
      'stt.openai.model',
      'tts.edge.voice',
      'tts.xai.voice_id',
      'tts.piper.voice',
      'tts.openrouter.model',
      'tts.openrouter.voice'
    ]) {
      expect(FREE_INPUT_KEYS.has(key), key).toBe(true)
    }
  })

  it('suggests the current ElevenLabs v3 model, not just the v2 trio', () => {
    // Mirrors tools/tts_tool_delivery.py::ELEVENLABS_MODEL_MAX_TEXT_LENGTH.
    expect(ENUM_OPTIONS['tts.elevenlabs.model_id']).toContain('eleven_v3')
  })

  it('keeps closed enums (devices, providers) out of the free-input set', () => {
    expect(FREE_INPUT_KEYS.has('tts.provider')).toBe(false)
    expect(FREE_INPUT_KEYS.has('tts.neutts.device')).toBe(false)
    expect(FREE_INPUT_KEYS.has('stt.provider')).toBe(false)
  })

  it('curates global and advanced TTS controls without exposing provider secrets', () => {
    for (const key of [
      'tts.speed',
      'tts.output_format',
      'tts.max_text_length',
      'tts.streaming.min_len',
      'tts.streaming.provider',
      'tts.openrouter.model',
      'tts.openrouter.voice',
      'tts.openrouter.speed',
      'tts.openrouter.base_url',
      'tts.openrouter.max_text_length',
      'tts.piper.length_scale',
      'tts.gemini.persona_prompt_file'
    ]) {
      expect(voiceKeys, key).toContain(key)
      expect(fieldCopyForSchemaKey(FIELD_LABELS, key), key).toBeDefined()
      expect(fieldCopyForSchemaKey(FIELD_DESCRIPTIONS, key), key).toBeDefined()
    }

    for (const key of [
      'tts.speed',
      'tts.output_format',
      'tts.max_text_length',
      'tts.streaming.provider',
      'tts.openrouter.speed',
      'tts.piper.length_scale'
    ]) {
      expect(CURATED_FIELD_SCHEMAS[key as keyof typeof CURATED_FIELD_SCHEMAS], key).toBeDefined()
    }

    for (const key of voiceKeys.filter(key => key === 'tts.max_text_length' || key.endsWith('.max_text_length'))) {
      expect(CURATED_FIELD_SCHEMAS[key]?.type, key).toBe('number')
    }

    expect(voiceKeys.some(key => key.endsWith('.api_key'))).toBe(false)
  })

  it('every free-input voice key that lives in the Voice section has suggestions or is intentionally bare', () => {
    // Free-input keys don't *require* ENUM_OPTIONS (an empty datalist is
    // fine), but any that do declare options must be actual Voice-section
    // fields — a typo'd key here would silently do nothing.
    for (const key of FREE_INPUT_KEYS) {
      expect(voiceKeys, key).toContain(key)
    }
  })
})
