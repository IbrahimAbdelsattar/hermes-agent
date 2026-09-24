import { REASONING_EFFORTS } from '@hermes/shared'

import {
  Box,
  Brain,
  Globe,
  type IconComponent,
  Lock,
  MessageCircle,
  Mic,
  Monitor,
  Moon,
  Palette,
  Sun,
  Wrench
} from '@/lib/icons'
import type { ThemeMode } from '@/themes/context'
import type { ConfigFieldSchema } from '@/types/hermes'

// Single source of truth for built-in personality names lives in
// lib/personalities (mirrors hermes_cli/personality.py BUILTIN_PERSONALITIES).
export { BUILTIN_PERSONALITIES } from '@/lib/personalities'

import { defineFieldCopy } from './field-copy'
import type { DesktopConfigSection } from './types'

// Provider group definitions used to fold raw env-var names like
// ``XAI_API_KEY`` into a single "xAI" card with a friendly label, short
// description, and signup URL. Membership is determined by longest
// prefix match (see ``providerGroup`` in helpers.ts) so more specific
// prefixes (``MINIMAX_CN_``) correctly beat their general parents
// (``MINIMAX_``). New providers should be added here so they get their
// own card in Settings → Keys instead of being lumped into "Other".
interface ProviderPrefix {
  prefix: string
  name: string
  /** Optional one-line tagline shown beneath the group name. */
  description?: string
  /** Optional canonical signup/console URL surfaced from the card header. */
  docsUrl?: string
  /** Lower numbers float to the top of the providers list. */
  priority: number
}

export const EMPTY_SELECT_VALUE = '__hermes_empty__'
export const CONTROL_TEXT = 'text-xs'

export const PROVIDER_GROUPS: ProviderPrefix[] = [
  {
    prefix: 'NOUS_',
    name: 'Nous Portal',
    description: 'Hosted Hermes & Nous-trained models',
    docsUrl: 'https://portal.nousresearch.com',
    priority: 0
  },
  {
    prefix: 'FIREWORKS_',
    name: 'Fireworks AI',
    description: 'OpenAI-compatible direct model API',
    docsUrl: 'https://app.fireworks.ai/settings/users/api-keys',
    // Slot #2 — mirrors CANONICAL_PROVIDERS (after Nous, ahead of OpenRouter).
    // Same numeric priority as OpenRouter; name sort puts Fireworks first.
    priority: 1
  },
  {
    prefix: 'OPENROUTER_',
    name: 'OpenRouter',
    description: 'Aggregator for hundreds of frontier models',
    docsUrl: 'https://openrouter.ai/keys',
    priority: 1
  },
  {
    prefix: 'ANTHROPIC_',
    name: 'Anthropic',
    description: 'Claude API access (Sonnet, Opus, Haiku)',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    priority: 2
  },
  {
    prefix: 'XAI_',
    name: 'xAI',
    description: 'Grok models (use OAuth for SuperGrok / Premium+)',
    docsUrl: 'https://console.x.ai/',
    priority: 3
  },
  {
    prefix: 'GOOGLE_',
    name: 'Gemini',
    description: 'Google AI Studio (Gemini 1.5 / 2.0 / 2.5)',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    priority: 4
  },
  { prefix: 'GEMINI_', name: 'Gemini', priority: 4 },
  {
    prefix: 'DEEPSEEK_',
    name: 'DeepSeek',
    description: 'Direct DeepSeek API (V3.x, R1)',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    priority: 5
  },
  {
    prefix: 'DASHSCOPE_',
    name: 'DashScope (Qwen)',
    description: 'Alibaba Cloud DashScope — Qwen and multi-vendor models',
    docsUrl: 'https://modelstudio.console.alibabacloud.com/',
    priority: 6
  },
  { prefix: 'HERMES_QWEN_', name: 'DashScope (Qwen)', priority: 6 },
  {
    prefix: 'GLM_',
    name: 'GLM / Z.AI',
    description: 'Zhipu GLM-4.6 and Z.AI hosted endpoints',
    docsUrl: 'https://z.ai/',
    priority: 7
  },
  { prefix: 'ZAI_', name: 'GLM / Z.AI', priority: 7 },
  { prefix: 'Z_AI_', name: 'GLM / Z.AI', priority: 7 },
  {
    prefix: 'KIMI_',
    name: 'Kimi / Moonshot',
    description: 'Moonshot Kimi K2 / coding endpoints',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 8
  },
  {
    prefix: 'KIMI_CN_',
    name: 'Kimi (China)',
    description: 'Moonshot China endpoint',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 9
  },
  {
    prefix: 'MINIMAX_',
    name: 'MiniMax',
    description: 'MiniMax-M2 and Hailuo international endpoints',
    docsUrl: 'https://www.minimax.io/',
    priority: 10
  },
  {
    prefix: 'MINIMAX_CN_',
    name: 'MiniMax (China)',
    description: 'MiniMax mainland China endpoint',
    docsUrl: 'https://www.minimaxi.com/',
    priority: 11
  },
  {
    prefix: 'HF_',
    name: 'Hugging Face',
    description: 'Inference Providers — 20+ open models via router.huggingface.co',
    docsUrl: 'https://huggingface.co/settings/tokens',
    priority: 12
  },
  {
    prefix: 'OPENCODE_ZEN_',
    name: 'OpenCode Zen',
    description: 'Pay-as-you-go access to curated coding models',
    docsUrl: 'https://opencode.ai/auth',
    priority: 13
  },
  {
    prefix: 'OPENCODE_GO_',
    name: 'OpenCode Go',
    description: '$10/month subscription for open coding models',
    docsUrl: 'https://opencode.ai/auth',
    priority: 14
  },
  {
    prefix: 'NVIDIA_',
    name: 'NVIDIA NIM',
    description: 'build.nvidia.com or your own local NIM endpoint',
    docsUrl: 'https://build.nvidia.com/',
    priority: 15
  },
  {
    prefix: 'OLLAMA_',
    name: 'Ollama Cloud',
    description: 'Cloud-hosted open models from ollama.com',
    docsUrl: 'https://ollama.com/settings',
    priority: 16
  },
  {
    prefix: 'LM_',
    name: 'LM Studio',
    description: 'Local LM Studio server (OpenAI-compatible)',
    docsUrl: 'https://lmstudio.ai/docs/local-server',
    priority: 17
  },
  {
    prefix: 'STEPFUN_',
    name: 'StepFun',
    description: 'StepFun Step Plan coding models',
    docsUrl: 'https://platform.stepfun.com/',
    priority: 18
  },
  {
    prefix: 'XIAOMI_',
    name: 'Xiaomi MiMo',
    description: 'MiMo-V2.5 and Xiaomi proprietary models',
    docsUrl: 'https://platform.xiaomimimo.com',
    priority: 19
  },
  {
    prefix: 'ARCEEAI_',
    name: 'Arcee AI',
    description: 'Arcee-hosted small + medium models',
    docsUrl: 'https://chat.arcee.ai/',
    priority: 20
  },
  { prefix: 'ARCEE_', name: 'Arcee AI', priority: 20 },
  {
    prefix: 'GMI_',
    name: 'GMI Cloud',
    description: 'GMI Cloud GPU + model serving',
    docsUrl: 'https://www.gmicloud.ai/',
    priority: 21
  },
  {
    prefix: 'AZURE_FOUNDRY_',
    name: 'Azure Foundry',
    description: 'Azure AI Foundry custom endpoints (OpenAI / Anthropic-compatible)',
    docsUrl: 'https://ai.azure.com/',
    priority: 22
  },
  {
    prefix: 'AWS_',
    name: 'AWS Bedrock',
    description: 'Authenticate via AWS profile + region',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-regions.html',
    priority: 23
  }
]

