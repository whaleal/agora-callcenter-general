import { authFetch } from '../../lib/api'
import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, Radio, StopCircle, LayoutDashboard, PieChart, CalendarRange, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { campaignAgentSourceLabel, campaignQuotaModeLabel } from '../../lib/campaignDisplayLabels'
import { bcp47ForI18n } from '../../i18n'

type DateFilter = 'today' | '7d' | '14d' | '30d' | 'all' | 'custom'

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'today',  label: 'Today' },
  { key: '7d',     label: '7 Days' },
  { key: '14d',    label: '14 Days' },
  { key: '30d',    label: '30 Days' },
  { key: 'all',    label: 'All' },
  { key: 'custom', label: 'Custom' },
]

function startOfDay(d: Date) {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r
}

function filterByDate(
  campaigns: { created_at: string | null }[],
  filter: DateFilter,
  customFrom: string,
  customTo: string,
) {
  if (filter === 'all') return campaigns
  if (filter === 'custom') {
    const from = customFrom ? new Date(customFrom) : null
    const to   = customTo   ? new Date(customTo + 'T23:59:59') : null
    return campaigns.filter(c => {
      if (!c.created_at) return false
      const d = new Date(c.created_at)
      if (from && d < from) return false
      if (to   && d > to)   return false
      return true
    })
  }
  const days = filter === 'today' ? 0 : filter === '7d' ? 7 : filter === '14d' ? 14 : 30
  const cutoff = startOfDay(new Date(Date.now() - days * 86400000))
  return campaigns.filter(c => c.created_at && new Date(c.created_at) >= cutoff)
}

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

interface CampaignV2Item {
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
  enable_transcript: boolean | null
  enable_recording: boolean | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  is_imported: boolean | null
}

// Clean white minimal status chips
const STATUS_STYLE: Record<string, { chip: string; dot?: string }> = {
  completed:   { chip: 'bg-blue-50 text-blue-600 border border-blue-100' },
  interrupted: { chip: 'bg-red-50 text-red-600 border border-red-100' },
  interrupt:   { chip: 'bg-red-50 text-red-600 border border-red-100' },
  running:     { chip: 'bg-emerald-50 text-emerald-700 border border-emerald-100', dot: 'bg-emerald-400' },
  scheduled:   { chip: 'bg-blue-50 text-blue-600 border border-blue-100' },
  paused:      { chip: 'bg-amber-50 text-amber-600 border border-amber-100' },
  pending:     { chip: 'bg-gray-100 text-gray-500 border border-gray-200' },
  failed:      { chip: 'bg-red-50 text-red-600 border border-red-100' },
}

