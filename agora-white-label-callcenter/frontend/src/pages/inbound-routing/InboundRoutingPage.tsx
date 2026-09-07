import { authFetch } from '../../lib/api'
import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, PhoneIncoming, Link2, Link2Off, Plus, Trash2, X, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '../../lib/utils'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhoneEntry {
  number_id: string
  name: string
  phone_number: string
  type: string
  binding: BindingData | null
}

interface BindingData {
  agent_id?: string
  end_call_config?: EndCallConfig
  structured_output?: StructuredOutputConfig
  transfer_config?: TransferConfig
  enable_transcript?: boolean
  enable_recording?: boolean
}

interface EndCallConfig {
  max_call_duration_seconds: number
  silence_timeout_seconds: number
  end_call_on_silence_timeout: boolean
  ring_timeout_seconds: number
  end_call_on_voicemail: boolean
  end_call_on_user_request: boolean
  end_call_on_ai_assistant: boolean
}

interface CustomEvaluation {
  variable_name: string
  type: 'number' | 'boolean' | 'string'
  criteria: string
  enums: string[]
}

interface StructuredOutputConfig {
  enable_structured_output: boolean
  call_success_evaluation: { criteria: string }
  custom_evaluations: CustomEvaluation[]
}

interface TransferConfig {
  enabled: boolean
  phone_number: string
  description: string
}

interface BindingForm {
  agent_id: string
  end_call_config: EndCallConfig
  structured_output: StructuredOutputConfig
  transfer_config: TransferConfig
  enable_transcript: boolean
  enable_recording: boolean
}

interface Agent {
  agent_id: string
  agent_name: string
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const defaultForm = (): BindingForm => ({
  agent_id: '',
  end_call_config: {
    max_call_duration_seconds: 600,
    silence_timeout_seconds: 120,
    end_call_on_silence_timeout: true,
    ring_timeout_seconds: 45,
    end_call_on_voicemail: true,
    end_call_on_user_request: true,
    end_call_on_ai_assistant: true,
  },
  structured_output: {
    enable_structured_output: true,
    call_success_evaluation: { criteria: '' },
    custom_evaluations: [],
  },
  transfer_config: {
    enabled: false,
    phone_number: '',
    description: '',
  },
  enable_transcript: true,
  enable_recording: true,
})

function formFromBinding(b: BindingData): BindingForm {
  const def = defaultForm()
  return {
    agent_id: b.agent_id ?? '',
    end_call_config: { ...def.end_call_config, ...(b.end_call_config ?? {}) },
    structured_output: {
      enable_structured_output: b.structured_output?.enable_structured_output ?? true,
      call_success_evaluation: {
        criteria: b.structured_output?.call_success_evaluation?.criteria ?? '',
      },
      custom_evaluations: (b.structured_output?.custom_evaluations ?? []).map(e => ({
        variable_name: e.variable_name,
        type: e.type as 'number' | 'boolean' | 'string',
        criteria: e.criteria,
        enums: e.enums ?? [],
      })),
    },
    transfer_config: { ...def.transfer_config, ...(b.transfer_config ?? {}) },
    enable_transcript: b.enable_transcript ?? true,
    enable_recording: b.enable_recording ?? true,
  }
}

// ─── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({
  title, open, onToggle,
}: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-700 border-b border-gray-100 hover:text-gray-900 transition-colors"
    >
      {title}
      {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
    </button>
  )
}