export const BUILTIN_TTS_PROVIDER_KEYS = [
  'edge',
  'elevenlabs',
  'openai',
  'xai',
  'minimax',
  'mistral',
  'gemini',
  'deepinfra',
  'openrouter',
  'neutts',
  'kittentts',
  'piper'
] as const

export const BUILTIN_TTS_PROVIDERS = new Set<string>(BUILTIN_TTS_PROVIDER_KEYS)

const TTS_OUTPUT_FORMAT_OPTIONS = ['', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'amr', 'opus', 'pcm']
const OPENAI_RESPONSE_FORMAT_OPTIONS = ['', 'mp3', 'opus', 'aac', 'flac', 'wav']
const OPENROUTER_RESPONSE_FORMAT_OPTIONS = ['', 'mp3', 'pcm']

// Schema-side select overrides for desktop-relevant enum fields whose
// backend schema only declares a string type.
export const ENUM_OPTIONS: Record<string, string[]> = {
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'approvals.mode': ['manual', 'smart', 'off'],
  'code_execution.mode': ['project', 'strict'],
  'context.engine': ['compressor', 'default', 'custom'],
  // '' = inherit the agent's own effort; the rest is the shared scale.
  'delegation.reasoning_effort': ['', ...REASONING_EFFORTS],
  // NOTE: memory.provider is intentionally NOT listed here. Its options are
  // discovery-driven and served by the backend config schema (merged
  // per-request in web_server._schema_with_dynamic_provider_options), so
  // config-field consumes schema.options directly — a static list here would
  // shadow that and hide user-installed/pip providers (#49513).
  // Terminal execution backends — kept in sync with the dispatch ladder in
  // tools/terminal_tool.py::_create_environment (local/docker/singularity/
  // modal/daytona/ssh). Remote backends need extra env (image, tokens, host).
  'terminal.backend': ['local', 'docker', 'singularity', 'modal', 'daytona', 'ssh'],
  'stt.elevenlabs.model_id': ['scribe_v2', 'scribe_v1'],
  'stt.local.model': ['tiny', 'base', 'small', 'medium', 'large-v3'],
  // Speech-to-text backends — kept in sync with the stt block in
  // hermes_cli/config.py (local/groq/openai/mistral/elevenlabs).
  'stt.provider': ['local', 'groq', 'openai', 'mistral', 'xai', 'elevenlabs'],
  // How the desktop voice conversation is wired — tools/voice_live.py owns the
  // gpt-live branch (one full-duplex voice model delegating to Hermes).
  'voice.voice_chat_mode': ['chained', 'gpt-live'],
  'voice.gpt_live.voice': [
    'marin',
    'cedar',
    'quartz',
    'ripple',
    'vesper',
    'willow',
    'stone',
    'gleam',
    'meridian',
    'bossa',
    'tempo',
    'beacon',
    'delta',
    'cinder'
  ],
  // OpenAI TTS voices — the union across models (per the OpenAI TTS API
  // docs). Model-specific narrowing happens in enumOptionsFor():
  // tts-1 / tts-1-hd support 9 voices; gpt-4o-mini-tts supports all 13.
  // Free-input field — the list is suggestions, not a gate (FREE_INPUT_KEYS).
  'tts.openai.voice': [
    'alloy',
    'ash',
    'ballad',
    'cedar',
    'coral',
    'echo',
    'fable',
    'marin',
    'nova',
    'onyx',
    'sage',
    'shimmer',
    'verse'
  ],
  // Popular Edge neural voices (the full catalog is 400+ — free input).
  'tts.edge.voice': [
    'en-US-AriaNeural',
    'en-US-JennyNeural',
    'en-US-AndrewNeural',
    'en-US-BrianNeural',
    'en-US-GuyNeural',
    'en-GB-SoniaNeural'
  ],
  'tts.gemini.model': ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
  // Gemini TTS prebuilt voice set.
  'tts.gemini.voice': [
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
    'Leda',
    'Orus',
    'Aoede',
    'Callirrhoe',
    'Autonoe',
    'Enceladus',
    'Iapetus',
    'Umbriel',
    'Algieba',
    'Despina',
    'Erinome',
    'Algenib',
    'Rasalgethi',
    'Laomedeia',
    'Achernar',
    'Alnilam',
    'Schedar',
    'Gacrux',
    'Pulcherrima',
    'Achird',
    'Zubenelgenubi',
    'Vindemiatrix',
    'Sadachbia',
    'Sadaltager',
    'Sulafat'
  ],
  'tts.xai.voice_id': ['eve'],
  'tts.minimax.model': ['speech-02-hd', 'speech-02-turbo'],
  'tts.minimax.region': ['', 'global', 'cn'],
  'tts.mistral.model': ['voxtral-mini-tts-2603'],
  'tts.kittentts.model': [
    'KittenML/kitten-tts-nano-0.8-int8',
    'KittenML/kitten-tts-micro-0.8-int8',
    'KittenML/kitten-tts-mini-0.8-int8'
  ],
  'tts.kittentts.voice': ['Jasper'],
  'tts.piper.voice': ['en_US-lessac-medium', 'en_US-amy-medium', 'en_US-ryan-high', 'en_GB-alan-medium'],
  'tts.openrouter.model': ['deepgram/flux-tts:free', 'fish-audio/s2.1-pro-free:free'],
  'tts.openrouter.voice': ['flux-alexis-en', 'flux-bruce-en', 'b347db033a6549378b48d00acb0d06cd'],
  'tts.output_format': TTS_OUTPUT_FORMAT_OPTIONS,
  'tts.openai.response_format': OPENAI_RESPONSE_FORMAT_OPTIONS,
  'tts.deepinfra.response_format': OPENAI_RESPONSE_FORMAT_OPTIONS,
  'tts.openrouter.response_format': OPENROUTER_RESPONSE_FORMAT_OPTIONS,
  'tts.streaming.provider': ['', 'auto', 'elevenlabs', 'openai', 'gemini', 'xai'],
  'tts.neutts.model': ['neuphonic/neutts-air-q4-gguf', 'neuphonic/neutts-air-q8-gguf', 'neuphonic/neutts-air'],
  // Text-to-speech backends — kept in sync with the built-in source of truth
  // (agent/tts_registry.py::_BUILTIN_NAMES / tools/tts_tool.py::
  // BUILTIN_TTS_PROVIDERS). 'xai' is Grok TTS.
  'tts.provider': [...BUILTIN_TTS_PROVIDER_KEYS],
  'stt.openai.model': ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'gpt-transcribe'],
  'stt.mistral.model': ['voxtral-mini-latest', 'voxtral-mini-2602'],
  'tts.openai.model': ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
  'tts.elevenlabs.model_id': [
    'eleven_v3',
    'eleven_ttv_v3',
    'eleven_multilingual_v2',
    'eleven_turbo_v2',
    'eleven_turbo_v2_5',
    'eleven_flash_v2',
    'eleven_flash_v2_5'
  ],
  // NeuTTS local inference device.
  'tts.neutts.device': ['cpu', 'cuda', 'mps'],
  'updates.non_interactive_local_changes': ['stash', 'discard']
}

