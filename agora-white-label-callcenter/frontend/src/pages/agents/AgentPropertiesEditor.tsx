import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  SECTIONS,
  applySimpleFieldsToSections,
  extractSimpleFieldsFromSections,
  type EditorMode,
  type JsonSectionErrors,
  type JsonSections,
  type SectionKey,
  type SimpleAgentFields,
  type VoiceOption,
} from './agentProperties'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

export function JsonPropsEditor({
  sections,
  errors,
  onChange,
}: {
  sections: JsonSections
  errors: JsonSectionErrors
  onChange: (key: SectionKey, value: string) => void
}) {
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    llm: true, tts: true, asr: false, parameters: false, turn_detection: false, advanced_features: false,
  })
  const toggle = (k: SectionKey) => setOpen(o => ({ ...o, [k]: !o[k] }))

  return (
    <div className="space-y-3">
      {SECTIONS.map(({ key, label, border, rows }) => (
        <div key={key} className={cn('rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden border-l-4', border)}>
          <button
            type="button"
            onClick={() => toggle(key)}
            className="w-full flex items-center justify-between px-3.5 py-3 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{label}</span>
              {errors[key] && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                  Invalid JSON
                </span>
              )}
            </div>
            {open[key]
              ? <ChevronDown size={16} className="text-gray-400 shrink-0" />
              : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
          </button>
          {open[key] && (
            <div className="px-3.5 pb-3.5 border-t border-gray-100">
              <textarea
                value={sections[key]}
                onChange={e => onChange(key, e.target.value)}
                rows={rows}
                spellCheck={false}
                className={cn(
                  'w-full mt-3 font-mono text-xs border rounded-lg px-3 py-2.5 resize-y focus:outline-none focus:ring-2 focus:border-transparent bg-gray-50 leading-relaxed',
                  errors[key]
                    ? 'border-red-300 focus:ring-red-500'
                    : 'border-gray-200 focus:ring-indigo-500',
                )}
              />
              {errors[key] && (
                <p className="mt-1 text-xs text-red-600">{errors[key]}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: EditorMode
  onChange: (mode: EditorMode) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {(['ui', 'json'] as EditorMode[]).map(m => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
            mode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800',
          )}
        >
          {m === 'ui' ? t('agents.mode_ui') : t('agents.mode_json')}
        </button>
      ))}
    </div>
  )
}

function voiceLabel(v: VoiceOption): string {
  const bits = [v.name, v.language, v.gender, v.age].filter(Boolean)
  return `${bits.join(' · ')}`
}

function VoicePickerDialog({
  voices,
  loading,
  error,
  currentVoiceId,
  onSave,
  onClose,
}: {
  voices: VoiceOption[]
  loading: boolean
  error: string
  currentVoiceId: string
  onSave: (voiceId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const current = voices.find(v => v.voice_id === currentVoiceId)
  const [draftId, setDraftId] = useState(currentVoiceId)
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState(current?.language ?? '')
  const [gender, setGender] = useState('')

  const languages = useMemo(
    () => Array.from(new Set(voices.map(v => v.language).filter(Boolean))).sort(),
    [voices],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return voices.filter(v => {
      if (language && v.language !== language) return false
      if (gender && (v.gender || '') !== gender) return false
      if (!q) return true
      return (
        v.name.toLowerCase().includes(q)
        || v.voice_id.toLowerCase().includes(q)
        || (v.age || '').toLowerCase().includes(q)
      )
    })
  }, [voices, query, language, gender])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-semibold text-gray-900">{t('agents.voice_picker_title')}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('agents.voice_all_languages')}</option>
            {languages.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <select
            value={gender}
            onChange={e => setGender(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('agents.voice_all_genders')}</option>
            <option value="Female">{t('agents.voice_female')}</option>
            <option value="Male">{t('agents.voice_male')}</option>
          </select>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('agents.voice_search')}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-[240px]">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" />
              {t('common.loading')}
            </div>
          )}
          {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="px-5 py-10 text-sm text-gray-400 text-center">{t('agents.voice_empty')}</p>
          )}
          {!loading && filtered.map(v => {
            const selected = v.voice_id === draftId
            return (
              <button
                key={v.voice_id}
                type="button"
                onClick={() => setDraftId(v.voice_id)}
                className={cn(
                  'w-full text-left px-5 py-2.5 border-b border-gray-50 flex items-start gap-3 transition-colors',
                  selected ? 'bg-indigo-50' : 'hover:bg-gray-50',
                )}
              >
                <span className={cn(
                  'mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center',
                  selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300',
                )}>
                  {selected && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-sm font-medium', selected ? 'text-indigo-900' : 'text-gray-900')}>
                      {v.name}
                    </span>
                    {v.language && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{v.language}</span>
                    )}
                    {v.gender && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{v.gender}</span>
                    )}
                    {v.age && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{v.age}</span>
                    )}
                  </span>
                  <span className="block text-[11px] font-mono text-gray-400 mt-0.5 truncate">{v.voice_id}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            {t('agents.voice_picker_count', { n: filtered.length })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {t('agents.voice_picker_close')}
            </button>
            <button
              type="button"
              onClick={() => onSave(draftId)}
              disabled={!draftId}
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {t('agents.voice_picker_save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SimpleAgentForm({
  fields,
  onChange,
}: {
  fields: SimpleAgentFields
  onChange: (fields: SimpleAgentFields) => void
}) {
  const { t } = useTranslation()
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesError, setVoicesError] = useState('')
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setVoicesLoading(true)
    fetch(`${API}/api/voices`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText)
        return r.json()
      })
      .then((data: VoiceOption[]) => {
        if (!cancelled) setVoices(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setVoicesError(t('agents.voice_load_error'))
      })
      .finally(() => {
        if (!cancelled) setVoicesLoading(false)
      })
    return () => { cancelled = true }
  }, [t])

  const currentVoice = voices.find(v => v.voice_id === fields.voiceId)
  const currentSummary = currentVoice
    ? voiceLabel(currentVoice)
    : (fields.voiceId || t('agents.voice_unset'))

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('agents.prompt')}</label>
        <textarea
          value={fields.prompt}
          onChange={e => onChange({ ...fields, prompt: e.target.value })}
          rows={10}
          spellCheck={false}
          placeholder={t('agents.ph_prompt')}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white resize-y"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('agents.greeting')}</label>
        <textarea
          value={fields.greeting}
          onChange={e => onChange({ ...fields, greeting: e.target.value })}
          rows={3}
          placeholder={t('agents.ph_greeting')}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white resize-y"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('agents.voice')}</label>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 h-[38px] border border-gray-200 rounded-lg px-3 bg-gray-50 flex items-center gap-2">
            <p className="text-sm text-gray-900 truncate">{currentSummary}</p>
            {currentVoice && (
              <p className="text-[11px] font-mono text-gray-400 truncate ml-auto max-w-[45%]">{currentVoice.voice_id}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex-shrink-0 h-[38px] px-3 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
          >
            {t('agents.voice_change')}
          </button>
        </div>
        {voicesError && <p className="mt-1 text-xs text-red-600">{voicesError}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600">{t('agents.volume')}</label>
            <span className="text-xs font-mono text-gray-500">{fields.volume.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={fields.volume}
            onChange={e => onChange({ ...fields, volume: Number(e.target.value) })}
            className="w-full accent-indigo-600"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">{t('agents.volume_hint')}</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600">{t('agents.speed')}</label>
            <span className="text-xs font-mono text-gray-500">{fields.speed.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={fields.speed}
            onChange={e => onChange({ ...fields, speed: Number(e.target.value) })}
            className="w-full accent-indigo-600"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">{t('agents.speed_hint')}</p>
        </div>
      </div>

      {pickerOpen && (
        <VoicePickerDialog
          voices={voices}
          loading={voicesLoading}
          error={voicesError}
          currentVoiceId={fields.voiceId}
          onSave={voiceId => {
            onChange({ ...fields, voiceId })
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export function AgentPropertiesEditor({
  mode,
  onModeChange,
  sections,
  errors,
  onSectionChange,
  onReplaceSections,
  simple,
  onSimpleChange,
}: {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  sections: JsonSections
  errors: JsonSectionErrors
  onSectionChange: (key: SectionKey, value: string) => void
  onReplaceSections: (sections: JsonSections) => void
  simple: SimpleAgentFields
  onSimpleChange: (fields: SimpleAgentFields) => void
}) {
  function handleModeChange(next: EditorMode) {
    if (next === mode) return
    if (next === 'json') {
      onReplaceSections(applySimpleFieldsToSections(sections, simple))
    } else {
      onSimpleChange(extractSimpleFieldsFromSections(sections, simple))
    }
    onModeChange(next)
  }

  function handleSimpleChange(fields: SimpleAgentFields) {
    onSimpleChange(fields)
    onReplaceSections(applySimpleFieldsToSections(sections, fields))
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <ModeToggle mode={mode} onChange={handleModeChange} />
      </div>
      {mode === 'ui' ? (
        <SimpleAgentForm fields={simple} onChange={handleSimpleChange} />
      ) : (
        <JsonPropsEditor
          sections={sections}
          errors={errors}
          onChange={onSectionChange}
        />
      )}
    </div>
  )
}
