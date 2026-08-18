import { authFetch } from '../../lib/api'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Sparkles, Save, CheckCircle2, AlertCircle, RefreshCw, FileText, Database, Pencil, X, Plus, Loader2, MessageSquare, Bot, User, Send, ChevronDown, AlignJustify, LayoutList, Mic, VolumeX } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { VoicePromptData, StructuredOutputSchema, StructuredOutputVariable } from '../../types'

type GenState = 'idle' | 'generating' | 'done' | 'saved' | 'error'
type ViewMode = 'raw' | 'sections'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

// Section keys in assembly order (greeting + failure_message are excluded from system prompt assembly)
const SECTION_KEYS = [
  'core_guidelines',
  'randomization_rules',
  'global_execution_logic',
  'question_sop',
  'interview_script',
  'closing_remarks',
  'data_mapping',
] as const

const GREETING_KEY = 'greeting'
const FAILURE_MESSAGE_KEY = 'failure_message'

// Maps section key → i18n translation key for section label
const SECTION_LABEL_KEYS: Record<string, string> = {
  greeting:        'prompt_editor.label_greeting',
  failure_message: 'prompt_editor.label_failure_message',
  core_guidelines:        'prompt_editor.label_section_core',
  randomization_rules:    'prompt_editor.label_section_random',
  global_execution_logic: 'prompt_editor.label_section_logic',
  question_sop:           'prompt_editor.label_section_sop',
  interview_script:       'prompt_editor.label_section_script',
  closing_remarks:        'prompt_editor.label_section_closing',
  data_mapping:           'prompt_editor.label_section_mapping',
}