// Voice/model name fields render as a free-input combobox (Input + datalist)
// instead of a closed Select: providers accept custom voice IDs (ElevenLabs
// cloned voices, xAI custom voices, Edge's 400+ catalog) and ship new model
// names faster than this list updates. The ENUM_OPTIONS above become
// suggestions rather than a gate for these keys.
export const FREE_INPUT_KEYS = new Set([
  'tts.edge.voice',
  'voice.gpt_live.voice',
  'tts.openai.model',
  'tts.openai.voice',
  'tts.elevenlabs.voice_id',
  'tts.elevenlabs.model_id',
  'stt.openai.model',
  'tts.gemini.model',
  'tts.gemini.voice',
  'tts.xai.voice_id',
  'tts.minimax.model',
  'tts.minimax.voice_id',
  'tts.mistral.model',
  'tts.mistral.voice_id',
  'tts.neutts.model',
  'tts.kittentts.model',
  'tts.kittentts.voice',
  'tts.piper.voice',
  'tts.deepinfra.model',
  'tts.deepinfra.voice',
  'tts.openrouter.model',
  'tts.openrouter.voice'
])

export const CURATED_FIELD_SCHEMAS: Record<string, ConfigFieldSchema> = {
  'tts.speed': { type: 'number' },
  'tts.output_format': { type: 'select' },
  'tts.max_text_length': { type: 'number' },
  'tts.streaming.min_len': { type: 'number' },
  'tts.streaming.provider': { type: 'select' },
  'tts.edge.speed': { type: 'number' },
  'tts.edge.max_text_length': { type: 'number' },
  'tts.openai.speed': { type: 'number' },
  'tts.openai.base_url': { type: 'string' },
  'tts.openai.language': { type: 'string' },
  'tts.openai.instructions': { type: 'text' },
  'tts.openai.response_format': { type: 'select' },
  'tts.openai.max_text_length': { type: 'number' },
  'tts.elevenlabs.speed': { type: 'number' },
  'tts.elevenlabs.streaming_model_id': { type: 'string' },
  'tts.elevenlabs.base_url': { type: 'string' },
  'tts.elevenlabs.wss_url': { type: 'string' },
  'tts.elevenlabs.max_text_length': { type: 'number' },
  'tts.xai.base_url': { type: 'string' },
  'tts.xai.text_normalization': { type: 'boolean' },
  'tts.xai.streaming_url': { type: 'string' },
  'tts.xai.max_text_length': { type: 'number' },
  'tts.minimax.region': { type: 'select' },
  'tts.minimax.base_url': { type: 'string' },
  'tts.minimax.speed': { type: 'number' },
  'tts.minimax.vol': { type: 'number' },
  'tts.minimax.pitch': { type: 'number' },
  'tts.minimax.emotion': { type: 'string' },
  'tts.minimax.sample_rate': { type: 'number' },
  'tts.minimax.bitrate': { type: 'number' },
  'tts.minimax.group_id': { type: 'string' },
  'tts.minimax.max_text_length': { type: 'number' },
  'tts.mistral.base_url': { type: 'string' },
  'tts.mistral.max_text_length': { type: 'number' },
  'tts.gemini.base_url': { type: 'string' },
  'tts.gemini.max_text_length': { type: 'number' },
  'tts.neutts.max_text_length': { type: 'number' },
  'tts.kittentts.speed': { type: 'number' },
  'tts.kittentts.clean_text': { type: 'boolean' },
  'tts.kittentts.max_text_length': { type: 'number' },
  'tts.piper.voices_dir': { type: 'string' },
  'tts.piper.use_cuda': { type: 'boolean' },
  'tts.piper.length_scale': { type: 'number' },
  'tts.piper.noise_scale': { type: 'number' },
  'tts.piper.noise_w_scale': { type: 'number' },
  'tts.piper.volume': { type: 'number' },
  'tts.piper.normalize_audio': { type: 'boolean' },
  'tts.piper.speaker_id': { type: 'number' },
  'tts.piper.max_text_length': { type: 'number' },
  'tts.deepinfra.speed': { type: 'number' },
  'tts.deepinfra.base_url': { type: 'string' },
  'tts.deepinfra.language': { type: 'string' },
  'tts.deepinfra.instructions': { type: 'text' },
  'tts.deepinfra.response_format': { type: 'select' },
  'tts.deepinfra.max_text_length': { type: 'number' },
  'tts.openrouter.speed': { type: 'number' },
  'tts.openrouter.base_url': { type: 'string' },
  'tts.openrouter.response_format': { type: 'select' },
  'tts.openrouter.max_text_length': { type: 'number' }
}

