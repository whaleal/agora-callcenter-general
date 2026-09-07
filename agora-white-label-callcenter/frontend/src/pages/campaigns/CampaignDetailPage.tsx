import { authFetch } from '../../lib/api'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowLeft, Loader2, StopCircle, RefreshCw, Phone, MessageSquare, Database, Download, X,
  PhoneCall, PhoneOutgoing, Voicemail, PhoneMissed, CircleAlert, Timer, Copy,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { campaignAgentSourceLabel, campaignQuotaModeLabel } from '../../lib/campaignDisplayLabels'
import { bcp47ForI18n } from '../../i18n'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

interface CampaignV2Detail {
  id: number
  campaign_id: string
  campaign_name: string
  questionnaire_type: string | null
  quota_mode: string | null
  total_numbers: number | null
  calls_count: number | null
  phone_number_id: string | null
  phone_number: string | null
  agent_id: string | null
  agent_name: string | null
  start_immediately: boolean | null
  max_call_duration_seconds: number | null
  silence_timeout_seconds: number | null
  end_call_on_silence_timeout: boolean | null
  ring_timeout_seconds: number | null
  end_call_on_user_request: boolean | null
  end_call_on_ai_assistant: boolean | null
  structured_output: unknown | null
  enable_transcript: boolean | null
  enable_recording: boolean | null
  status: string | null
  created_at: string | null
  updated_at: string | null
}

interface CallV2ListItem {
  sip_call_id: string | null
  call_id: string
  campaign_id: string
  agent_id: string | null
  agent_session_id: string | null
  agent_name: string | null
  from_number: string | null
  to_number: string | null
  call_category: string | null
  hangup_reason: string | null
  duration_seconds: number | null
  answered_ts: number | null
  call_ts: number | null
  start_ts: number | null
  channel_name: string | null
  record_file_url: string | null
  has_transcript: boolean
  has_structured_output: boolean
  call_success: boolean | null | undefined
}

interface CallV2Stats {
  campaign_id: string
  total_dialed: number
  answered: number
  voicemail: number
  no_answer: number
  failed: number
  total_duration_seconds: number
}

type CallListCategory = 'all' | 'answered' | 'voicemail' | 'no_answer' | 'failed'
type CallListSort = 'time_desc' | 'duration_asc' | 'duration_desc'

interface CallV2Detail {
  sip_call_id: string | null
  call_id: string
  campaign_id: string
  agent_id: string | null
  agent_session_id: string | null
  agent_name: string | null
  from_number: string | null
  to_number: string | null
  call_category: string | null
  hangup_reason: string | null
  duration_seconds: number | null
  answered_ts: number | null
  call_ts: number | null
  channel_name: string | null
  transcript: { role: string; content: string }[]
  record_file_url: string | null
  has_structured_output?: boolean
  structured_output: unknown[] | null
}

const STATUS_STYLE: Record<string, string> = {
  completed:   'bg-gray-100 text-gray-600',
  interrupted: 'bg-red-50 text-red-600',
  interrupt:   'bg-red-50 text-red-600',
  running:     'bg-emerald-50 text-emerald-700',
  scheduled:   'bg-indigo-50 text-indigo-700',
  paused:      'bg-amber-50 text-amber-700',
  pending:     'bg-gray-100 text-gray-500',
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="w-36 flex-shrink-0 text-xs text-gray-400 pt-0.5">{label}</span>
      <span className="text-sm text-gray-900 font-mono break-all">{value ?? '—'}</span>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 pb-2 border-b border-gray-100">{title}</h3>
      {children}
    </div>
  )
}

function fmtSecondsI18n(t: TFunction, s: number | null) {
  if (s == null) return '—'
  if (s >= 3600) {
    return t('agora.time_h', { n: s / 3600 })
  }
  if (s >= 60) {
    return t('agora.time_m_s', { m: Math.floor(s / 60), s: s % 60 })
  }
  return t('agora.time_s', { n: s })
}

function fmtDurationHms(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
}

function fmtDateLocale(s: string | null, lng: string) {
  if (!s) return '—'
  return new Date(s).toLocaleString(bcp47ForI18n(lng))
}


function isCampaignTerminalStatus(status: string | null | undefined) {
  const st = (status ?? '').toLowerCase()
  return st === 'completed' || st === 'interrupted' || st === 'interrupt' || st === 'failed'
}