// Clean white minimal color scheme — all sections use gray/indigo tones
const SECTION_COLORS: Record<string, { header: string; border: string; badge: string }> = {
  greeting:        { header: 'bg-emerald-50 hover:bg-emerald-100', border: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-700' },
  failure_message: { header: 'bg-red-50 hover:bg-red-100',         border: 'border-red-200',     badge: 'bg-red-50 text-red-600' },
  core_guidelines:        { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-indigo-50 text-indigo-600' },
  randomization_rules:    { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-amber-50 text-amber-700' },
  global_execution_logic: { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-indigo-50 text-indigo-600' },
  question_sop:           { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-gray-100 text-gray-600' },
  interview_script:       { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-indigo-50 text-indigo-600' },
  closing_remarks:        { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-gray-100 text-gray-600' },
  data_mapping:           { header: 'bg-gray-50 hover:bg-gray-100',    border: 'border-gray-200',    badge: 'bg-gray-100 text-gray-600' },
}

interface PromptSection {
  key: string
  content: string
  collapsed: boolean
}

/** Parse a sections JSON object (from AI or DB) into PromptSection[].
 *  Greeting first, failure_message second, then the 7 system-prompt sections in fixed order. */
function sectionsFromJson(data: Record<string, string | null>): PromptSection[] {
  const result: PromptSection[] = []
  const greeting = data[GREETING_KEY]
  if (greeting && greeting.trim()) {
    result.push({ key: GREETING_KEY, content: greeting.trim(), collapsed: false })
  }
  const failureMsg = data[FAILURE_MESSAGE_KEY]
  if (failureMsg && failureMsg.trim()) {
    result.push({ key: FAILURE_MESSAGE_KEY, content: failureMsg.trim(), collapsed: false })
  }
  for (const key of SECTION_KEYS) {
    const val = data[key]
    if (val && val.trim()) {
      result.push({ key, content: val.trim(), collapsed: false })
    }
  }
  return result
}

/** Assemble the system prompt text (excludes greeting and failure_message). */
function assemblePrompt(sections: PromptSection[]): string {
  return sections
    .filter(s => s.key !== GREETING_KEY && s.key !== FAILURE_MESSAGE_KEY)
    .map(s => s.content.trim())
    .filter(Boolean)
    .join('\n\n---\n\n')
}

/** Extract the greeting text from sections. */
function extractGreeting(sections: PromptSection[]): string {
  return sections.find(s => s.key === GREETING_KEY)?.content.trim() ?? ''
}

/** Extract the failure message text from sections. */
function extractFailureMessage(sections: PromptSection[]): string {
  return sections.find(s => s.key === FAILURE_MESSAGE_KEY)?.content.trim() ?? ''
}

/** Rebuild a JSON dict from sections (for saving). */
function sectionsToJson(sections: PromptSection[]): Record<string, string | null> {
  const obj: Record<string, string | null> = {}
  for (const s of sections) {
    obj[s.key] = s.content.trim() || null
  }
  return obj
}

interface EditingVar {
  key: string
  original: string
  value: StructuredOutputVariable
}

export function PromptEditorPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()

  const [data, setData] = useState<VoicePromptData | null>(null)
  const [prompt, setPrompt] = useState('')          // raw view text
  const [genState, setGenState] = useState<GenState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [showSim, setShowSim] = useState(false)

  const [schema, setSchema] = useState<StructuredOutputSchema | null>(null)
  const [schemaExtracting, setSchemaExtracting] = useState(false)
  const [schemaSaved, setSchemaSaved] = useState(false)
  const [editingVar, setEditingVar] = useState<EditingVar | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('sections')
  const [sections, setSections] = useState<PromptSection[]>([])
  const [byteCount, setByteCount] = useState(0)     // progress during generation

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const schemaPollerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/api/surveys/${id}/voice-prompt`)
      const d: VoicePromptData = await r.json()
      setData(d)

      if (d.voice_agent_prompt_sections) {
        // Preferred: use stored JSON sections
        setSections(sectionsFromJson(d.voice_agent_prompt_sections as Record<string, string | null>))
        setPrompt(assemblePrompt(sectionsFromJson(d.voice_agent_prompt_sections as Record<string, string | null>)))
        setViewMode('sections')
        setGenState('done')
      } else if (d.voice_agent_prompt) {
        // Fallback for old prompts without sections JSON
        setPrompt(d.voice_agent_prompt)
        setViewMode('raw')
        setGenState('done')
      }

      if (d.structured_output_schema) {
        setSchema(d.structured_output_schema)
        setSchemaExtracting(false)
        if (schemaPollerRef.current) {
          clearInterval(schemaPollerRef.current)
          schemaPollerRef.current = null
        }
      }
    } catch {
      setErrorMsg(t('common.server_error'))
    }
  }, [id, t])

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
    return () => {
      if (schemaPollerRef.current) clearInterval(schemaPollerRef.current)
    }
  }, [fetchData])

  function startSchemaPolling() {
    setSchemaExtracting(true)
    if (schemaPollerRef.current) clearInterval(schemaPollerRef.current)
    schemaPollerRef.current = setInterval(async () => {
      try {
        const r = await authFetch(`${API}/api/surveys/${id}/voice-prompt`)
        const d: VoicePromptData = await r.json()
        if (d.structured_output_schema) {
          setSchema(d.structured_output_schema)
          setSchemaExtracting(false)
          clearInterval(schemaPollerRef.current!)
          schemaPollerRef.current = null
        }
      } catch { /* ignore */ }
    }, 3000)
  }

  async function handleGenerate() {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setSections([])
    setPrompt('')
    setSchema(null)
    setGenState('generating')
    setErrorMsg('')
    setByteCount(0)

    try {
      const resp = await authFetch(`${API}/api/surveys/${id}/voice-prompt/generate?language=${i18n.language}`, {
        method: 'POST',
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || t('common.error_occurred'))
      }

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        accumulated += chunk
        setByteCount(accumulated.length)
      }

      // Parse JSON sections from accumulated text
      let parsed: Record<string, string | null> | null = null
      try {
        let text = accumulated.trim()
        // Strip ```json ... ``` fences if present
        if (text.startsWith('```')) {
          const firstNewline = text.indexOf('\n')
          const lastFence = text.lastIndexOf('```')
          if (firstNewline !== -1 && lastFence > firstNewline) {
            text = text.slice(firstNewline + 1, lastFence).trim()
          }
        }
        parsed = JSON.parse(text)
      } catch {
        // JSON parse failed → fall back to raw view
      }

      if (parsed) {
        const newSections = sectionsFromJson(parsed)
        setSections(newSections)
        setPrompt(assemblePrompt(newSections))
        setViewMode('sections')
      } else {
        setPrompt(accumulated)
        setViewMode('raw')
      }

      setGenState('done')
      startSchemaPolling()
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setErrorMsg(e instanceof Error ? e.message : t('common.error_occurred'))
      setGenState('error')
    }
  }

  async function handleSave() {
    const assembled = viewMode === 'sections' ? assemblePrompt(sections) : prompt
    const greeting = viewMode === 'sections' ? extractGreeting(sections) : undefined
    const failureMessage = viewMode === 'sections' ? extractFailureMessage(sections) : undefined
    const sectionsJson = viewMode === 'sections' ? sectionsToJson(sections) : undefined

    try {
      const resp = await authFetch(`${API}/api/surveys/${id}/voice-prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: assembled, sections: sectionsJson, greeting, failure_message: failureMessage }),
      })
      if (!resp.ok) throw new Error(t('common.save_failed'))
      setPrompt(assembled)
      setGenState('saved')
      setTimeout(() => setGenState('done'), 2500)
      if (!schema) startSchemaPolling()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('common.save_failed'))
    }
  }

  async function handleSaveSchema(updated: StructuredOutputSchema) {
    try {
      await authFetch(`${API}/api/surveys/${id}/voice-prompt/schema`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: updated }),
      })
      setSchema(updated)
      setSchemaSaved(true)
      setTimeout(() => setSchemaSaved(false), 2000)
    } catch { /* ignore */ }
  }

  function handleVarSave(edited: EditingVar) {
    if (!schema) return
    const updated: StructuredOutputSchema = {}
    for (const [k, v] of Object.entries(schema)) {
      updated[k === edited.original ? edited.key : k] = v
    }
    if (edited.original !== edited.key) delete updated[edited.original]
    updated[edited.key] = edited.value
    handleSaveSchema(updated)
    setEditingVar(null)
  }

  function handleVarDelete(key: string) {
    if (!schema) return
    const updated = { ...schema }
    delete updated[key]
    handleSaveSchema(updated)
  }

  function handleVarAdd() {
    setEditingVar({ key: '', original: '', value: { type: 'integer|null', description: '', codes: {} } })
  }

  function handleSectionChange(idx: number, newContent: string) {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, content: newContent } : s))
  }

  function toggleSection(idx: number) {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, collapsed: !s.collapsed } : s))
  }

  function switchToRaw() {
    setPrompt(viewMode === 'sections' ? assemblePrompt(sections) : prompt)
    setViewMode('raw')
  }

  function switchToSections() {
    setViewMode('sections')
  }

  // The assembled prompt used for display stats (excludes greeting)
  const displayPrompt = viewMode === 'sections' ? assemblePrompt(sections) : prompt
  const charCount = displayPrompt.length
  const lineCount = displayPrompt.split('\n').length

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft size={18} />
          </Link>
          <div>
            <h1 className="text-base font-bold text-gray-900">{t('prompt_editor.title')}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.has_file ? t('prompt_editor.subtitle_pdf') : t('prompt_editor.subtitle_docx')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {genState === 'saved' && (
            <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
              <CheckCircle2 size={13} /> {t('common.saved')}
            </span>
          )}
          {(genState === 'done' || genState === 'saved') && (
            <>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-medium transition-colors"
              >
                <RefreshCw size={12} /> {t('prompt_editor.btn_regenerate')}
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <Save size={12} /> {t('prompt_editor.btn_save')}
              </button>
              <button
                onClick={() => setShowSim(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-medium transition-colors"
              >
                <MessageSquare size={12} /> {t('prompt_editor.btn_simulation')}
              </button>
            </>
          )}
          {(genState === 'idle' || genState === 'error') && (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <Sparkles size={14} /> {t('prompt_editor.btn_generate')}
            </button>
          )}
          {genState === 'generating' && (
            <button
              onClick={() => { abortRef.current?.abort(); setGenState('error') }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
            >
              {t('prompt_editor.btn_stop')}
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 px-6 py-2.5 bg-red-50 border-b border-red-100 text-red-700 text-sm">
          <AlertCircle size={14} />
          {errorMsg}
        </div>
      )}

      {/* Body: three columns */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: questionnaire preview */}
        <div className="w-[28%] border-r border-gray-100 flex flex-col overflow-hidden bg-white">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
            <FileText size={13} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('prompt_editor.section_questionnaire')}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-gray-400 text-sm">{t('common.loading')}</div>
            ) : data?.questionnaire_raw ? (
              <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                {data.questionnaire_raw}
              </pre>
            ) : data?.has_file ? (
              <div className="text-center py-12 text-gray-400">
                <FileText size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm">{t('prompt_editor.pdf_note')}</p>
                <p className="text-xs mt-1">{t('prompt_editor.pdf_direct')}</p>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <p className="text-sm">{t('prompt_editor.no_file')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Center: prompt editor */}
        <div className="flex-1 border-r border-gray-100 flex flex-col overflow-hidden bg-white">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-indigo-500" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('prompt_editor.section_prompt')}</span>
            </div>
            <div className="flex items-center gap-3">
              {displayPrompt && (
                <span className="text-[10px] text-gray-400">
                  {lineCount}{t('prompt_editor.lines')} · {charCount.toLocaleString()}{t('prompt_editor.chars')}
                </span>
              )}
              {(genState === 'done' || genState === 'saved') && sections.length > 0 && (
                <div className="flex items-center bg-gray-100 rounded-md p-0.5">
                  <button
                    onClick={switchToSections}
                    title={t('prompt_editor.view_sections')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                      viewMode === 'sections' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <LayoutList size={11} /> {t('prompt_editor.view_sections')}
                  </button>
                  <button
                    onClick={switchToRaw}
                    title={t('prompt_editor.view_raw')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                      viewMode === 'raw' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <AlignJustify size={11} /> {t('prompt_editor.view_raw')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Generation progress */}
          {genState === 'generating' && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-500">
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="ml-2 text-sm font-medium">{t('prompt_editor.generating')}</span>
              </div>
              <div className="flex flex-col items-center gap-1 text-xs text-gray-400">
                <span className="font-mono text-lg font-semibold text-gray-600">
                  {byteCount.toLocaleString()}
                </span>
                <span>{t('prompt_editor.bytes_received')}</span>
              </div>
            </div>
          )}

          {/* Sections view */}
          {genState !== 'generating' && viewMode === 'sections' && sections.length > 0 && (
            <div className="flex-1 overflow-y-auto">
              {sections.map((section, idx) => {
                const c = SECTION_COLORS[section.key] ?? SECTION_COLORS['data_mapping']
                const isGreeting = section.key === GREETING_KEY
                const isFailureMsg = section.key === FAILURE_MESSAGE_KEY
                const isSpecial = isGreeting || isFailureMsg
                const rowCount = Math.min(40, Math.max(3, section.content.split('\n').length + 1))
                const labelKey = SECTION_LABEL_KEYS[section.key]
                const label = labelKey ? t(labelKey) : section.key
                return (
                  <div key={section.key} className={cn('border-b', c.border)}>
                    <button
                      onClick={() => toggleSection(idx)}
                      className={cn('w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors', c.header)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', c.badge)}>
                          {isGreeting
                            ? <Mic size={10} className="inline" />
                            : isFailureMsg
                              ? <VolumeX size={10} className="inline" />
                              : idx}
                        </span>
                        <span className="text-xs font-semibold text-gray-700">
                          {label}
                        </span>
                        {isGreeting && (
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            {t('prompt_editor.greeting_badge')}
                          </span>
                        )}
                        {isFailureMsg && (
                          <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                            {t('prompt_editor.failure_message_badge')}
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        size={13}
                        className={cn('text-gray-400 transition-transform flex-shrink-0', section.collapsed && '-rotate-90')}
                      />
                    </button>
                    {!section.collapsed && (
                      <div className="px-4 pb-4 pt-2 bg-white">
                        <textarea
                          value={section.content}
                          onChange={e => handleSectionChange(idx, e.target.value)}
                          rows={isSpecial ? Math.min(6, Math.max(2, section.content.split('\n').length + 1)) : rowCount}
                          spellCheck={false}
                          className="w-full resize-none p-3 font-mono text-xs text-gray-700 leading-relaxed focus:outline-none bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Raw view */}
          {genState !== 'generating' && viewMode === 'raw' && (
            <div className="flex-1 relative overflow-hidden">
              {genState === 'idle' && !prompt && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 pointer-events-none">
                  <div className="text-center">
                    <Sparkles size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{t('prompt_editor.placeholder_generate')}</p>
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder=""
                className="w-full h-full resize-none p-4 bg-gray-50 border border-gray-200 rounded-lg font-mono text-xs text-gray-700 leading-relaxed focus:outline-none"
                spellCheck={false}
              />
            </div>
          )}

          {(genState === 'done' || genState === 'saved') && (
            <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border-t border-indigo-100">
              <p className="text-xs text-indigo-600">{t('prompt_editor.save_hint')}</p>
              <Link
                to={`/surveys/${id}/quotas`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                {t('prompt_editor.to_quota')}
              </Link>
            </div>
          )}
        </div>

        {/* Right: Structured Output Schema */}
        <div className="w-[28%] flex flex-col overflow-hidden bg-white">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={13} className="text-emerald-600" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('prompt_editor.section_schema')}</span>
            </div>
            <div className="flex items-center gap-2">
              {schemaSaved && (
                <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-medium">
                  <CheckCircle2 size={11} /> {t('common.saved')}
                </span>
              )}
              {schema && (
                <button
                  onClick={handleVarAdd}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded text-[10px] font-medium transition-colors"
                >
                  <Plus size={10} /> {t('prompt_editor.btn_add_var')}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {schemaExtracting && !schema && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Loader2 size={24} className="animate-spin mb-2 text-emerald-500" />
                <p className="text-xs">{t('prompt_editor.schema_extracting')}</p>
                <p className="text-[10px] mt-1 text-gray-300">{t('prompt_editor.schema_extracting_sub')}</p>
              </div>
            )}

            {!schemaExtracting && !schema && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300">
                <Database size={32} className="mb-3 opacity-40" />
                <p className="text-xs">{t('prompt_editor.schema_placeholder')}</p>
              </div>
            )}

            {schema && !editingVar && (
              <div className="p-3 space-y-2">
                {Object.entries(schema).map(([key, variable]) => (
                  <div key={key} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                            {key}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">{variable.type}</span>
                        </div>
                        <p className="text-xs text-gray-600 truncate">{variable.description}</p>
                        {Object.keys(variable.codes).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {Object.entries(variable.codes).map(([code, label]) => (
                              <span key={code} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                {code}={label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => setEditingVar({ key, original: key, value: { ...variable, codes: { ...variable.codes } } })}
                          className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => handleVarDelete(key)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editingVar && (
              <VarEditor
                editing={editingVar}
                onChange={setEditingVar}
                onSave={handleVarSave}
                onCancel={() => setEditingVar(null)}
              />
            )}
          </div>
        </div>
      </div>
      {showSim && <SimulationModal surveyId={id!} greeting={data?.voice_agent_greeting ?? null} failureMessage={data?.voice_agent_failure_message ?? null} onClose={() => setShowSim(false)} />}
    </div>
  )
}

// ── Simulation Modal ──────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const CALL_TRIGGER = '(통화 연결됨 - 응답자가 전화를 받았습니다)'

function SimulationModal({ surveyId, greeting, failureMessage, onClose }: { surveyId: string; greeting: string | null; failureMessage: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const initialMsgs: ChatMessage[] = greeting?.trim()
    ? [{ role: 'assistant', content: greeting.trim() }]
    : []
  const [messages, setMessages] = useState<ChatMessage[]>(initialMsgs)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function callAI(visibleMsgs: ChatMessage[]) {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Simulation always uses the assembled system prompt (stored in DB voice_agent_prompt).
    // If greeting exists: inject as first assistant turn, then skip the greeting entry
    // that's already at the front of visibleMsgs (state is initialised with it).
    const hasGreeting = !!greeting?.trim()
    const apiMessages: ChatMessage[] = [
      { role: 'user', content: CALL_TRIGGER },
      ...(hasGreeting ? [{ role: 'assistant' as const, content: greeting!.trim() }] : []),
      ...(hasGreeting ? visibleMsgs.slice(1) : visibleMsgs),
    ]

    setStreaming(true)
    setMessages([...visibleMsgs, { role: 'assistant', content: '' }])

    try {
      const resp = await authFetch(`${API}/api/surveys/${surveyId}/voice-prompt/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: ctrl.signal,
      })
      if (!resp.ok) throw new Error(t('common.server_error'))

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        const t2 = text
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: t2 }
          return updated
        })
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setMessages(prev => {
        const updated = [...prev]
        if (updated.length > 0 && updated[updated.length - 1].content === '') {
          updated[updated.length - 1] = { role: 'assistant', content: t('simulation.error') }
        }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }

  function handleSend() {
    if (!input.trim() || streaming) return
    const userMsg: ChatMessage = { role: 'user', content: input.trim() }
    const withUser = [...messages, userMsg]
    setMessages(withUser)
    setInput('')
    callAI(withUser)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl h-[78vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center">
              <MessageSquare size={13} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{t('simulation.title')}</p>
              <p className="text-[10px] text-gray-400">{t('simulation.subtitle')}</p>
              {failureMessage && (
                <p className="text-[10px] text-red-500 mt-0.5 flex items-center gap-1">
                  <VolumeX size={9} className="inline flex-shrink-0" />
                  {failureMessage}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50">
          {messages.map((msg, i) => (
            <div key={i} className={cn('flex items-end gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Bot size={13} className="text-indigo-600" />
                </div>
              )}
              <div className={cn(
                'max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white text-gray-900 border border-gray-100 rounded-bl-sm',
              )}>
                {msg.content === '' ? (
                  <span className="inline-flex items-center gap-1 py-0.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                ) : msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <User size={13} className="text-gray-500" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0 bg-white">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={streaming}
              placeholder={streaming ? t('simulation.placeholder_waiting') : t('simulation.placeholder')}
              className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 transition-all"
              autoFocus
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              className="w-10 h-10 flex items-center justify-center bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 pl-1">{t('simulation.hint')}</p>
        </div>
      </div>
    </div>
  )
}

// ── Variable inline editor ────────────────────────────────────────────────────
function VarEditor({
  editing, onChange, onSave, onCancel,
}: {
  editing: EditingVar
  onChange: (v: EditingVar) => void
  onSave: (v: EditingVar) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [newCodeKey, setNewCodeKey] = useState('')
  const [newCodeVal, setNewCodeVal] = useState('')

  function addCode() {
    if (!newCodeKey.trim()) return
    onChange({ ...editing, value: { ...editing.value, codes: { ...editing.value.codes, [newCodeKey.trim()]: newCodeVal.trim() } } })
    setNewCodeKey(''); setNewCodeVal('')
  }

  function removeCode(k: string) {
    const codes = { ...editing.value.codes }
    delete codes[k]
    onChange({ ...editing, value: { ...editing.value, codes } })
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">{t('prompt_editor.var_editor_title')}</span>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-400 mb-1">{t('prompt_editor.label_var_name')}</label>
        <input value={editing.key} onChange={e => onChange({ ...editing, key: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Q1" />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-400 mb-1">{t('prompt_editor.label_type')}</label>
        <select value={editing.value.type} onChange={e => onChange({ ...editing, value: { ...editing.value, type: e.target.value } })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option value="integer|null">integer|null</option>
          <option value="boolean|null">boolean|null</option>
          <option value="boolean">boolean</option>
          <option value="string|null">string|null</option>
          <option value="integer">integer</option>
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-400 mb-1">{t('prompt_editor.label_desc')}</label>
        <input value={editing.value.description} onChange={e => onChange({ ...editing, value: { ...editing.value, description: e.target.value } })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder={t('prompt_editor.placeholder_desc')} />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-gray-400 mb-1">{t('prompt_editor.label_codes')}</label>
        <div className="space-y-1 mb-2">
          {Object.entries(editing.value.codes).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 w-8 text-center">{k}</span>
              <span className="text-[10px] text-gray-600 flex-1">{v}</span>
              <button onClick={() => removeCode(k)} className="text-gray-300 hover:text-red-400"><X size={10} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          <input value={newCodeKey} onChange={e => setNewCodeKey(e.target.value)} placeholder={t('prompt_editor.placeholder_code')}
            className="w-12 border border-gray-200 rounded px-1.5 py-1 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onKeyDown={e => e.key === 'Enter' && addCode()} />
          <input value={newCodeVal} onChange={e => setNewCodeVal(e.target.value)} placeholder={t('prompt_editor.placeholder_label')}
            className="flex-1 border border-gray-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onKeyDown={e => e.key === 'Enter' && addCode()} />
          <button onClick={addCode} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-[10px] hover:bg-gray-200">+</button>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-1.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded text-xs">
          {t('common.cancel')}
        </button>
        <button onClick={() => onSave(editing)} disabled={!editing.key.trim()}
          className="flex-1 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-40">
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