export const FIELD_LABELS: Record<string, string> = defineFieldCopy({
  model: 'Default Model',
  modelContextLength: 'Main model context window (override)',
  fallbackProviders: 'Fallback Models',
  toolsets: 'Enabled Toolsets',
  timezone: 'Timezone',
  display: {
    personality: 'Personality',
    showReasoning: 'Reasoning Blocks'
  },
  desktop: {
    repoScanEnabled: 'Automatic Repository Discovery',
    repoScanRoots: 'Repository Discovery Roots',
    repoScanExcludePaths: 'Excluded Repository Paths'
  },
  agent: {
    maxTurns: 'Max Agent Steps',
    imageInputMode: 'Image Attachments',
    apiMaxRetries: 'API Retries',
    serviceTier: 'Service Tier',
    toolUseEnforcement: 'Tool-Use Enforcement'
  },
  terminal: {
    cwd: 'Working Directory',
    backend: 'Execution Backend',
    timeout: 'Command Timeout',
    persistentShell: 'Persistent Shell',
    envPassthrough: 'Environment Passthrough',
    dockerImage: 'Docker Image',
    singularityImage: 'Singularity Image',
    modalImage: 'Modal Image',
    daytonaImage: 'Daytona Image'
  },
  fileReadMaxChars: 'File Read Limit',
  toolOutput: {
    maxBytes: 'Terminal Output Limit',
    maxLines: 'File Page Limit',
    maxLineLength: 'Line Length Limit'
  },
  codeExecution: {
    mode: 'Code Execution Mode'
  },
  approvals: {
    mode: 'Approval Mode',
    timeout: 'Approval Timeout',
    mcpReloadConfirm: 'Confirm MCP Reloads'
  },
  commandAllowlist: 'Command Allowlist',
  security: {
    redactSecrets: 'Redact Secrets',
    allowPrivateUrls: 'Allow Private URLs'
  },
  browser: {
    allowPrivateUrls: 'Browser Private URLs',
    autoLocalForPrivateUrls: 'Local Browser For Private URLs',
    useRealProfile: 'Use My Real Browser Profile'
  },
  checkpoints: {
    enabled: 'File Checkpoints',
    maxSnapshots: 'Checkpoint Limit'
  },
  voice: {
    recordKey: 'Voice Shortcut',
    maxRecordingSeconds: 'Max Recording Length',
    autoTts: 'Backend Auto-TTS',
    voiceChatMode: 'Voice Chat Mode',
    clientDirect: 'Direct Provider Calls',
    beepEnabled: 'Recording Beeps',
    beepVolume: 'Recording Beep Volume',
    thinkingSound: 'Thinking Sound',
    silenceThreshold: 'Recording Silence Threshold',
    silenceDuration: 'Recording Silence Duration',
    bargeIn: 'Barge In',
    bargeInGraceSeconds: 'Barge-In Grace Period',
    bargeInThresholdMultiplier: 'Barge-In Threshold Multiplier',
    stopPhrases: 'Voice Stop Phrases',
    gptLive: {
      model: 'GPT-Live Model',
      voice: 'GPT-Live Voice',
      instructions: 'GPT-Live Persona'
    }
  },
  stt: {
    enabled: 'Speech To Text',
    echoTranscripts: 'Echo Transcripts',
    provider: 'Speech-To-Text Provider',
    local: {
      model: 'Local Transcription Model',
      language: 'Transcription Language'
    },
    openai: {
      model: 'OpenAI STT Model'
    },
    groq: {
      model: 'Groq STT Model'
    },
    mistral: {
      model: 'Mistral STT Model'
    },
    elevenlabs: {
      modelId: 'ElevenLabs STT Model',
      languageCode: 'ElevenLabs Language',
      tagAudioEvents: 'Tag Audio Events',
      diarize: 'Speaker Diarization'
    }
  },
  tts: {
    provider: 'Text-To-Speech Provider',
    speed: 'Default Playback Speed',
    outputFormat: 'Default Output Format',
    maxTextLength: 'Default Text Limit',
    streaming: {
      minLen: 'Streaming Sentence Minimum',
      provider: 'Streaming Provider'
    },
    edge: {
      voice: 'Edge Voice',
      speed: 'Edge Playback Speed',
      maxTextLength: 'Edge Text Limit'
    },
    openai: {
      model: 'OpenAI TTS Model',
      voice: 'OpenAI Voice',
      speed: 'OpenAI Playback Speed',
      baseUrl: 'OpenAI-Compatible Base URL',
      language: 'OpenAI Language Hint',
      instructions: 'OpenAI Voice Instructions',
      responseFormat: 'OpenAI Response Format',
      consentAttestation: 'OpenAI Voice Consent',
      pcmSampleRate: 'OpenAI PCM Sample Rate',
      maxTextLength: 'OpenAI Text Limit'
    },
    elevenlabs: {
      voiceId: 'ElevenLabs Voice',
      modelId: 'ElevenLabs Model',
      speed: 'ElevenLabs Playback Speed',
      streamingModelId: 'ElevenLabs Streaming Model',
      baseUrl: 'ElevenLabs Base URL',
      wssUrl: 'ElevenLabs WebSocket URL',
      maxTextLength: 'ElevenLabs Text Limit'
    },
    xai: {
      voiceId: 'xAI (Grok) Voice',
      language: 'xAI Language',
      speed: 'xAI Playback Speed',
      baseUrl: 'xAI Base URL',
      autoSpeechTags: 'xAI Auto Speech Tags',
      textNormalization: 'xAI Text Normalization',
      streamingUrl: 'xAI Streaming URL',
      optimizeStreamingLatency: 'xAI Streaming Latency Optimization',
      sampleRate: 'xAI Sample Rate',
      bitRate: 'xAI Bit Rate',
      maxTextLength: 'xAI Text Limit'
    },
    minimax: {
      model: 'MiniMax TTS Model',
      voiceId: 'MiniMax Voice',
      region: 'MiniMax Region',
      baseUrl: 'MiniMax Base URL',
      speed: 'MiniMax Playback Speed',
      vol: 'MiniMax Volume',
      pitch: 'MiniMax Pitch',
      emotion: 'MiniMax Emotion',
      sampleRate: 'MiniMax Sample Rate',
      bitrate: 'MiniMax Bitrate',
      groupId: 'MiniMax Group ID',
      maxTextLength: 'MiniMax Text Limit'
    },
    mistral: {
      model: 'Mistral TTS Model',
      voiceId: 'Mistral Voice',
      baseUrl: 'Mistral Base URL',
      maxTextLength: 'Mistral Text Limit'
    },
    gemini: {
      model: 'Gemini TTS Model',
      voice: 'Gemini Voice',
      baseUrl: 'Gemini Base URL',
      audioTags: 'Gemini Audio Tags',
      personaPromptFile: 'Gemini Persona File',
      maxTextLength: 'Gemini Text Limit'
    },
    neutts: {
      model: 'NeuTTS Model',
      device: 'NeuTTS Device',
      refAudio: 'NeuTTS Reference Audio',
      refText: 'NeuTTS Reference Text',
      maxTextLength: 'NeuTTS Text Limit'
    },
    kittentts: {
      model: 'KittenTTS Model',
      voice: 'KittenTTS Voice',
      speed: 'KittenTTS Playback Speed',
      cleanText: 'KittenTTS Text Cleanup',
      maxTextLength: 'KittenTTS Text Limit'
    },
    piper: {
      voice: 'Piper Voice',
      voicesDir: 'Piper Voice Directory',
      useCuda: 'Piper CUDA',
      lengthScale: 'Piper Length Scale',
      noiseScale: 'Piper Noise Scale',
      noiseWScale: 'Piper Noise W-Scale',
      volume: 'Piper Volume',
      normalizeAudio: 'Piper Audio Normalization',
      speakerId: 'Piper Speaker ID',
      maxTextLength: 'Piper Text Limit'
    },
    deepinfra: {
      model: 'DeepInfra TTS Model',
      voice: 'DeepInfra Voice',
      speed: 'DeepInfra Playback Speed',
      baseUrl: 'DeepInfra Base URL',
      language: 'DeepInfra Language Hint',
      instructions: 'DeepInfra Voice Instructions',
      responseFormat: 'DeepInfra Response Format',
      maxTextLength: 'DeepInfra Text Limit'
    },
    openrouter: {
      model: 'OpenRouter TTS Model',
      voice: 'OpenRouter Voice',
      speed: 'OpenRouter Playback Speed',
      baseUrl: 'OpenRouter Base URL',
      responseFormat: 'OpenRouter Response Format',
      maxTextLength: 'OpenRouter Text Limit'
    }
  },
  memory: {
    memoryEnabled: 'Persistent Memory',
    userProfileEnabled: 'User Profile',
    memoryCharLimit: 'Memory Budget',
    userCharLimit: 'Profile Budget',
    provider: 'Memory Provider'
  },
  context: {
    engine: 'Context Engine'
  },
  compression: {
    enabled: 'Auto-Compression',
    threshold: 'Compression Threshold',
    codexGpt55Autoraise: 'Codex Compression Auto-Raise',
    targetRatio: 'Compression Target',
    protectLastN: 'Protected Recent Messages'
  },
  auxiliary: {
    compression: {
      timeout: 'Compression model timeout (s)'
    }
  },
  delegation: {
    model: 'Subagent Model',
    provider: 'Subagent Provider',
    maxIterations: 'Subagent Turn Limit',
    maxConcurrentChildren: 'Parallel Subagents',
    childTimeoutSeconds: 'Subagent Timeout',
    reasoningEffort: 'Subagent Reasoning Effort'
  },
  updates: {
    nonInteractiveLocalChanges: 'In-App Update Local Changes'
  }
})