export function CampaignsPage() {
  const { t, i18n } = useTranslation()
  const statusLabel = useMemo(() => ({
    completed:   t('agora.status_completed'),
    interrupted: t('agora.status_interrupted'),
    interrupt:   t('agora.status_interrupted'),
    running:     t('agora.status_running'),
    scheduled:   t('agora.status_scheduled'),
    paused:      t('agora.status_paused'),
    pending:     t('agora.status_pending'),
    failed:      t('agora.status_failed'),
  }), [t, i18n.language])
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<CampaignV2Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [interruptingId, setInterruptingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const visibleCampaigns = useMemo(
    () => filterByDate(campaigns, dateFilter, customFrom, customTo) as CampaignV2Item[],
    [campaigns, dateFilter, customFrom, customTo],
  )

  async function loadCampaigns() {
    try {
      const dbData = await authFetch(`${API}/api/campaigns-v2`).then(r => r.json())
      setCampaigns(dbData)
      setLoading(false)
      const synced = await authFetch(`${API}/api/campaigns-v2/sync`, { method: 'POST' }).then(r => r.json())
      setCampaigns(synced)
    } catch {
      setError(t('common.server_error'))
      setLoading(false)
    }
  }

  useEffect(() => { loadCampaigns() }, [])

  useEffect(() => {
    const shouldPoll = campaigns.some(c => {
      const s = (c.status ?? '').toLowerCase()
      return s === 'running' || s === 'scheduled'
    })
    if (!shouldPoll) return
    const timer = setInterval(async () => {
      try {
        const dbData = await authFetch(`${API}/api/campaigns-v2`).then(r => r.json())
        setCampaigns(dbData)
        const synced = await authFetch(`${API}/api/campaigns-v2/sync`, { method: 'POST' }).then(r => r.json())
        setCampaigns(synced)
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(timer)
  }, [campaigns])

  async function handleInterrupt(campaignId: string) {
    setInterruptingId(campaignId)
    try {
      const resp = await authFetch(`${API}/api/campaigns-v2/${campaignId}/interrupt`, { method: 'POST' })
      if (!resp.ok) throw new Error()
      setCampaigns(prev =>
        prev.map(c => c.campaign_id === campaignId ? { ...c, status: 'interrupted' } : c)
      )
    } catch {
      alert(t('agora.interrupt_fail'))
    } finally {
      setInterruptingId(null)
    }
  }

  async function handleDelete(campaignId: string, campaignName: string) {
    if (!confirm(`確定要刪除匯入的 Campaign「${campaignName}」嗎？\n此操作將同時刪除所有相關通話記錄，且無法復原。`)) return
    setDeletingId(campaignId)
    try {
      const resp = await authFetch(`${API}/api/import/campaign/${campaignId}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error()
      setCampaigns(prev => prev.filter(c => c.campaign_id !== campaignId))
    } catch {
      alert('刪除失敗，請稍後再試')
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString(bcp47ForI18n(i18n.language), {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="glass-bar px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-medium text-gray-900">{t('agora.list_title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('agora.list_subtitle')}</p>
        </div>
        <Link
          to="/surveys/new"
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus size={16} strokeWidth={2.5} />
          {t('nav.new_campaign')}
        </Link>
      </div>

      {/* Date filter bar */}
      <div className="glass-bar px-6 py-3 flex items-center gap-2 flex-shrink-0 flex-wrap">
        {DATE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setDateFilter(f.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              dateFilter === f.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {f.key === 'custom' && <CalendarRange size={12} />}
            {f.label}
          </button>
        ))}
        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <span className="text-xs text-gray-400">—</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        )}
        <span className="ml-auto text-xs text-gray-400">{visibleCampaigns.length} campaigns</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2 text-indigo-600" />
            <span className="text-sm">{t('agora.loading')}</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">{error}</div>
        )}

        {!loading && !error && visibleCampaigns.length === 0 && (
          <div className="bg-white border border-gray-100 rounded-xl p-16 text-center shadow-sm">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
              <Radio size={28} className="text-indigo-600" />
            </div>
            <p className="text-base font-medium text-gray-900">{t('agora.empty')}</p>
            <p className="text-sm text-gray-400 mt-1">{t('agora.empty_hint')}</p>
          </div>
        )}

        {!loading && !error && visibleCampaigns.length > 0 && (
          <div className="overflow-x-auto">
          <div className="grid grid-cols-3 xl:grid-cols-5 gap-4 min-w-[640px]">
            {visibleCampaigns.map(c => {
              const status = c.status ?? 'pending'
              const isTerminal = status === 'completed' || status === 'interrupted' || status === 'interrupt' || status === 'failed'
              const total = Math.max(0, Number(c.total_numbers ?? 0))
              const done = Math.max(0, Number(c.calls_count ?? 0))
              const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
              const st = STATUS_STYLE[status] ?? STATUS_STYLE.pending

              return (
                <div
                  key={c.campaign_id}
                  className="glass-card flex flex-col overflow-hidden"
                >
                  {/* Subtle top accent strip */}
                  <div className="h-0.5" style={{
                    backgroundColor:
                      status === 'running'     ? '#059669' :
                      status === 'completed'   ? '#4F46E5' :
                      status === 'paused'      ? '#D97706' :
                      (status === 'interrupted' || status === 'interrupt' || status === 'failed')
                                               ? '#DC2626' : '#E5E7EB',
                  }} />

                  {/* Card header */}
                  <div className="px-5 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      {/* Status chip */}
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                        st.chip
                      )}>
                        {st.dot && <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', st.dot)} />}
                        {statusLabel[status as keyof typeof statusLabel] ?? status}
                      </span>
                      <div className="flex items-center gap-1">
                        {/* Delete button (imported campaigns only) */}
                        {c.is_imported && (
                          <button
                            onClick={() => handleDelete(c.campaign_id, c.campaign_name)}
                            disabled={deletingId === c.campaign_id}
                            title="刪除"
                            className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          >
                            {deletingId === c.campaign_id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Trash2 size={14} />}
                          </button>
                        )}
                        {/* Interrupt button */}
                        <button
                          onClick={() => handleInterrupt(c.campaign_id)}
                          disabled={isTerminal || interruptingId === c.campaign_id}
                          title="Interrupt"
                          className={cn(
                            'flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                            isTerminal
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-red-500 hover:bg-red-50'
                          )}
                        >
                          {interruptingId === c.campaign_id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <StopCircle size={14} />}
                        </button>
                      </div>
                    </div>

                    <h2 className="font-medium text-gray-900 text-sm leading-snug line-clamp-2 mb-0.5">
                      {c.campaign_name}
                    </h2>
                    <p className="text-xs font-mono text-gray-400 truncate">{c.campaign_id}</p>
                  </div>

                  {/* Chips row */}
                  <div className="px-5 pb-3 flex items-center gap-1.5 flex-wrap">
                    {c.questionnaire_type && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
                        {campaignAgentSourceLabel(t, c.questionnaire_type)}
                      </span>
                    )}
                    {c.quota_mode && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
                        {campaignQuotaModeLabel(t, c.quota_mode)}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="px-5 pb-3 space-y-1 text-sm text-gray-600">
                    {c.phone_number && (
                      <p className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">Caller</span>
                        <span className="font-mono font-medium text-gray-900">{c.phone_number}</span>
                      </p>
                    )}
                    {c.agent_name && (
                      <p className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">Agent</span>
                        <span className="font-medium text-gray-900">{c.agent_name}</span>
                      </p>
                    )}
                  </div>

                  {/* Progress */}
                  <div className="px-5 pb-4">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-gray-400">{t('agora.dial_progress')}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-600">{done} / {total}</span>
                        <span className={cn(
                          'font-semibold',
                          pct >= 100 ? 'text-emerald-600' : 'text-indigo-600'
                        )}>{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full overflow-hidden bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`,
                          backgroundColor: pct >= 100 ? '#059669' : '#4F46E5',
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">{formatDate(c.created_at)}</p>
                  </div>

                  {/* Actions footer */}
                  <div className="mt-auto border-t border-gray-100 grid grid-cols-2">
                    <button
                      onClick={() => navigate(`/campaigns/${c.campaign_id}`)}
                      className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors border-r border-gray-100"
                    >
                      <LayoutDashboard size={13} /> Dashboard
                    </button>
                    <button
                      onClick={() => navigate(`/campaigns/${c.campaign_id}/quota-insight`)}
                      className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-gray-600 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    >
                      <PieChart size={13} /> Quota
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
  )
}