const TERMINAL_SYNC_GRACE_MS = 3 * 60 * 1000

/**
 * 终态时是否在「允许 sync 通话」的宽限内。取 min(服务端 updated_at, 进页/观察终态的 terminalAt) 为锚点：
 * 老数据 completed 的 updated_at 通常很早，进页时虽会写 terminalAt=now，但 min 仍偏早，超过 3 分钟即停 sync。
 * running / scheduled 始终允许 sync。
 */
function shouldSyncCallsNow(
  status: string | null | undefined,
  terminalAtMs: number | null,
  serverUpdatedAt: string | null | undefined,
) {
  const st = (status ?? '').toLowerCase()
  if (st === 'running' || st === 'scheduled') return true
  if (!isCampaignTerminalStatus(status)) return false
  const times: number[] = []
  if (serverUpdatedAt) {
    const u = new Date(serverUpdatedAt).getTime()
    if (!Number.isNaN(u)) {
      times.push(u)
    }
  }
  if (terminalAtMs != null) {
    times.push(terminalAtMs)
  }
  if (times.length === 0) {
    return false
  }
  const anchor = Math.min(...times)
  return Date.now() - anchor <= TERMINAL_SYNC_GRACE_MS
}

export function CampaignDetailPage() {
  const { t, i18n } = useTranslation()
  const statusLabel = useMemo(() => ({
    completed: t('agora.status_completed'),
    interrupted: t('agora.status_interrupted'),
    interrupt: t('agora.status_interrupted'),
    running: t('agora.status_running'),
    scheduled: t('agora.status_scheduled'),
    paused: t('agora.status_paused'),
    pending: t('agora.status_pending'),
    failed: t('agora.status_failed'),
  }), [t, i18n.language])
  const featureKeys = useMemo((): { key: keyof CampaignV2Detail; label: string }[] => [
    { key: 'enable_transcript', label: t('agora.feature_transcript') },
    { key: 'enable_recording', label: t('agora.feature_recording') },
    { key: 'end_call_on_silence_timeout', label: t('agora.end_silence') },
    { key: 'end_call_on_user_request', label: t('agora.end_user') },
    { key: 'end_call_on_ai_assistant', label: t('agora.end_ai') },
  ], [t, i18n.language])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState<CampaignV2Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [interrupting, setInterrupting] = useState(false)
  const statusRef = useRef<string | null>(null)
  const serverUpdatedAtRef = useRef<string | null>(null)
  const terminalAtRef = useRef<number | null>(null)
  const callsSyncingRef = useRef(false)
  const lastCampaignUpstreamAtRef = useRef(0)

  const [calls, setCalls] = useState<CallV2ListItem[]>([])
  const [callsTotal, setCallsTotal] = useState(0)
  const [callsLoading, setCallsLoading] = useState(false)
  const [callsError, setCallsError] = useState('')
  const [callStats, setCallStats] = useState<CallV2Stats | null>(null)
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const [callCategoryFilter, setCallCategoryFilter] = useState<CallListCategory>('all')
  const [callListSort, setCallListSort] = useState<CallListSort>('time_desc')
  const [activeTranscript, setActiveTranscript] = useState<CallV2Detail | null>(null)
  const [activeStructured, setActiveStructured] = useState<CallV2Detail | null>(null)

  useEffect(() => {
    setPage(1)
    setCallStats(null)
    setCallCategoryFilter('all')
    setCallListSort('time_desc')
    statusRef.current = null
    serverUpdatedAtRef.current = null
    terminalAtRef.current = null
  }, [id])

  function callListQueryString(pageOverride?: number) {
    return new URLSearchParams({
      page: String(pageOverride ?? page),
      page_size: String(PAGE_SIZE),
      category: callCategoryFilter,
      sort: callListSort,
    }).toString()
  }

  function onStatFilterClick(next: CallListCategory) {
    setCallCategoryFilter(prev => (prev === next && next !== 'all' ? 'all' : next))
    setPage(1)
  }

  function applyCallsListPayload(body: {
    items?: CallV2ListItem[]
    total?: number
    stats?: CallV2Stats
  }) {
    setCalls((body.items ?? []) as CallV2ListItem[])
    setCallsTotal(Number(body.total ?? 0))
    if (body.stats) {
      setCallStats(body.stats)
    }
  }

  useEffect(() => {
    if (!id) return
    authFetch(`${API}/api/campaigns-v2/${id}`)
      .then(r => r.json())
      .then(data => {
        setCampaign(data)
        statusRef.current = data.status ?? null
        serverUpdatedAtRef.current = data.updated_at ?? null
        const TERMINAL = new Set(['completed', 'interrupted', 'interrupt', 'failed'])
        if (TERMINAL.has((data.status ?? '').toLowerCase()) && !terminalAtRef.current) {
          terminalAtRef.current = Date.now()
        }
      })
      .catch(() => setError(t('agora.load_fail')))
      .finally(() => setLoading(false))
  }, [id, t])

  async function fetchCallsPage() {
    if (!id) throw new Error(t('agora.load_calls_fail'))
    const dbResp = await authFetch(`${API}/api/calls-v2/${id}?${callListQueryString()}`)
    if (!dbResp.ok) {
      const errText = await dbResp.text()
      throw new Error(errText || t('agora.load_calls_fail'))
    }
    const dbBody = await dbResp.json()
    applyCallsListPayload(dbBody as { items?: CallV2ListItem[]; total?: number; stats?: CallV2Stats })
  }

  async function loadCalls(preferDbOnly: boolean) {
    if (!id) return
    if (!preferDbOnly) {
      setCallsLoading(true)
    }
    setCallsError('')
    try {
      await fetchCallsPage()
      if (preferDbOnly) return

      const syncResp = await authFetch(`${API}/api/calls-v2/${id}/sync`, { method: 'POST' })
      if (syncResp.ok) {
        await syncResp.json()
        const refreshed = await authFetch(`${API}/api/calls-v2/${id}?${callListQueryString()}`)
        if (refreshed.ok) {
          const refreshedBody = await refreshed.json()
          applyCallsListPayload(refreshedBody as { items?: CallV2ListItem[]; total?: number; stats?: CallV2Stats })
        }
      }
    } catch (e) {
      setCallsError(e instanceof Error ? e.message : t('agora.load_calls_fail'))
    } finally {
      if (!preferDbOnly) {
        setCallsLoading(false)
      }
    }
  }

  async function syncCalls() {
    await loadCalls(false)
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const run = async () => {
      setCallsError('')
      try {
        await fetchCallsPage()
      } catch (e) {
        if (!cancelled) {
          setCallsError(e instanceof Error ? e.message : t('agora.load_calls_fail'))
        }
        return
      }
      if (cancelled) return
      if (!shouldSyncCallsNow(statusRef.current, terminalAtRef.current, serverUpdatedAtRef.current)) {
        return
      }
      setCallsLoading(true)
      try {
        const syncResp = await authFetch(`${API}/api/calls-v2/${id}/sync`, { method: 'POST' })
        if (syncResp.ok) {
          await syncResp.json()
          const refreshed = await authFetch(`${API}/api/calls-v2/${id}?${callListQueryString()}`)
          if (refreshed.ok) {
            const refreshedBody = await refreshed.json()
            if (!cancelled) {
              applyCallsListPayload(refreshedBody as { items?: CallV2ListItem[]; total?: number; stats?: CallV2Stats })
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          setCallsError(e instanceof Error ? e.message : t('agora.sync_calls_fail'))
        }
      } finally {
        if (!cancelled) {
          setCallsLoading(false)
        }
      }
    }
    run().catch(() => {})
    return () => { cancelled = true }
  }, [id, page, callCategoryFilter, callListSort, t])

  // Auto-refresh: DB every tick. Upstream Agora while scheduled or running (scheduled→running needs upstream).
  useEffect(() => {
    if (!id) return
    lastCampaignUpstreamAtRef.current = 0
    const TERMINAL = new Set(['completed', 'interrupted', 'interrupt', 'failed'])
    const UPSTREAM_COOLDOWN_MS = 10_000
    const tickCampaign = async () => {
      try {
        const st = (statusRef.current ?? '').toLowerCase()
        const now = Date.now()
        const useUpstream =
          (st === 'running' || st === 'scheduled') &&
          now - lastCampaignUpstreamAtRef.current >= UPSTREAM_COOLDOWN_MS
        const q = useUpstream ? '?refresh_from_upstream=true' : ''
        const r = await authFetch(`${API}/api/campaigns-v2/${id}${q}`)
        if (!r.ok) return
        const data = await r.json()
        if (useUpstream) {
          lastCampaignUpstreamAtRef.current = Date.now()
        }
        setCampaign(data)
        statusRef.current = data.status ?? null
        serverUpdatedAtRef.current = data.updated_at ?? null
        if (TERMINAL.has((data.status ?? '').toLowerCase()) && !terminalAtRef.current) {
          terminalAtRef.current = Date.now()
        }
      } catch { /* ignore */ }
    }
    void tickCampaign()
    const timer = setInterval(() => { void tickCampaign() }, 10_000)
    return () => clearInterval(timer)
  }, [id])

  // Auto-refresh calls: running / scheduled; terminal + 3 minutes grace period.
  useEffect(() => {
    if (!id) return
    const tick = async () => {
      if (!shouldSyncCallsNow(statusRef.current, terminalAtRef.current, serverUpdatedAtRef.current)) {
        return
      }
      if (callsSyncingRef.current) return
      callsSyncingRef.current = true
      try {
        const resp = await authFetch(`${API}/api/calls-v2/${id}/sync`, { method: 'POST' })
        if (resp.ok) {
          await resp.json()
          const refreshed = await authFetch(`${API}/api/calls-v2/${id}?${callListQueryString()}`)
          if (refreshed.ok) {
            const refreshedBody = await refreshed.json()
            applyCallsListPayload(refreshedBody as { items?: CallV2ListItem[]; total?: number; stats?: CallV2Stats })
          }
        }
      } catch { /* ignore */ }
      finally {
        callsSyncingRef.current = false
      }
    }
    const timer = setInterval(() => { tick().catch(() => {}) }, 10_000)
    tick().catch(() => {})
    return () => clearInterval(timer)
  }, [id, page, callCategoryFilter, callListSort])

  async function handleInterrupt() {
    if (!id || !campaign) return
    setInterrupting(true)
    try {
      const resp = await authFetch(`${API}/api/campaigns-v2/${id}/interrupt`, { method: 'POST' })
      if (!resp.ok) throw new Error()
      setCampaign(prev => prev ? { ...prev, status: 'interrupted' } : prev)
      statusRef.current = 'interrupted'
      if (!terminalAtRef.current) {
        terminalAtRef.current = Date.now()
      }
      serverUpdatedAtRef.current = new Date().toISOString()
    } catch {
      alert(t('agora.interrupt_fail'))
    } finally {
      setInterrupting(false)
    }
  }

  function categoryStyle(cat: string | null): { dot: string; text: string } {
    const c = (cat ?? '').toLowerCase()
    if (c.includes('answered')) return { dot: 'bg-emerald-500', text: 'text-emerald-700' }
    if (c.includes('transferred_success') || c.includes('transfer_success')) return { dot: 'bg-emerald-600', text: 'text-emerald-700' }
    if (c.includes('transferred_failed') || c.includes('transfer_failed')) return { dot: 'bg-red-400', text: 'text-red-600' }
    if (c.includes('voicemail')) return { dot: 'bg-indigo-400', text: 'text-indigo-600' }
    if (c.includes('no_answer') || c === 'no-answer') return { dot: 'bg-amber-500', text: 'text-amber-700' }
    if (c.includes('failed') || c.includes('error')) return { dot: 'bg-red-500', text: 'text-red-600' }
    if (c.includes('ai_assistant') || c.includes('ai-assistant')) return { dot: 'bg-indigo-500', text: 'text-indigo-600' }
    return { dot: 'bg-gray-300', text: 'text-gray-500' }
  }

  function closeModals() {
    setActiveTranscript(null)
    setActiveStructured(null)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-400">
      <Loader2 size={20} className="animate-spin mr-2" />
      <span className="text-sm">{t('agora.loading')}</span>
    </div>
  )

  if (error || !campaign) return (
    <div className="p-8">
      <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={15} /> {t('agora.back')}
      </button>
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        {error || t('agora.not_found')}
      </div>
    </div>
  )

  const status = campaign.status ?? 'pending'
  const isTerminal = status === 'completed' || status === 'interrupted' || status === 'interrupt' || status === 'failed'
  const totalNumbers = Math.max(0, Number(campaign.total_numbers ?? 0))
  const dialedNumbers = Math.max(0, Number(campaign.calls_count ?? 0))
  const pct = totalNumbers > 0 ? Math.min(100, Math.round((dialedNumbers / totalNumbers) * 100)) : 0

  const totalPages = Math.max(1, Math.ceil(callsTotal / PAGE_SIZE))
  const pageItems = calls

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
          <div className="min-w-0">
            <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-2">
              <ArrowLeft size={15} /> {t('agora.back_list')}
            </button>
            <h1 className="text-lg font-bold text-gray-900 truncate">{campaign.campaign_name}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-500')}>
                {statusLabel[status as keyof typeof statusLabel] ?? status}
              </span>
              {campaign.questionnaire_type && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-700">
                  {campaignAgentSourceLabel(t, campaign.questionnaire_type)}
                </span>
              )}
              {campaign.quota_mode && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                  {campaignQuotaModeLabel(t, campaign.quota_mode)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                syncCalls()
              }}
              disabled={callsLoading}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                callsLoading
                  ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              )}
            >
              <RefreshCw size={13} className={cn(callsLoading && 'animate-spin')} />
              {shouldSyncCallsNow(statusRef.current, terminalAtRef.current, serverUpdatedAtRef.current)
                ? t('agora.refresh_calls')
                : t('agora.refresh_list')}
            </button>
            <button
              onClick={() => navigate('/surveys/new', { state: { duplicateFrom: campaign } })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-white text-indigo-600 hover:bg-indigo-50 border border-indigo-200"
            >
              <Copy size={13} />
              {t('agora.duplicate')}
            </button>
            <button
              onClick={handleInterrupt}
              disabled={isTerminal || interrupting}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                isTerminal
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : 'bg-white text-red-600 hover:bg-red-50 border border-red-200'
              )}
            >
              {interrupting ? <Loader2 size={13} className="animate-spin" /> : <StopCircle size={13} />}
              Interrupt
            </button>
          </div>
        </div>

        {/* Call overview stats */}
        <div className="flex-shrink-0 border-b border-gray-100 bg-gray-50 px-6 py-3">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <button
              type="button"
              onClick={() => onStatFilterClick('all')}
              className={cn(
                'flex w-full items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-colors cursor-pointer',
                callCategoryFilter === 'all'
                  ? 'border-indigo-500 ring-1 ring-indigo-200/80 bg-indigo-50/30'
                  : 'border-gray-100 hover:bg-gray-50',
              )}
            >
              <div className="mt-0.5 rounded-md bg-indigo-50 p-1.5 text-indigo-600">
                <PhoneOutgoing size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400">{t('agora.stat_total_dialed')}</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900">
                  {callStats != null ? callStats.total_dialed : '—'}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onStatFilterClick('answered')}
              className={cn(
                'flex w-full items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-colors cursor-pointer',
                callCategoryFilter === 'answered'
                  ? 'border-indigo-500 ring-1 ring-indigo-200/80 bg-indigo-50/30'
                  : 'border-gray-100 hover:bg-gray-50',
              )}
            >
              <div className="mt-0.5 rounded-md bg-emerald-50 p-1.5 text-emerald-600">
                <PhoneCall size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400">{t('agora.stat_answered')}</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900">
                  {callStats != null ? callStats.answered : '—'}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onStatFilterClick('voicemail')}
              className={cn(
                'flex w-full items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-colors cursor-pointer',
                callCategoryFilter === 'voicemail'
                  ? 'border-indigo-500 ring-1 ring-indigo-200/80 bg-indigo-50/30'
                  : 'border-gray-100 hover:bg-gray-50',
              )}
            >
              <div className="mt-0.5 rounded-md bg-indigo-50 p-1.5 text-indigo-500">
                <Voicemail size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400">{t('agora.stat_voicemail')}</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900">
                  {callStats != null ? callStats.voicemail : '—'}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onStatFilterClick('no_answer')}
              className={cn(
                'flex w-full items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-colors cursor-pointer',
                callCategoryFilter === 'no_answer'
                  ? 'border-indigo-500 ring-1 ring-indigo-200/80 bg-indigo-50/30'
                  : 'border-gray-100 hover:bg-gray-50',
              )}
            >
              <div className="mt-0.5 rounded-md bg-amber-50 p-1.5 text-amber-600">
                <PhoneMissed size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400">{t('agora.stat_no_answer')}</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900">
                  {callStats != null ? callStats.no_answer : '—'}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onStatFilterClick('failed')}
              className={cn(
                'flex w-full items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-colors cursor-pointer',
                callCategoryFilter === 'failed'
                  ? 'border-indigo-500 ring-1 ring-indigo-200/80 bg-indigo-50/30'
                  : 'border-gray-100 hover:bg-gray-50',
              )}
            >
              <div className="mt-0.5 rounded-md bg-red-50 p-1.5 text-red-500">
                <CircleAlert size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400">{t('agora.stat_failed')}</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900">
                  {callStats != null ? callStats.failed : '—'}
                </p>
              </div>
            </button>
            <div className="flex items-start gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
              <div className="mt-0.5 rounded-md bg-indigo-50 p-1.5 text-indigo-500">
                <Timer size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-400">{t('agora.stat_total_duration')}</p>
                <p className="text-lg font-semibold tabular-nums text-gray-900 tracking-tight">
                  {callStats != null ? fmtDurationHms(callStats.total_duration_seconds) : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Body split */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: campaign detail */}
          <div className="w-[30%] min-w-[360px] overflow-y-auto p-6 bg-gray-50">
            <div className="space-y-3">
              <Card title={t('agora.card_basic')}>
                <div className="py-2.5 border-b border-gray-100">
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>{t('agora.dial_progress')}</span>
                    <span className="font-mono">{dialedNumbers}/{totalNumbers}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <InfoRow label="Campaign ID"   value={campaign.campaign_id} />
                <InfoRow label="Campaign Name" value={<span className="font-sans">{campaign.campaign_name}</span>} />
                <InfoRow label={t('agora.caller_id')}     value={campaign.phone_number} />
                <InfoRow label="Agent ID"      value={campaign.agent_id} />
                <InfoRow
                  label={t('agora.start_now')}
                  value={campaign.start_immediately != null
                    ? (campaign.start_immediately ? t('common.yes') : t('common.no'))
                    : null
                  }
                />
                <InfoRow label={t('agora.created_at')}    value={fmtDateLocale(campaign.created_at, i18n.language)} />
                <InfoRow label={t('agora.updated_at')}   value={fmtDateLocale(campaign.updated_at, i18n.language)} />
              </Card>

              <Card title={t('agora.card_features')}>
                {featureKeys.map(({ key, label }) => {
                  const enabled = campaign[key] as boolean | null
                  return (
                    <div
                      key={key}
                      className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0"
                    >
                      <span className="w-36 flex-shrink-0 text-xs text-gray-400 pt-0.5">{label}</span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold tracking-tight',
                          'ring-1 shadow-sm',
                          enabled
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/90'
                            : 'bg-gray-100 text-gray-500 ring-gray-200/90',
                        )}
                      >
                        {enabled ? t('agora.feature_enabled') : t('agora.feature_disabled')}
                      </span>
                    </div>
                  )
                })}
              </Card>

              <Card title={t('agora.card_hangup')}>
                <InfoRow label={t('agora.label_max_call')} value={fmtSecondsI18n(t, campaign.max_call_duration_seconds)} />
                <InfoRow
                  label={t('agora.label_silence_timeout')}
                  value={fmtSecondsI18n(t, campaign.silence_timeout_seconds)}
                />
                <InfoRow label={t('agora.label_max_ring')} value={fmtSecondsI18n(t, campaign.ring_timeout_seconds)} />
              </Card>

              {campaign.structured_output != null && (
                <Card title="Structured Output">
                  <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto leading-relaxed border border-gray-100">
                    {JSON.stringify(campaign.structured_output, null, 2)}
                  </pre>
                </Card>
              )}
            </div>
          </div>

          {/* Right: call records list */}
          <div className="flex-1 overflow-y-auto bg-white">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Phone size={16} className="text-indigo-600 flex-shrink-0" />
                <h2 className="text-sm font-semibold text-gray-900">{t('agora.call_log')}</h2>
                <span className="text-xs text-gray-400">{t('agora.calls_n', { n: callsTotal })}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="whitespace-nowrap">{t('agora.sort_label')}</span>
                  <select
                    value={callListSort}
                    onChange={e => {
                      setCallListSort(e.target.value as CallListSort)
                      setPage(1)
                    }}
                    className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-900 min-w-0 max-w-[min(100%,220px)]"
                  >
                    <option value="time_desc">{t('agora.sort_time_desc')}</option>
                    <option value="duration_asc">{t('agora.sort_duration_asc')}</option>
                    <option value="duration_desc">{t('agora.sort_duration_desc')}</option>
                  </select>
                </label>
                {callsTotal > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className={cn(
                        'px-2 py-1 rounded border',
                        page <= 1 ? 'text-gray-300 border-gray-200 cursor-not-allowed' : 'border-gray-200 hover:bg-gray-50',
                      )}
                    >
                      {t('agora.prev_page')}
                    </button>
                    <span className="font-mono">{page}/{totalPages}</span>
                    <button
                      type="button"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className={cn(
                        'px-2 py-1 rounded border',
                        page >= totalPages ? 'text-gray-300 border-gray-200 cursor-not-allowed' : 'border-gray-200 hover:bg-gray-50',
                      )}
                    >
                      {t('agora.next_page')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {callsError && (
              <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
                {callsError}
              </div>
            )}

            {callsLoading && callsTotal === 0 && (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={18} className="animate-spin mr-2" />
                <span className="text-sm">{t('agora.fetching_calls')}</span>
              </div>
            )}

            {!callsLoading && callsTotal === 0 && (
              <div className="px-4 py-16 text-center text-gray-400">
                <p className="text-sm">
                  {(callStats?.total_dialed ?? 0) > 0 && callCategoryFilter !== 'all'
                    ? t('agora.no_calls_in_filter')
                    : t('agora.no_calls')}
                </p>
                {((callStats?.total_dialed ?? 0) === 0 || callCategoryFilter === 'all') && (
                  <p className="text-xs mt-1">{t('agora.no_calls_hint')}</p>
                )}
              </div>
            )}

            {callsTotal > 0 && (
              <div className="overflow-x-auto">
                <div className="min-w-[1620px] divide-y divide-gray-100">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] text-gray-400 font-medium grid grid-cols-[18px_160px_140px_140px_220px_70px_260px_300px_72px_92px] gap-2">
                  <span>{t('agora.th_status')}</span>
                  <span>{t('agora.th_to')}</span>
                  <span>{t('agora.th_type')}</span>
                  <span>Call Start Time</span>
                  <span>{t('agora.th_hangup')}</span>
                  <span>{t('agora.th_duration')}</span>
                  <span>{t('agora.th_session')}</span>
                  <span>Call ID</span>
                  <span>樣本</span>
                  <span className="text-right pr-1">{t('agora.th_actions')}</span>
                </div>
                {pageItems.map(c => {
                  const st = categoryStyle(c.call_category)
                  return (
                    <div key={c.call_id} className="px-4 py-2 hover:bg-gray-50 transition-colors grid grid-cols-[18px_160px_140px_140px_220px_70px_260px_300px_72px_92px] gap-2 items-center">
                      <div className="flex items-center justify-start">
                        <span className={cn('w-2.5 h-2.5 rounded-full', st.dot)} title={c.call_category ?? 'unknown'} />
                      </div>
                      <span className={cn('text-[11px] font-mono truncate', st.text)} title={c.to_number ?? ''}>
                        {c.to_number ?? '—'}
                      </span>
                      <span className={cn('text-[11px] font-mono truncate', st.text)} title={c.call_category ?? ''}>
                        {c.call_category ?? '—'}
                      </span>
                      <span className="text-[11px] text-gray-600 font-mono truncate" title={c.start_ts ? new Date(c.start_ts).toLocaleString(bcp47ForI18n(i18n.language)) : ''}>
                        {c.start_ts ? new Date(c.start_ts).toLocaleTimeString(bcp47ForI18n(i18n.language)) : '—'}
                      </span>
                      <span className="text-[11px] text-gray-600 font-mono truncate" title={c.hangup_reason ?? ''}>
                        {c.hangup_reason ?? '—'}
                      </span>
                      <span className="text-[11px] text-gray-600 font-mono">
                        {c.duration_seconds ?? 0}s
                      </span>
                      <span className="text-[11px] text-gray-600 font-mono truncate" title={c.agent_session_id ?? ''}>
                          {c.agent_session_id ?? '—'}
                      </span>
                      <span className="text-[11px] text-gray-500 font-mono break-all">
                        {c.call_id}
                      </span>
                      <div className="flex items-center">
                        {c.call_success == null ? null : c.call_success ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500 text-white whitespace-nowrap">
                            樣本成功
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-400 text-white whitespace-nowrap">
                            樣本失敗
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={!c.has_transcript}
                          onClick={async () => {
                            if (!c.has_transcript) return
                            try {
                              const r = await authFetch(`${API}/api/calls-v2/call/${c.call_id}`)
                              if (!r.ok) return
                              setActiveTranscript((await r.json()) as CallV2Detail)
                            } catch { /* ignore */ }
                          }}
                          className={cn(
                            'w-6 h-6 inline-flex items-center justify-center rounded-md border',
                            c.has_transcript
                              ? 'border-gray-200 text-gray-500 hover:bg-gray-100'
                              : 'border-gray-100 text-gray-200 cursor-not-allowed',
                          )}
                          title={
                            c.has_transcript
                              ? t('agora.tt_transcript')
                              : t('agora.no_transcript')
                          }
                        >
                          <MessageSquare size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={!c.has_structured_output}
                          onClick={async () => {
                            if (!c.has_structured_output) return
                            try {
                              const r = await authFetch(`${API}/api/calls-v2/call/${c.call_id}`)
                              if (!r.ok) return
                              setActiveStructured((await r.json()) as CallV2Detail)
                            } catch { /* ignore */ }
                          }}
                          className={cn(
                            'w-6 h-6 inline-flex items-center justify-center rounded-md border',
                            c.has_structured_output
                              ? 'border-gray-200 text-gray-500 hover:bg-gray-100'
                              : 'border-gray-100 text-gray-200 cursor-not-allowed',
                          )}
                          title={
                            c.has_structured_output
                              ? t('agora.tt_structured')
                              : t('agora.no_structured_output')
                          }
                        >
                          <Database size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={!c.record_file_url}
                          onClick={async () => {
                            if (!c.record_file_url) return
                            let url = c.record_file_url
                            if (url.startsWith('s3://')) {
                              try {
                                const r = await authFetch(`${API}/api/import/audio-presign`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ s3_uri: url }),
                                })
                                if (!r.ok) throw new Error()
                                url = (await r.json()).url
                              } catch {
                                alert('無法取得錄音連結，請稍後再試')
                                return
                              }
                            }
                            window.open(url, '_blank', 'noreferrer')
                          }}
                          className={cn(
                            'w-6 h-6 inline-flex items-center justify-center rounded-md border',
                            c.record_file_url
                              ? 'border-gray-200 text-gray-500 hover:bg-gray-100'
                              : 'border-gray-100 text-gray-200 cursor-not-allowed'
                          )}
                          title={t('agora.tt_recording')}
                        >
                          <Download size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript modal */}
      {activeTranscript && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={closeModals}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-indigo-600" />
                <span className="text-sm font-semibold text-gray-900">{t('agora.modal_transcript')}</span>
                <span className="text-xs text-gray-400 font-mono">{activeTranscript.call_id}</span>
              </div>
              <button onClick={closeModals} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-2 bg-gray-50 rounded-lg border border-gray-100">
              {(activeTranscript.transcript ?? []).length === 0 && (
                <p className="text-sm text-gray-400">{t('agora.no_transcript')}</p>
              )}
              {(activeTranscript.transcript ?? []).filter(m => (m.content ?? '').trim()).map((m, idx) => (
                <div key={idx} className={cn('flex', m.role === 'assistant' ? 'justify-start' : 'justify-end')}>
                  <div className={cn(
                    'max-w-[78%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap',
                    m.role === 'assistant'
                      ? 'bg-white text-gray-900 border border-gray-100 rounded-tl-sm'
                      : 'bg-indigo-600 text-white rounded-tr-sm'
                  )}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Structured output modal */}
      {activeStructured && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={closeModals}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-emerald-600" />
                <span className="text-sm font-semibold text-gray-900">Structured Output</span>
                <span className="text-xs text-gray-400 font-mono">{activeStructured.call_id}</span>
              </div>
              <button onClick={closeModals} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto bg-white">
              {activeStructured.structured_output == null ? (
                <p className="text-sm text-gray-400">{t('agora.no_structured_output')}</p>
              ) : (
                <pre className="text-xs text-gray-700 bg-gray-50 rounded-xl p-4 overflow-x-auto border border-gray-100">
                  {JSON.stringify(activeStructured.structured_output, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