export const FIELD_DESCRIPTIONS: Record<string, string> = defineFieldCopy({
  model: 'Used for new chats unless you pick a different model in the composer.',
  modelContextLength:
    "Overrides the detected context window of the MAIN chat model only (tokens). Leave at 0 to use the selected model's detected value. Does not affect auxiliary/MoA models.",
  fallbackProviders: 'Backup provider:model entries to try if the default model fails.',
  display: {
    personality: 'Default assistant style for new sessions.',
    showReasoning: 'Show reasoning sections when the backend provides them.'
  },
  desktop: {
    repoScanEnabled: 'Scan local folders for Git repositories to show in Projects.',
    repoScanRoots: 'Folders to scan. Leave empty to scan your home directory.',
    repoScanExcludePaths: 'Folders and their descendants to skip during repository discovery.'
  },
  timezone: 'IANA timezone identifier. Blank uses the system timezone.',
  browser: {
    useRealProfile:
      "Local browsing uses your real logins. Hermes copies your default browser's profile (cookies, logins, preferences) into a managed snapshot and drives it with its packaged Chromium — your live profile is never opened directly, and the copy is refreshed from it on each run. Also lets the agent open a local real-profile session on request even when a cloud browser backend is configured. Only Chromium browsers (Chrome, Edge, Brave, Brave Origin, Chromium) are supported; a non-Chromium default fails with a clear message. Off by default."
  },
  agent: {
    imageInputMode: 'Controls how image attachments are sent to the model.',
    maxTurns: 'Upper bound for tool-calling turns before Hermes stops a run.'
  },
  terminal: {
    cwd: 'Default project folder for tool and terminal work.',
    persistentShell: 'Keep shell state between commands when the backend supports it.',
    envPassthrough: 'Environment variables to pass into tool execution.',
    dockerImage: 'Container image used when the execution backend is Docker.',
    singularityImage: 'Image used when the execution backend is Singularity.',
    modalImage: 'Image used when the execution backend is Modal.',
    daytonaImage: 'Image used when the execution backend is Daytona.'
  },
  codeExecution: {
    mode: 'How strictly code execution is scoped to the current project.'
  },
  fileReadMaxChars: 'Maximum characters Hermes can read from one file request.',
  approvals: {
    mode: 'How Hermes handles commands that need explicit approval.',
    timeout: 'How long approval prompts wait before timing out.'
  },
  security: {
    redactSecrets: 'Hide detected secrets from model-visible content when possible.'
  },
  checkpoints: {
    enabled: 'Create rollback snapshots before file edits.'
  },
  memory: {
    memoryEnabled: 'Save durable memories that can help future sessions.',
    userProfileEnabled: 'Maintain a compact profile of user preferences.'
  },
  context: {
    engine: 'Strategy for managing long conversations near the context limit.'
  },
  compression: {
    enabled: 'Summarize older context when conversations get large.',
    codexGpt55Autoraise: 'Raise compression to 85% for supported ChatGPT Codex OAuth models.'
  },
  auxiliary: {
    compression: {
      timeout:
        'Seconds to wait for the auxiliary compression model per call (default 120). Raise for slow local models.'
    }
  },
  voice: {
    autoTts:
      'Backend default for automatically speaking voice replies in the CLI and messaging gateways. The Desktop Read Replies Aloud control remains an independent local preference.',
    voiceChatMode:
      'chained: speech-to-text → Hermes → text-to-speech with the providers below. gpt-live: one full-duplex OpenAI voice model (gpt-live-1) listens and talks, and hands every real request to Hermes — any model you have selected answers with the full toolset. Needs an OpenAI API key; the voice layer bills $0.05 per minute.',
    clientDirect:
      'When connected remotely, let Desktop call the active profile’s speech providers directly instead of relaying audio through the gateway.',
    beepEnabled: 'Play a short sound when voice recording starts and stops.',
    beepVolume: 'Recording beep volume from 0 to 1.',
    thinkingSound: 'Play a subtle ambient cue while the agent is working during voice conversation.',
    silenceThreshold: 'RMS level below 0–32767 that counts as silence while recording.',
    silenceDuration: 'Seconds of silence before recording stops automatically.',
    bargeIn: 'Let the user interrupt generated speech by speaking.',
    bargeInGraceSeconds: 'Delay before barge-in is armed after speech starts.',
    bargeInThresholdMultiplier: 'Speech must exceed the calibrated room noise by this factor to trigger barge-in.',
    stopPhrases: 'Comma-separated phrases that end a hands-free voice conversation. Leave empty to disable them.',
    gptLive: {
      model: 'OpenAI model used by the full-duplex GPT-Live voice layer.',
      voice: 'Voice for GPT-Live mode. Custom voice IDs are accepted.',
      instructions:
        'Extra sentences for the live voice persona (tone, pace, language). Hermes keeps its own system prompt.'
    }
  },
  tts: {
    speed: 'Fallback playback speed for providers that do not define their own speed. 1.0 is normal.',
    outputFormat: 'Preferred synthesized audio container. A provider’s supported formats still apply.',
    maxTextLength: 'Default maximum characters sent in one TTS request. Longer text is split instead of truncated.',
    streaming: {
      minLen: 'Shortest first sentence, in characters, that streaming speech can play on its own.',
      provider: 'Pin a streaming provider, choose Auto, or leave blank to follow the selected TTS provider.'
    },
    edge: {
      speed: 'Playback speed for Edge TTS. 1.0 is normal.',
      maxTextLength: 'Maximum characters per Edge request. Longer text is split.'
    },
    openai: {
      speed: 'Playback speed for OpenAI and compatible endpoints. 1.0 is normal.',
      baseUrl: 'Optional OpenAI-compatible speech endpoint. Leave blank for the official API.',
      language: 'Optional language hint forwarded as lang_code by compatible endpoints.',
      instructions: 'Optional voice-design direction such as tone, emotion, pacing, or accent.',
      responseFormat: 'Audio response format requested from OpenAI or a compatible endpoint.',
      consentAttestation: 'Optional consent text required by compatible servers for cloned voices.',
      pcmSampleRate: 'Expected raw PCM sample rate for compatible streaming endpoints that omit the response header.',
      maxTextLength: 'Maximum characters per OpenAI request. Longer text is split.'
    },
    elevenlabs: {
      speed: 'Playback speed for ElevenLabs models that support it. 1.0 is normal; v3 models ignore this.',
      streamingModelId: 'Optional model override used only for chunked streaming playback.',
      baseUrl: 'Optional ElevenLabs API base URL.',
      wssUrl: 'Optional ElevenLabs streaming WebSocket URL. Derived from Base URL when blank.',
      maxTextLength: 'Maximum characters per ElevenLabs request. Longer text is split.'
    },
    xai: {
      voiceId: 'xAI voice ID (e.g. eve) or a custom voice ID.',
      language: 'Spoken language code (e.g. en, pt-BR) or "auto" for auto-detection.',
      speed: 'Playback speed. 0.7 = slower, 1.0 = normal, 1.5 = faster.',
      baseUrl: 'Optional xAI TTS endpoint override.',
      autoSpeechTags: 'Let an LLM insert expressive audio tags ([laughing], [sighs]) into the script before synthesis.',
      textNormalization: 'Speak numbers, abbreviations, and symbols in written form.',
      streamingUrl: 'Optional xAI chunked-TTS WebSocket endpoint override.',
      optimizeStreamingLatency: 'Latency vs. quality trade-off. 0 = best quality, 2 = lowest latency.',
      sampleRate: 'Audio sample rate in Hz. Higher = better quality, larger files.',
      bitRate: 'MP3 bitrate in bps. Only applies when codec is mp3.',
      maxTextLength: 'Maximum characters per xAI request. Longer text is split.'
    },
    minimax: {
      region: 'MiniMax service region. The selected region also selects its matching credential.',
      baseUrl: 'Optional MiniMax TTS endpoint override for the selected region.',
      speed: 'MiniMax speech speed. 1.0 is normal.',
      vol: 'MiniMax output volume.',
      pitch: 'MiniMax pitch adjustment.',
      emotion: 'MiniMax delivery emotion.',
      sampleRate: 'MiniMax output sample rate in Hz.',
      bitrate: 'MiniMax output bitrate in bps.',
      groupId: 'Optional MiniMax Group ID appended to requests that do not already carry one.',
      maxTextLength: 'Maximum characters per MiniMax request. Longer text is split.'
    },
    mistral: {
      baseUrl: 'Optional Mistral API base URL.',
      maxTextLength: 'Maximum characters per Mistral request. Longer text is split.'
    },
    gemini: {
      baseUrl: 'Optional Gemini API base URL.',
      audioTags: 'Let an auxiliary model add expressive audio tags for supported Gemini 3.1 TTS models.',
      personaPromptFile: 'Optional Markdown or text file with performance direction for Gemini.',
      maxTextLength: 'Maximum characters per Gemini request, including persona and tag directions.'
    },
    neutts: {
      device: 'Local inference device for NeuTTS.',
      refAudio: 'Optional reference-audio file. Blank uses the bundled sample.',
      refText: 'Optional transcript for the reference audio. Blank uses the bundled sample.',
      maxTextLength: 'Maximum characters per NeuTTS request. Longer text is split.'
    },
    kittentts: {
      speed: 'KittenTTS playback speed. 1.0 is normal.',
      cleanText: 'Expand numbers, currencies, and units before local synthesis.',
      maxTextLength: 'Maximum characters per KittenTTS request. Longer text is split.'
    },
    piper: {
      voicesDir: 'Optional directory for downloaded Piper voices. Blank uses the profile cache.',
      useCuda: 'Load Piper with CUDA when the installed runtime supports it.',
      lengthScale: 'Piper speaking-time scale. 2.0 is about twice as slow.',
      noiseScale: 'Piper phoneme noise scale.',
      noiseWScale: 'Piper word-boundary noise scale.',
      volume: 'Piper output volume.',
      normalizeAudio: 'Normalize Piper audio before playback.',
      speakerId: 'Optional Piper speaker ID for voices that expose multiple speakers.',
      maxTextLength: 'Maximum characters per Piper request. Longer text is split.'
    },
    deepinfra: {
      speed: 'Playback speed for DeepInfra. 1.0 is normal.',
      baseUrl: 'Optional DeepInfra TTS endpoint override.',
      language: 'Optional language hint forwarded by compatible DeepInfra endpoints.',
      instructions: 'Optional voice-design direction forwarded to compatible DeepInfra endpoints.',
      responseFormat: 'Audio response format requested from DeepInfra.',
      maxTextLength: 'Maximum characters per DeepInfra request. Longer text is split.'
    },
    openrouter: {
      model: 'OpenRouter TTS model ID. Built-in suggestions stay editable for new models.',
      voice: 'Voice ID accepted by the selected OpenRouter TTS model.',
      speed: 'Playback speed for models that support it. 1.0 is normal.',
      baseUrl: 'Optional OpenRouter TTS endpoint override.',
      responseFormat: 'Audio response format requested from OpenRouter, such as mp3 or pcm.',
      maxTextLength: 'Maximum characters per OpenRouter request. Longer text is split.'
    }
  },
  stt: {
    enabled: 'Enable local or provider-backed speech transcription.',
    echoTranscripts: 'Post the raw 🎙️ transcript of voice messages back to the chat.',
    elevenlabs: {
      languageCode: 'Optional ISO-639-3 language code. Blank lets ElevenLabs auto-detect.'
    }
  },
  updates: {
    nonInteractiveLocalChanges:
      'When Hermes updates itself from the app (no terminal prompt), keep local source edits (stash) or throw them away (discard). Terminal updates always ask.'
  }
})