// ─── Toggle Field ──────────────────────────────────────────────────────────────

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer select-none">
      <span className="text-sm text-gray-600">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
          checked ? 'bg-indigo-600' : 'bg-gray-200',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function InboundRoutingPage() {
  const [entries, setEntries] = useState<PhoneEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [agents, setAgents] = useState<Agent[]>([])

  // Modal state
  const [modalEntry, setModalEntry] = useState<PhoneEntry | null>(null)
  const [form, setForm] = useState<BindingForm>(defaultForm())
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // Section open/close
  const [openSections, setOpenSections] = useState({
    basic: true, endCall: true, structured: true, transfer: false,
  })

  const [unbindingId, setUnbindingId] = useState<string | null>(null)

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections(s => ({ ...s, [key]: !s[key] }))

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [routingData, agentsData] = await Promise.all([
        authFetch(`${API}/api/inbound-routing`).then(r => r.json()),
        authFetch(`${API}/api/agents`).then(r => r.json()),
      ])
      setEntries(Array.isArray(routingData) ? routingData : [])
      setAgents(Array.isArray(agentsData) ? agentsData : [])
    } catch {
      setError('Failed to load data. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function openBind(entry: PhoneEntry) {
    setFormError('')
    setForm(entry.binding ? formFromBinding(entry.binding) : defaultForm())
    setModalEntry(entry)
    setOpenSections({ basic: true, endCall: true, structured: true, transfer: false })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!modalEntry) return
    if (!form.agent_id) { setFormError('Please select an agent.'); return }
    setFormError('')
    setSubmitting(true)
    try {
      const resp = await authFetch(`${API}/api/inbound-routing/${modalEntry.number_id}/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail ?? 'Request failed')
      }
      // Refresh the entry binding
      await loadData()
      setModalEntry(null)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUnbind(numberId: string) {
    if (!confirm('Remove agent binding from this phone number?')) return
    setUnbindingId(numberId)
    try {
      const resp = await authFetch(`${API}/api/inbound-routing/${numberId}/bind`, { method: 'DELETE' })
      if (!resp.ok) throw new Error()
      setEntries(prev => prev.map(e =>
        e.number_id === numberId ? { ...e, binding: null } : e,
      ))
    } catch {
      alert('Failed to remove binding.')
    } finally {
      setUnbindingId(null)
    }
  }

  // ── Custom Evaluations helpers ──────────────────────────────────────────────

  function addEvaluation() {
    setForm(f => ({
      ...f,
      structured_output: {
        ...f.structured_output,
        custom_evaluations: [
          ...f.structured_output.custom_evaluations,
          { variable_name: '', type: 'string', criteria: '', enums: [] },
        ],
      },
    }))
  }

  function removeEvaluation(idx: number) {
    setForm(f => ({
      ...f,
      structured_output: {
        ...f.structured_output,
        custom_evaluations: f.structured_output.custom_evaluations.filter((_, i) => i !== idx),
      },
    }))
  }

  function updateEvaluation(idx: number, patch: Partial<CustomEvaluation>) {
    setForm(f => ({
      ...f,
      structured_output: {
        ...f.structured_output,
        custom_evaluations: f.structured_output.custom_evaluations.map((e, i) =>
          i === idx ? { ...e, ...patch } : e,
        ),
      },
    }))
  }

  function updateEndCall<K extends keyof EndCallConfig>(key: K, value: EndCallConfig[K]) {
    setForm(f => ({ ...f, end_call_config: { ...f.end_call_config, [key]: value } }))
  }

  function agentName(id: string) {
    return agents.find(a => a.agent_id === id)?.agent_name ?? id
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 bg-gray-50 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inbound Routing</h1>
          <p className="text-sm text-gray-600 mt-0.5">Bind phone numbers to AI agents for inbound call handling</p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <PhoneIncoming size={14} />}
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">{error}</div>
      )}

      {!loading && !error && (
        <>
          {entries.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-12 text-center text-gray-400">
              <PhoneIncoming size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No phone numbers found.</p>
              <p className="text-xs mt-1">Add phone numbers in the Phone Numbers section first.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Number ID</th>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Phone Number</th>
                    <th className="text-left px-4 py-3">Bound Agent</th>
                    <th className="text-left px-4 py-3">Transcript</th>
                    <th className="text-left px-4 py-3">Recording</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map(entry => (
                    <tr key={entry.number_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{entry.number_id}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{entry.name}</td>
                      <td className="px-4 py-3 font-mono text-gray-600">{entry.phone_number}</td>
                      <td className="px-4 py-3">
                        {entry.binding?.agent_id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
                              <Link2 size={10} />
                              {agentName(entry.binding.agent_id)}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                            <Link2Off size={10} />
                            Unbound
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {entry.binding ? (entry.binding.enable_transcript ? '✓' : '✗') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {entry.binding ? (entry.binding.enable_recording ? '✓' : '✗') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openBind(entry)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            {entry.binding ? (
                              <><Link2 size={12} /> Edit Binding</>
                            ) : (
                              <><Link2 size={12} /> Bind Agent</>
                            )}
                          </button>
                          {entry.binding && (
                            <button
                              onClick={() => handleUnbind(entry.number_id)}
                              disabled={unbindingId === entry.number_id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-40"
                            >
                              {unbindingId === entry.number_id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Link2Off size={12} />
                              }
                              Unbind
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Binding Modal */}
      {modalEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-lg w-full max-w-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">
                  {modalEntry.binding ? 'Edit Binding' : 'Bind Agent'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {modalEntry.name} · {modalEntry.phone_number}
                </p>
              </div>
              <button
                onClick={() => setModalEntry(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                {/* ── Basic ─────────────────────────────────────────────── */}
                <div>
                  <SectionHeader
                    title="Basic Settings"
                    open={openSections.basic}
                    onToggle={() => toggleSection('basic')}
                  />
                  {openSections.basic && (
                    <div className="pt-3 space-y-3">
                      {/* Agent */}
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">
                          Agent <span className="text-red-600">*</span>
                        </label>
                        <select
                          value={form.agent_id}
                          onChange={e => setForm(f => ({ ...f, agent_id: e.target.value }))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                        >
                          <option value="">— Select an agent —</option>
                          {agents.map(a => (
                            <option key={a.agent_id} value={a.agent_id}>{a.agent_name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Enable Transcript / Recording */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                          <Toggle
                            label="Enable Transcript"
                            checked={form.enable_transcript}
                            onChange={v => setForm(f => ({ ...f, enable_transcript: v }))}
                          />
                        </div>
                        <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                          <Toggle
                            label="Enable Recording"
                            checked={form.enable_recording}
                            onChange={v => setForm(f => ({ ...f, enable_recording: v }))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── End Call Config ────────────────────────────────────── */}
                <div>
                  <SectionHeader
                    title="End Call Configuration"
                    open={openSections.endCall}
                    onToggle={() => toggleSection('endCall')}
                  />
                  {openSections.endCall && (
                    <div className="pt-3 space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1">Max Duration (s)</label>
                          <input
                            type="number" min={0}
                            value={form.end_call_config.max_call_duration_seconds}
                            onChange={e => updateEndCall('max_call_duration_seconds', Number(e.target.value))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1">Silence Timeout (s)</label>
                          <input
                            type="number" min={0}
                            value={form.end_call_config.silence_timeout_seconds}
                            onChange={e => updateEndCall('silence_timeout_seconds', Number(e.target.value))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1">Ring Timeout (s)</label>
                          <input
                            type="number" min={0}
                            value={form.end_call_config.ring_timeout_seconds}
                            onChange={e => updateEndCall('ring_timeout_seconds', Number(e.target.value))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ['end_call_on_silence_timeout', 'End on Silence Timeout'],
                          ['end_call_on_voicemail', 'End on Voicemail'],
                          ['end_call_on_user_request', 'End on User Request'],
                          ['end_call_on_ai_assistant', 'End on AI Decision'],
                        ] as [keyof EndCallConfig, string][]).map(([key, label]) => (
                          <div key={key} className="bg-gray-50 rounded-lg px-3 py-2.5">
                            <Toggle
                              label={label}
                              checked={form.end_call_config[key] as boolean}
                              onChange={v => updateEndCall(key, v as EndCallConfig[typeof key])}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Structured Output ──────────────────────────────────── */}
                <div>
                  <SectionHeader
                    title="Structured Output"
                    open={openSections.structured}
                    onToggle={() => toggleSection('structured')}
                  />
                  {openSections.structured && (
                    <div className="pt-3 space-y-3">
                      <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                        <Toggle
                          label="Enable Structured Output"
                          checked={form.structured_output.enable_structured_output}
                          onChange={v => setForm(f => ({
                            ...f,
                            structured_output: { ...f.structured_output, enable_structured_output: v },
                          }))}
                        />
                      </div>

                      {form.structured_output.enable_structured_output && (
                        <>
                          {/* Call Success Criteria */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Call Success Criteria
                            </label>
                            <input
                              type="text"
                              value={form.structured_output.call_success_evaluation.criteria}
                              onChange={e => setForm(f => ({
                                ...f,
                                structured_output: {
                                  ...f.structured_output,
                                  call_success_evaluation: { criteria: e.target.value },
                                },
                              }))}
                              placeholder="e.g. Call has been answered"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                            />
                          </div>

                          {/* Custom Evaluations */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-medium text-gray-400">Custom Evaluations</label>
                              <button
                                type="button"
                                onClick={addEvaluation}
                                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                              >
                                <Plus size={12} /> Add
                              </button>
                            </div>

                            {form.structured_output.custom_evaluations.length === 0 && (
                              <p className="text-xs text-gray-400 italic">No custom evaluations yet.</p>
                            )}

                            <div className="space-y-3">
                              {form.structured_output.custom_evaluations.map((ev, idx) => (
                                <div
                                  key={idx}
                                  className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-400">Evaluation #{idx + 1}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeEvaluation(idx)}
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs text-gray-400 mb-1">Variable Name</label>
                                      <input
                                        type="text"
                                        value={ev.variable_name}
                                        onChange={e => updateEvaluation(idx, { variable_name: e.target.value })}
                                        placeholder="Q1"
                                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-400 mb-1">Type</label>
                                      <select
                                        value={ev.type}
                                        onChange={e => updateEvaluation(idx, {
                                          type: e.target.value as 'number' | 'boolean' | 'string',
                                          enums: e.target.value !== 'string' ? [] : ev.enums,
                                        })}
                                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                                      >
                                        <option value="string">string</option>
                                        <option value="number">number</option>
                                        <option value="boolean">boolean</option>
                                      </select>
                                    </div>
                                  </div>

                                  <div>
                                    <label className="block text-xs text-gray-400 mb-1">Criteria</label>
                                    <input
                                      type="text"
                                      value={ev.criteria}
                                      onChange={e => updateEvaluation(idx, { criteria: e.target.value })}
                                      placeholder="e.g. User's age"
                                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                                    />
                                  </div>

                                  {ev.type === 'string' && (
                                    <div>
                                      <label className="block text-xs text-gray-400 mb-1">
                                        Enum Values <span className="text-gray-400">(comma-separated)</span>
                                      </label>
                                      <input
                                        type="text"
                                        value={ev.enums.join(', ')}
                                        onChange={e => updateEvaluation(idx, {
                                          enums: e.target.value
                                            .split(',')
                                            .map(s => s.trim())
                                            .filter(Boolean),
                                        })}
                                        placeholder="Toyota, Honda, BYD"
                                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Transfer Config ────────────────────────────────────── */}
                <div>
                  <SectionHeader
                    title="Call Transfer"
                    open={openSections.transfer}
                    onToggle={() => toggleSection('transfer')}
                  />
                  {openSections.transfer && (
                    <div className="pt-3 space-y-3">
                      <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                        <Toggle
                          label="Enable Transfer"
                          checked={form.transfer_config.enabled}
                          onChange={v => setForm(f => ({
                            ...f,
                            transfer_config: { ...f.transfer_config, enabled: v },
                          }))}
                        />
                      </div>

                      {form.transfer_config.enabled && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Transfer Phone Number</label>
                            <input
                              type="text"
                              value={form.transfer_config.phone_number}
                              onChange={e => setForm(f => ({
                                ...f,
                                transfer_config: { ...f.transfer_config, phone_number: e.target.value },
                              }))}
                              placeholder="+18860027209"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Transfer Trigger Description</label>
                            <input
                              type="text"
                              value={form.transfer_config.description}
                              onChange={e => setForm(f => ({
                                ...f,
                                transfer_config: { ...f.transfer_config, description: e.target.value },
                              }))}
                              placeholder="e.g. when user wants to talk to a human agent"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

              </div>

              {/* Modal Footer */}
              <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 space-y-3">
                {formError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {formError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModalEntry(null)}
                    className="px-4 py-2 text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
                      submitting ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700',
                    )}
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {submitting ? 'Saving…' : (modalEntry.binding ? 'Update Binding' : 'Bind Agent')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
