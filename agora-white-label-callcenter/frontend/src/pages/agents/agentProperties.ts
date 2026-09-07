export interface Agent {
  id: number
  agent_id: string
  agent_name: string
  app_id: string
  system_content: string | null
  greeting_message: string | null
  failure_message: string | null
  voice_id: string | null
  properties: Record<string, unknown> | null
  created_at: string | null
}

export type SectionKey = 'llm' | 'tts' | 'asr' | 'parameters' | 'turn_detection' | 'advanced_features'

export interface JsonSections {
  llm: string
  tts: string
  asr: string
  parameters: string
  turn_detection: string
  advanced_features: string
}

export type JsonSectionErrors = Partial<Record<SectionKey, string>>

export type EditorMode = 'ui' | 'json'

export interface SimpleAgentFields {
  prompt: string
  greeting: string
  voiceId: string
  volume: number
  speed: number
}

export interface VoiceOption {
  voice_id: string
  name: string
  language: string
  gender: string | null
  age: string | null
}

export const SECTIONS: { key: SectionKey; label: string; border: string; rows: number }[] = [
  { key: 'llm',               label: 'LLM',               border: 'border-l-indigo-500', rows: 22 },
  { key: 'tts',               label: 'TTS',               border: 'border-l-purple-500', rows: 14 },
  { key: 'asr',               label: 'ASR',               border: 'border-l-emerald-500', rows: 6  },
  { key: 'parameters',        label: 'Parameters',        border: 'border-l-amber-500',  rows: 14 },
  { key: 'turn_detection',    label: 'Turn Detection',    border: 'border-l-blue-500',   rows: 16 },
  { key: 'advanced_features', label: 'Advanced Features', border: 'border-l-gray-400',   rows: 6  },
]

export const DEFAULT_SIMPLE_FIELDS: SimpleAgentFields = {
  prompt: '',
  greeting: '',
  voiceId: 'Chinese (Mandarin)_Male_Announcer',
  volume: 1,
  speed: 1,
}

export const DEFAULT_PROPERTIES = {
  llm: {
    url: 'https://api.openai.com/v1/chat/completions',
    api_key: '',
    system_messages: [{ role: 'system', content: '' }],
    max_history: 32,
    greeting_message: '',
    failure_message: '',
    params: { model: 'gpt-5.4-nano' },
  },
  tts: {
    vendor: 'minimax',
    params: {
      key: '',
      url: 'wss://api-uw.minimax.io/ws/v1/t2a_v2',
      model: 'speech-02-turbo',
      group_id: '1967483817044222128',
      voice_setting: {
        voice_id: DEFAULT_SIMPLE_FIELDS.voiceId,
        sample_rate: 8000,
        speed: DEFAULT_SIMPLE_FIELDS.speed,
        vol: DEFAULT_SIMPLE_FIELDS.volume,
      },
      language_boost: 'Chinese',
    },
  },
  asr: { vendor: 'ares', language: 'zh-CN' },
  parameters: {
    idle_timeout: 120,
    transcript: { enable: true, protocol_version: 'v2', enable_words: true, redundant: false },
    enable_dump: true,
    data_channel: 'rtm',
    audio_scenario: 'default',
    enable_metrics: true,
    silence_config: { action: 'think', content: '', timeout_ms: 4000 },
    enable_flexible: true,
    enable_error_message: true,
  },
  turn_detection: {
    mode: 'default',
    config: {
      start_of_speech: {
        mode: 'vad',
        vad_config: { interrupt_duration_ms: 160, speaking_interrupt_duration_ms: 160, prefix_padding_ms: 800 },
      },
      end_of_speech: {
        mode: 'semantic',
        semantic_config: { silence_duration_ms: 240, max_wait_ms: 3000 },
      },
    },
  },
  advanced_features: { enable_rtm: true, enable_sal: false, enable_tools: true },
}

export function extractSections(props: Record<string, unknown>): JsonSections {
  const { idle_timeout, parameters, llm, tts, asr, turn_detection, advanced_features } = props
  const paramsWithIdle = { idle_timeout, ...(parameters as Record<string, unknown> ?? {}) }
  return {
    llm:               JSON.stringify(llm ?? {}, null, 2),
    tts:               JSON.stringify(tts ?? {}, null, 2),
    asr:               JSON.stringify(asr ?? {}, null, 2),
    parameters:        JSON.stringify(paramsWithIdle, null, 2),
    turn_detection:    JSON.stringify(turn_detection ?? {}, null, 2),
    advanced_features: JSON.stringify(advanced_features ?? {}, null, 2),
  }
}