// Curated desktop config surface: only fields a user might tune from the app.
export const SECTIONS: DesktopConfigSection[] = [
  {
    id: 'model',
    label: 'Model',
    icon: Box,
    keys: ['model_context_length', 'fallback_providers']
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageCircle,
    keys: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    keys: []
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: Monitor,
    keys: [
      'terminal.cwd',
      'desktop.repo_scan_enabled',
      'desktop.repo_scan_roots',
      'desktop.repo_scan_exclude_paths',
      'code_execution.mode',
      'terminal.persistent_shell',
      'terminal.env_passthrough',
      'file_read_max_chars'
    ]
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: Lock,
    keys: [
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'checkpoints.enabled'
    ]
  },
  {
    id: 'browser',
    label: 'Browser',
    icon: Globe,
    keys: ['browser.use_real_profile', 'browser.allow_private_urls', 'browser.auto_local_for_private_urls']
  },
  {
    id: 'memory',
    label: 'Memory & Context',
    icon: Brain,
    keys: [
      'memory.memory_enabled',
      'memory.user_profile_enabled',
      'memory.memory_char_limit',
      'memory.user_char_limit',
      'memory.provider',
      'context.engine',
      'compression.enabled',
      'compression.threshold',
      'compression.codex_gpt55_autoraise',
      'compression.target_ratio',
      'compression.protect_last_n',
      'auxiliary.compression.timeout'
    ]
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    keys: [
      'voice.voice_chat_mode',
      'voice.gpt_live.model',
      'voice.gpt_live.voice',
      'voice.gpt_live.instructions',
      'voice.record_key',
      'voice.max_recording_seconds',
      'voice.client_direct',
      'voice.beep_enabled',
      'voice.beep_volume',
      'voice.thinking_sound',
      'voice.silence_threshold',
      'voice.silence_duration',
      'voice.barge_in',
      'voice.barge_in_grace_seconds',
      'voice.barge_in_threshold_multiplier',
      'voice.stop_phrases',
      'stt.enabled',
      'stt.echo_transcripts',
      'stt.provider',
      'stt.local.model',
      'stt.local.language',
      'stt.openai.model',
      'stt.groq.model',
      'stt.mistral.model',
      'stt.elevenlabs.model_id',
      'stt.elevenlabs.language_code',
      'stt.elevenlabs.tag_audio_events',
      'stt.elevenlabs.diarize',
      'voice.auto_tts',
      'tts.provider',
      'tts.speed',
      'tts.output_format',
      'tts.max_text_length',
      'tts.streaming.min_len',
      'tts.streaming.provider',
      'tts.edge.voice',
      'tts.edge.speed',
      'tts.edge.max_text_length',
      'tts.openai.model',
      'tts.openai.voice',
      'tts.openai.speed',
      'tts.openai.base_url',
      'tts.openai.language',
      'tts.openai.instructions',
      'tts.openai.response_format',
      'tts.openai.consent_attestation',
      'tts.openai.pcm_sample_rate',
      'tts.openai.max_text_length',
      'tts.elevenlabs.voice_id',
      'tts.elevenlabs.model_id',
      'tts.elevenlabs.speed',
      'tts.elevenlabs.streaming_model_id',
      'tts.elevenlabs.base_url',
      'tts.elevenlabs.wss_url',
      'tts.elevenlabs.max_text_length',
      'tts.xai.voice_id',
      'tts.xai.language',
      'tts.xai.speed',
      'tts.xai.base_url',
      'tts.xai.auto_speech_tags',
      'tts.xai.text_normalization',
      'tts.xai.streaming_url',
      'tts.xai.optimize_streaming_latency',
      'tts.xai.sample_rate',
      'tts.xai.bit_rate',
      'tts.xai.max_text_length',
      'tts.minimax.model',
      'tts.minimax.voice_id',
      'tts.minimax.region',
      'tts.minimax.base_url',
      'tts.minimax.speed',
      'tts.minimax.vol',
      'tts.minimax.pitch',
      'tts.minimax.emotion',
      'tts.minimax.sample_rate',
      'tts.minimax.bitrate',
      'tts.minimax.group_id',
      'tts.minimax.max_text_length',
      'tts.mistral.model',
      'tts.mistral.voice_id',
      'tts.mistral.base_url',
      'tts.mistral.max_text_length',
      'tts.gemini.model',
      'tts.gemini.voice',
      'tts.gemini.base_url',
      'tts.gemini.audio_tags',
      'tts.gemini.persona_prompt_file',
      'tts.gemini.max_text_length',
      'tts.deepinfra.model',
      'tts.deepinfra.voice',
      'tts.deepinfra.speed',
      'tts.deepinfra.base_url',
      'tts.deepinfra.language',
      'tts.deepinfra.instructions',
      'tts.deepinfra.response_format',
      'tts.deepinfra.max_text_length',
      'tts.openrouter.model',
      'tts.openrouter.voice',
      'tts.openrouter.speed',
      'tts.openrouter.base_url',
      'tts.openrouter.response_format',
      'tts.openrouter.max_text_length',
      'tts.neutts.model',
      'tts.neutts.device',
      'tts.neutts.ref_audio',
      'tts.neutts.ref_text',
      'tts.neutts.max_text_length',
      'tts.kittentts.model',
      'tts.kittentts.voice',
      'tts.kittentts.speed',
      'tts.kittentts.clean_text',
      'tts.kittentts.max_text_length',
      'tts.piper.voice',
      'tts.piper.voices_dir',
      'tts.piper.use_cuda',
      'tts.piper.length_scale',
      'tts.piper.noise_scale',
      'tts.piper.noise_w_scale',
      'tts.piper.volume',
      'tts.piper.normalize_audio',
      'tts.piper.speaker_id',
      'tts.piper.max_text_length'
    ]
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    keys: [
      'toolsets',
      'terminal.backend',
      'terminal.timeout',
      'terminal.docker_image',
      'terminal.singularity_image',
      'terminal.modal_image',
      'terminal.daytona_image',
      'tool_output.max_bytes',
      'tool_output.max_lines',
      'tool_output.max_line_length',
      'checkpoints.max_snapshots',
      'agent.max_turns',
      'agent.api_max_retries',
      'agent.service_tier',
      'agent.tool_use_enforcement',
      'delegation.model',
      'delegation.provider',
      'delegation.max_iterations',
      'delegation.max_concurrent_children',
      'delegation.child_timeout_seconds',
      'delegation.reasoning_effort',
      'updates.non_interactive_local_changes'
    ]
  }
]

export interface ModeOption {
  id: ThemeMode
  label: string
  icon: IconComponent
}

export const MODE_OPTIONS: ModeOption[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor }
]
