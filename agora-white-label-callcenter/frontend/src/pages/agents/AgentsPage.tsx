import { authFetch } from '../../lib/api'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2, PlusCircle, Trash2, Bot, X, Pencil,
  FileText, MessageCircle, Radio,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { bcp47ForI18n } from '../../i18n'
import AgoraRTC from 'agora-rtc-sdk-ng'
import AgoraRTM from 'agora-rtm-sdk'
import { AgentPropertiesEditor } from './AgentPropertiesEditor'
import {
  DEFAULT_SIMPLE_FIELDS,
  extractSections,
  extractSimpleFieldsFromProps,
  makeDefaultSections,
  sectionsToProps,
  validateSections,
  type Agent,
  type EditorMode,
  type JsonSectionErrors,
  type JsonSections,
  type SimpleAgentFields,
} from './agentProperties'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

// ── UI primitives ─────────────────────────────────────────────────
function Modal({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className={cn('bg-white rounded-2xl shadow-xl flex flex-col max-h-[92vh]', wide ? 'w-full max-w-3xl' : 'w-full max-w-lg')}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────
export function AgentsPage() {
  const { t, i18n } = useTranslation()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSections, setCreateSections] = useState<JsonSections>(makeDefaultSections())
  const [createSectionErrors, setCreateSectionErrors] = useState<JsonSectionErrors>({})
  const [createMode, setCreateMode] = useState<EditorMode>('ui')
  const [createSimple, setCreateSimple] = useState<SimpleAgentFields>(DEFAULT_SIMPLE_FIELDS)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')

  const [textModal, setTextModal] = useState<{ title: string; content: string } | null>(null)

  const [propsModal, setPropsModal] = useState<{
    agent: Agent
    original: Record<string, unknown>
    sections: JsonSections
    errors: JsonSectionErrors
    mode: EditorMode
    simple: SimpleAgentFields
  } | null>(null)
  const [propsError, setPropsError] = useState('')
  const [updating, setUpdating] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Live Test ────────────────────────────────────────────────────
  const USER_UID = '6002'
  const [liveTestAgent, setLiveTestAgent] = useState<Agent | null>(null)
  const [liveStatus, setLiveStatus] = useState<'idle' | 'starting' | 'active' | 'stopping'>('idle')
  const [liveError, setLiveError] = useState('')
  const [liveLines, setLiveLines] = useState<{ id: number; role: 'user' | 'assistant'; text: string }[]>([])
  const liveLineIdRef = useRef(0)
  const rtcClientRef = useRef<unknown>(null)
  const rtmClientRef = useRef<unknown>(null)
  const micTrackRef = useRef<unknown>(null)
  const sessionAgentIdRef = useRef('')

  async function handleLiveStart(agent: Agent) {
    setLiveTestAgent(agent)
    setLiveLines([])
    liveLineIdRef.current = 0
    setLiveError('')
    setLiveStatus('starting')

    const ch = `live-${Math.random().toString(36).slice(2, 10)}`

    try {
      const tokenResp = await authFetch(`${API}/api/live-test/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: USER_UID, channel: ch }),
      })
      if (!tokenResp.ok) throw new Error(`Token error: ${tokenResp.status}`)
      const { token: rtmToken, app_id: APP_ID } = await tokenResp.json()

      const RTMClass = (AgoraRTM as unknown as { RTM: new (appId: string, uid: string) => unknown }).RTM
        ?? (AgoraRTM as unknown as new (appId: string, uid: string) => unknown)
      const rtmClient = new RTMClass(APP_ID, USER_UID) as {
        login: (opts: { token: string }) => Promise<void>
        subscribe: (ch: string, opts: object) => Promise<void>
        unsubscribe: (ch: string) => Promise<void>
        logout: () => Promise<void>
        addEventListener: (ev: string, cb: (e: unknown) => void) => void
      }
      rtmClientRef.current = rtmClient

      rtmClient.addEventListener('message', (event: unknown) => {
        const e = event as { message?: string; publisher?: string }
        const raw = e.message
        if (!raw) return
        try {
          const payload = JSON.parse(raw)
          if (payload.object === 'user.transcription' && payload.final === true) {
            const text = (payload.text as string)?.trim()
            if (text) setLiveLines(prev => [...prev, { id: liveLineIdRef.current++, role: 'user', text }])
          } else if (payload.object === 'assistant.transcription' && payload.turn_status === 1) {
            const text = (payload.text as string)?.trim()
            if (text) setLiveLines(prev => [...prev, { id: liveLineIdRef.current++, role: 'assistant', text }])
          }
        } catch { /* ignore parse errors */ }
      })

      await rtmClient.login({ token: rtmToken })
      await rtmClient.subscribe(ch, { withPresence: false, withMessage: true, beQuiet: true })

      const startResp = await authFetch(`${API}/api/live-test/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent.agent_id, channel: ch, user_uid: USER_UID }),
      })
      if (!startResp.ok) {
        const err = await startResp.json().catch(() => ({ detail: startResp.statusText }))
        throw new Error(err.detail || 'Start failed')
      }
      const sessionData = await startResp.json()
      sessionAgentIdRef.current = sessionData.session_agent_id

      AgoraRTC.setLogLevel(3)
      const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      rtcClientRef.current = rtcClient

      rtcClient.on('user-published', async (user, mediaType) => {
        await rtcClient.subscribe(user, mediaType)
        if (mediaType === 'audio') {
          user.audioTrack?.play()
        }
      })

      const rtcToken = sessionData.user_token || null
      await rtcClient.join(sessionData.app_id, ch, rtcToken, parseInt(USER_UID))
      const micTrack = await AgoraRTC.createMicrophoneAudioTrack()
      micTrackRef.current = micTrack
      await rtcClient.publish([micTrack])

      setLiveStatus('active')
    } catch (err: unknown) {
      setLiveError(err instanceof Error ? err.message : 'Failed to start live test')
      setLiveStatus('idle')
      await _cleanupLive()
    }
  }

  async function handleLiveStop() {
    setLiveStatus('stopping')
    try {
      if (sessionAgentIdRef.current) {
        await authFetch(`${API}/api/live-test/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_agent_id: sessionAgentIdRef.current }),
        }).catch(() => {})
      }
    } finally {
      await _cleanupLive()
      setLiveStatus('idle')
      setLiveTestAgent(null)
    }
  }

  async function _cleanupLive() {
    try {
      const mic = micTrackRef.current as { stop: () => void; close: () => void } | null
      mic?.stop(); mic?.close()
      micTrackRef.current = null
    } catch { /* ignore */ }
    try {
      const rtc = rtcClientRef.current as { leave: () => Promise<void> } | null
      await rtc?.leave()
      rtcClientRef.current = null
    } catch { /* ignore */ }
    try {
      const rtm = rtmClientRef.current as { unsubscribe: (ch: string) => Promise<void>; logout: () => Promise<void> } | null
      if (rtm) { await rtm.logout().catch(() => {}) }
      rtmClientRef.current = null
    } catch { /* ignore */ }
    sessionAgentIdRef.current = ''
  }

  async function loadAgents() {
    try {
      const dbData = await authFetch(`${API}/api/agents`).then(r => r.json())
      setAgents(dbData)
      setLoading(false)
      const synced = await authFetch(`${API}/api/agents/sync`, { method: 'POST' }).then(r => r.json())
      setAgents(synced)
    } catch {
      setError(t('agents.server_error'))
      setLoading(false)
    }
  }

  useEffect(() => { loadAgents() }, [])

  // ── Create ──────────────────────────────────────────────────────
  function resetCreate() {
    setShowCreate(false)
    setCreateName('')
    setCreateSections(makeDefaultSections())
    setCreateSectionErrors({})
    setCreateMode('ui')
    setCreateSimple(DEFAULT_SIMPLE_FIELDS)
    setCreateError('')
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError('')

    if (!createName.trim()) {
      setCreateError(t('agents.create_error_required'))
      return
    }

    const errors = validateSections(createSections)
    if (Object.keys(errors).length > 0) {
      setCreateSectionErrors(errors)
      setCreateMode('json')
      return
    }

    const properties = sectionsToProps(createSections, {})
    setSubmitting(true)
    try {
      const resp = await authFetch(`${API}/api/agents/create-with-properties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: createName.trim(), properties }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Request failed')
      }
      const newAgent = await resp.json()
      setAgents(prev => [newAgent, ...prev])
      resetCreate()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────
  async function handleDelete(agentId: string) {
    if (!confirm(t('agents.delete_confirm'))) return
    setDeletingId(agentId)
    try {
      const resp = await authFetch(`${API}/api/agents/${agentId}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error()
      setAgents(prev => prev.filter(a => a.agent_id !== agentId))
    } catch {
      alert(t('common.delete_failed'))
    } finally {
      setDeletingId(null)
    }
  }

  // ── Open properties modal ────────────────────────────────────────
  function openPropsModal(agent: Agent) {
    setPropsError('')
    const original = (agent.properties ?? {}) as Record<string, unknown>
    const sections = extractSections(original)
    setPropsModal({
      agent,
      original,
      sections,
      errors: {},
      mode: 'ui',
      simple: extractSimpleFieldsFromProps(original),
    })
  }

  // ── Update properties ────────────────────────────────────────────
  async function handleUpdate() {
    if (!propsModal) return
    setPropsError('')

    const errors = validateSections(propsModal.sections)
    if (Object.keys(errors).length > 0) {
      setPropsModal(m => m ? { ...m, errors, mode: 'json' } : null)
      return
    }

    const rebuilt = sectionsToProps(propsModal.sections, propsModal.original)
    setUpdating(true)
    try {
      const resp = await authFetch(`${API}/api/agents/${propsModal.agent.agent_id}/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rebuilt),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Request failed')
      }
      const updated = await resp.json()
      setAgents(prev => prev.map(a => a.agent_id === updated.agent_id ? updated : a))
      setPropsModal(null)
    } catch (err: unknown) {
      setPropsError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setUpdating(false)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function getLlmModel(agent: Agent): string | null {
    try {
      const llm = agent.properties?.llm as Record<string, unknown> | undefined
      const params = llm?.params as Record<string, unknown> | undefined
      return (params?.model as string) || null
    } catch { return null }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString(bcp47ForI18n(i18n.language), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="p-8 bg-gray-50 min-h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('agents.page_subtitle')}</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateError('') }}
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <PlusCircle size={16} />
          Create Agent
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">{t('agents.loading')}</span>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">{error}</div>}

      {!loading && !error && (
        agents.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-12 text-center text-gray-400 shadow-sm">
            <Bot size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t('agents.empty')}</p>
            <p className="text-xs mt-1">{t('agents.empty_hint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map(a => (
              <div
                key={a.agent_id}
                className="bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden"
              >
                <div className="h-0.5 bg-indigo-500" />
                <div className="px-5 pt-4 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                        <Bot size={16} className="text-indigo-600" />
                      </div>
                      <h3 className="font-semibold text-gray-900 text-sm leading-snug truncate">{a.agent_name}</h3>
                    </div>
                    {getLlmModel(a) && (
                      <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200 font-mono">
                        {getLlmModel(a)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-gray-400 truncate mt-0.5">{a.agent_id}</p>
                </div>

                <div className="px-5 pb-4 space-y-2 flex-1">
                  {a.greeting_message ? (
                    <button
                      type="button"
                      onClick={() => setTextModal({ title: 'Greeting Message', content: a.greeting_message! })}
                      className="w-full text-left group"
                    >
                      <div className="flex items-start gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2 hover:bg-emerald-100 transition-colors">
                        <MessageCircle size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-gray-600 line-clamp-2 leading-snug">{a.greeting_message}</p>
                      </div>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                      <MessageCircle size={12} className="text-gray-300 flex-shrink-0" />
                      <p className="text-[11px] text-gray-300">No greeting message</p>
                    </div>
                  )}

                  {a.system_content ? (
                    <button
                      type="button"
                      onClick={() => setTextModal({ title: 'System Prompt', content: a.system_content! })}
                      className="w-full text-left group"
                    >
                      <div className="flex items-start gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-2 hover:bg-indigo-100 transition-colors">
                        <FileText size={12} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] font-mono text-gray-600 line-clamp-2 leading-snug">{a.system_content}</p>
                      </div>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                      <FileText size={12} className="text-gray-300 flex-shrink-0" />
                      <p className="text-[11px] text-gray-300">No system prompt</p>
                    </div>
                  )}
                </div>

                <div className="px-5 pb-4">
                  <button
                    onClick={() => handleLiveStart(a)}
                    disabled={liveStatus !== 'idle'}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors disabled:opacity-40"
                  >
                    <Radio size={13} /> Preview
                  </button>
                  <p className="text-[11px] text-gray-400 mt-2">{formatDate(a.created_at)}</p>
                </div>

                <div className="border-t border-gray-100 grid grid-cols-2">
                  <button
                    onClick={() => openPropsModal(a)}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors border-r border-gray-100"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(a.agent_id)}
                    disabled={deletingId === a.agent_id}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
                  >
                    {deletingId === a.agent_id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />}
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Text viewer modal ──────────────────────────────────── */}
      {textModal && (
        <Modal title={textModal.title} onClose={() => setTextModal(null)}>
          <div className="px-6 py-5 overflow-y-auto">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 font-sans">
                {textModal.content}
              </pre>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Properties JSON modal ──────────────────────────────── */}
      {propsModal && (
        <Modal title={`Edit Properties — ${propsModal.agent.agent_name}`} onClose={() => setPropsModal(null)} wide>
          <div className="px-6 pt-3 pb-3 border-b border-gray-100 flex-shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              {propsModal.mode === 'json' ? t('agents.props_sensitive_hint') : t('agents.props_ui_hint')}
            </p>
            <button
              onClick={handleUpdate}
              disabled={updating}
              className={cn('flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
                updating ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700')}
            >
              {updating && <Loader2 size={14} className="animate-spin" />}
              {updating ? 'Updating...' : 'UPDATE'}
            </button>
          </div>
          <div className="px-6 py-4 overflow-y-auto flex-1">
            {propsError && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{propsError}</p>
            )}
            <AgentPropertiesEditor
              mode={propsModal.mode}
              onModeChange={mode => setPropsModal(m => m ? { ...m, mode } : null)}
              sections={propsModal.sections}
              errors={propsModal.errors}
              onSectionChange={(key, value) => {
                let sectionError: string | undefined
                try { JSON.parse(value) } catch { sectionError = 'Invalid JSON' }
                setPropsModal(m => m ? {
                  ...m,
                  sections: { ...m.sections, [key]: value },
                  errors: { ...m.errors, [key]: sectionError },
                } : null)
              }}
              onReplaceSections={sections => setPropsModal(m => m ? { ...m, sections } : null)}
              simple={propsModal.simple}
              onSimpleChange={simple => setPropsModal(m => m ? { ...m, simple } : null)}
            />
          </div>
        </Modal>
      )}

      {/* ── Create Agent modal ─────────────────────────────────── */}
      {showCreate && (
        <Modal title="Create Agent" onClose={resetCreate} wide>
          <div className="px-6 pt-3 pb-3 border-b border-gray-100 flex-shrink-0 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Agent Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="my-agent"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className={cn('flex-shrink-0 mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
                submitting ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700')}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? 'Creating...' : 'Create Agent'}
            </button>
          </div>
          <div className="px-6 py-4 overflow-y-auto flex-1">
            {createError && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>
            )}
            <AgentPropertiesEditor
              mode={createMode}
              onModeChange={setCreateMode}
              sections={createSections}
              errors={createSectionErrors}
              onSectionChange={(key, value) => {
                let sectionError: string | undefined
                try { JSON.parse(value) } catch { sectionError = 'Invalid JSON' }
                setCreateSections(prev => ({ ...prev, [key]: value }))
                setCreateSectionErrors(prev => ({ ...prev, [key]: sectionError }))
              }}
              onReplaceSections={setCreateSections}
              simple={createSimple}
              onSimpleChange={setCreateSimple}
            />
          </div>
        </Modal>
      )}

      {/* ── Live Test modal ────────────────────────────────────── */}
      {liveTestAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{ maxHeight: '80vh' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Radio size={16} className={liveStatus === 'active' ? 'text-emerald-600 animate-pulse' : 'text-emerald-500'} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Live Test — {liveTestAgent.agent_name}</h2>
                  <p className="text-[11px] text-gray-400 font-mono">{liveTestAgent.agent_id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {liveStatus === 'active' && (
                  <button
                    onClick={handleLiveStop}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                  >
                    Stop
                  </button>
                )}
                {liveStatus === 'idle' && (
                  <button
                    onClick={() => { setLiveTestAgent(null); setLiveError('') }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className={cn(
              'px-5 py-2 text-xs font-medium flex items-center gap-2 flex-shrink-0',
              liveStatus === 'starting' ? 'bg-amber-50 text-amber-700' :
              liveStatus === 'active' ? 'bg-emerald-50 text-emerald-700' :
              liveStatus === 'stopping' ? 'bg-gray-50 text-gray-500' : 'bg-gray-50 text-gray-400'
            )}>
              {(liveStatus === 'starting' || liveStatus === 'stopping') && <Loader2 size={12} className="animate-spin" />}
              {liveStatus === 'starting' && 'Connecting…'}
              {liveStatus === 'active' && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /> Live — speak into your microphone</>}
              {liveStatus === 'stopping' && 'Stopping…'}
              {liveStatus === 'idle' && liveError && <span className="text-red-600">{liveError}</span>}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-[200px]">
              {liveLines.length === 0 && liveStatus === 'active' && (
                <p className="text-xs text-gray-300 text-center mt-8">Waiting for speech…</p>
              )}
              {liveLines.map(line => (
                <div key={line.id} className={cn('flex', line.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    line.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  )}>
                    {line.text}
                  </div>
                </div>
              ))}
            </div>

            {liveStatus === 'active' && (
              <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex justify-end">
                <button
                  onClick={handleLiveStop}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                >
                  End Call
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