export function sectionsToProps(sections: JsonSections, original: Record<string, unknown>): Record<string, unknown> {
  const result = { ...original }
  const { idle_timeout, ...restParams } = JSON.parse(sections.parameters) as Record<string, unknown>
  result.llm               = JSON.parse(sections.llm)
  result.tts               = JSON.parse(sections.tts)
  result.asr               = JSON.parse(sections.asr)
  result.parameters        = restParams
  result.idle_timeout      = idle_timeout
  result.turn_detection    = JSON.parse(sections.turn_detection)
  result.advanced_features = JSON.parse(sections.advanced_features)
  return result
}

export function makeDefaultSections(): JsonSections {
  const { idle_timeout, parameters, ...rest } = DEFAULT_PROPERTIES as unknown as Record<string, unknown>
  const paramsWithIdle = { idle_timeout, ...(parameters as Record<string, unknown>) }
  return {
    llm:               JSON.stringify(rest.llm,               null, 2),
    tts:               JSON.stringify(rest.tts,               null, 2),
    asr:               JSON.stringify(rest.asr,               null, 2),
    parameters:        JSON.stringify(paramsWithIdle,          null, 2),
    turn_detection:    JSON.stringify(rest.turn_detection,    null, 2),
    advanced_features: JSON.stringify(rest.advanced_features, null, 2),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function extractSimpleFieldsFromProps(props: Record<string, unknown>): SimpleAgentFields {
  const llm = asRecord(props.llm)
  const msgs = Array.isArray(llm.system_messages) ? llm.system_messages as Record<string, unknown>[] : []
  const sys = msgs.find(m => m.role === 'system')
  const tts = asRecord(props.tts)
  const params = asRecord(tts.params)
  const vs = asRecord(params.voice_setting)
  return {
    prompt: typeof sys?.content === 'string' ? sys.content : '',
    greeting: typeof llm.greeting_message === 'string' ? llm.greeting_message : '',
    voiceId: typeof vs.voice_id === 'string' && vs.voice_id
      ? vs.voice_id
      : DEFAULT_SIMPLE_FIELDS.voiceId,
    volume: numOr(vs.vol, DEFAULT_SIMPLE_FIELDS.volume),
    speed: numOr(vs.speed, DEFAULT_SIMPLE_FIELDS.speed),
  }
}

export function extractSimpleFieldsFromSections(
  sections: JsonSections,
  fallback: SimpleAgentFields = DEFAULT_SIMPLE_FIELDS,
): SimpleAgentFields {
  try {
    return extractSimpleFieldsFromProps({
      llm: JSON.parse(sections.llm),
      tts: JSON.parse(sections.tts),
    })
  } catch {
    return fallback
  }
}

export function applySimpleFieldsToSections(
  sections: JsonSections,
  fields: SimpleAgentFields,
): JsonSections {
  const next = { ...sections }
  try {
    const llm = asRecord(JSON.parse(sections.llm || '{}'))
    const msgs = Array.isArray(llm.system_messages)
      ? [...(llm.system_messages as Record<string, unknown>[])]
      : []
    const idx = msgs.findIndex(m => m.role === 'system')
    if (idx >= 0) msgs[idx] = { ...msgs[idx], content: fields.prompt }
    else msgs.unshift({ role: 'system', content: fields.prompt })
    llm.system_messages = msgs
    llm.greeting_message = fields.greeting
    next.llm = JSON.stringify(llm, null, 2)
  } catch { /* keep current llm json */ }

  try {
    const tts = asRecord(JSON.parse(sections.tts || '{}'))
    const params = asRecord(tts.params)
    const vs = asRecord(params.voice_setting)
    vs.voice_id = fields.voiceId
    vs.vol = max(0.1, min(10, fields.volume))
    vs.speed = max(0.5, min(2, fields.speed))
    if (vs.sample_rate == null) vs.sample_rate = 8000
    params.voice_setting = vs
    tts.params = params
    next.tts = JSON.stringify(tts, null, 2)
  } catch { /* keep current tts json */ }

  return next
}

export function validateSections(sections: JsonSections): JsonSectionErrors {
  const errors: JsonSectionErrors = {}
  for (const { key } of SECTIONS) {
    try { JSON.parse(sections[key]) } catch {
      errors[key] = 'Invalid JSON'
    }
  }
  return errors
}
