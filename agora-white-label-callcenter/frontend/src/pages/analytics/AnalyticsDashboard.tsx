import { authFetch } from '../../lib/api'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { Loader2, PhoneCall, PhoneIncoming, PhoneOutgoing, Clock, RefreshCw, Radio, LayoutDashboard, PieChart as PieChartIcon, Bot, StopCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

// ── Types ──────────────────────────────────────────────────────────────────────

interface DailyStats {
  date: string
  total_calls: number
  answered_calls: number
  answer_rate: number
  total_duration_seconds: number
}

interface CategoryEntry {
  category: string
  count: number
}

interface Totals {
  total_calls: number
  total_answered: number
  overall_answer_rate: number
  total_duration_seconds: number
}

interface StatsData {
  daily_stats: DailyStats[]
  category_distribution: CategoryEntry[]
  totals: Totals
}

interface DirectionUsage {
  total_calls: number
  answered_calls: number
  total_duration_seconds: number
}

interface UsageData {
  by_direction?: {
    outbound?: DirectionUsage
    inbound?: DirectionUsage
  }
}

interface CampaignV2Item {
  id: number
  campaign_id: string
  campaign_name: string
  questionnaire_type: string | null
  quota_mode: string | null
  total_numbers: number | null
  calls_count: number | null
  phone_number: string | null
  agent_name: string | null
  status: string | null
  created_at: string | null
}

const CAMPAIGN_STATUS_STYLE: Record<string, { chip: string; dot?: string }> = {
  running:     { chip: 'bg-emerald-50 text-emerald-700 border border-emerald-100', dot: 'bg-emerald-400' },
  paused:      { chip: 'bg-amber-50 text-amber-600 border border-amber-100' },
  completed:   { chip: 'bg-blue-50 text-blue-600 border border-blue-100' },
  interrupted: { chip: 'bg-red-50 text-red-600 border border-red-100' },
  pending:     { chip: 'bg-gray-100 text-gray-500 border border-gray-200' },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const RANGE_OPTIONS = [
  { label: '7d',  value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 0 },
]

const PIE_COLORS = [
  '#4F46E5', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, iconBg,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  iconBg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-5 flex items-center gap-4">
      <div className={cn('p-3 rounded-xl', iconBg)}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
      No data available
    </div>
  )
}

// Tooltip: total calls
function CallsTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-gray-700">{label}</p>
      <p className="text-gray-600 mt-0.5">{payload[0].value} calls</p>
    </div>
  )
}

// Tooltip: answer rate
function RateTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-gray-700">{label}</p>
      <p className="text-gray-600 mt-0.5">{payload[0].value}%</p>
    </div>
  )
}

// Tooltip: duration (shows HH:MM:SS)
function DurationTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { payload: DailyStats }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-gray-700">{label}</p>
      <p className="text-gray-600 mt-0.5">{formatDuration(payload[0].payload.total_duration_seconds)}</p>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [stats, setStats] = useState<StatsData | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState(30)
  const [runningCampaigns, setRunningCampaigns] = useState<CampaignV2Item[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [interruptingId, setInterruptingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (range > 0) {
        const end = new Date()
        const start = new Date()
        start.setDate(start.getDate() - range)
        params.set('start_date', start.toISOString().slice(0, 10))
        params.set('end_date', end.toISOString().slice(0, 10))
      }
      const qs = params.toString()
      const [data, usageData] = await Promise.all([
        authFetch(`${API}/api/dashboard/stats`).then(r => {
          if (!r.ok) throw new Error(r.statusText)
          return r.json()
        }),
        authFetch(`${API}/api/usage${qs ? `?${qs}` : ''}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      setStats(data)
      setUsage(usageData)
    } catch (e) {
      setError(`Failed to load data: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  const loadCampaigns = useCallback(async () => {
    try {
      const data: CampaignV2Item[] = await authFetch(`${API}/api/campaigns-v2`).then(r => r.json())
      setRunningCampaigns(data.filter(c => (c.status ?? '').toLowerCase() === 'running'))
    } catch { /* ignore */ } finally {
      setCampaignsLoading(false)
    }
  }, [])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])

  useEffect(() => {
    if (runningCampaigns.length === 0) return
    const timer = setInterval(loadCampaigns, 5000)
    return () => clearInterval(timer)
  }, [runningCampaigns.length, loadCampaigns])

  async function handleInterrupt(campaignId: string) {
    setInterruptingId(campaignId)
    try {
      const resp = await authFetch(`${API}/api/campaigns-v2/${campaignId}/interrupt`, { method: 'POST' })
      if (!resp.ok) throw new Error()
      setRunningCampaigns(prev => prev.filter(c => c.campaign_id !== campaignId))
    } catch {
      alert('Failed to interrupt campaign.')
    } finally {
      setInterruptingId(null)
    }
  }

  // Apply date-range filter
  const filteredDaily = (() => {
    if (!stats) return []
    if (range === 0) return stats.daily_stats
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - range)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return stats.daily_stats.filter(d => d.date >= cutoffStr)
  })()

  // Re-compute totals from filtered days
  const ft = (() => {
    if (!filteredDaily.length) return stats?.totals ?? null
    const total_calls    = filteredDaily.reduce((s, d) => s + d.total_calls, 0)
    const total_answered = filteredDaily.reduce((s, d) => s + d.answered_calls, 0)
    const total_duration = filteredDaily.reduce((s, d) => s + d.total_duration_seconds, 0)
    return {
      total_calls,
      total_answered,
      overall_answer_rate: total_calls > 0
        ? Math.round(total_answered / total_calls * 1000) / 10
        : 0,
      total_duration_seconds: total_duration,
    }
  })()

  // Chart data: add a display label and duration_minutes for Y-axis
  const chartData = filteredDaily.map(d => ({
    ...d,
    dateLabel: shortDate(d.date),
    duration_minutes: Math.round(d.total_duration_seconds / 60),
  }))

  return (
    <div className="p-8 bg-gray-50 min-h-full space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-0.5">Call analytics overview</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Range pills */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  range === opt.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Loading / Error ─────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">Loading…</span>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">{error}</div>
      )}

      {!loading && !error && ft && (
        <>
          {/* ── Stat Cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon={PhoneCall}
              label="Total Calls"
              value={ft.total_calls.toLocaleString()}
              sub={range > 0 ? `Last ${range} days` : 'All time'}
              iconBg="bg-indigo-600"
            />
            <StatCard
              icon={PhoneIncoming}
              label="Answer Rate"
              value={`${ft.overall_answer_rate}%`}
              sub={`${ft.total_answered.toLocaleString()} answered`}
              iconBg="bg-emerald-600"
            />
            <StatCard
              icon={Clock}
              label="Total Duration"
              value={formatDuration(ft.total_duration_seconds)}
              sub="HH:MM:SS"
              iconBg="bg-violet-500"
            />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('dashboard.usage_title')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                icon={PhoneOutgoing}
                label={t('dashboard.usage_outbound')}
                value={formatDuration(usage?.by_direction?.outbound?.total_duration_seconds ?? 0)}
                sub={`${t('dashboard.usage_calls', { n: (usage?.by_direction?.outbound?.total_calls ?? 0).toLocaleString() })} · ${t('dashboard.usage_answered', { n: (usage?.by_direction?.outbound?.answered_calls ?? 0).toLocaleString() })}`}
                iconBg="bg-sky-600"
              />
              <StatCard
                icon={PhoneIncoming}
                label={t('dashboard.usage_inbound')}
                value={formatDuration(usage?.by_direction?.inbound?.total_duration_seconds ?? 0)}
                sub={`${t('dashboard.usage_calls', { n: (usage?.by_direction?.inbound?.total_calls ?? 0).toLocaleString() })} · ${t('dashboard.usage_answered', { n: (usage?.by_direction?.inbound?.answered_calls ?? 0).toLocaleString() })}`}
                iconBg="bg-teal-600"
              />
            </div>
          </div>

          {/* ── Running Campaigns ──────────────────────────────────────── */}
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="text-sm font-semibold text-gray-900">{t('dashboard.running_campaigns')}</h2>
              {!campaignsLoading && (
                <span className="ml-auto text-xs text-gray-400">
                  {t('dashboard.running_campaigns_count', { n: runningCampaigns.length })}
                </span>
              )}
            </div>

            {campaignsLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                <Loader2 size={14} className="animate-spin" />
              </div>
            ) : runningCampaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Radio size={24} className="text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">{t('dashboard.no_running_campaigns')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {runningCampaigns.map(c => {
                  const status = c.status ?? 'running'
                  const total = Math.max(0, Number(c.total_numbers ?? 0))
                  const done = Math.max(0, Number(c.calls_count ?? 0))
                  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
                  const st = CAMPAIGN_STATUS_STYLE[status] ?? CAMPAIGN_STATUS_STYLE.pending
                  return (
                    <div
                      key={c.campaign_id}
                      className="bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden"
                    >
                      <div className="h-0.5 bg-emerald-500" />
                      <div className="px-4 pt-3 pb-2">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                            st.chip
                          )}>
                            {st.dot && <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', st.dot)} />}
                            Running
                          </span>
                          <button
                            onClick={() => handleInterrupt(c.campaign_id)}
                            disabled={interruptingId === c.campaign_id}
                            title="Interrupt"
                            className="flex items-center justify-center w-7 h-7 rounded-full text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            {interruptingId === c.campaign_id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <StopCircle size={14} />}
                          </button>
                        </div>
                        <h3 className="font-medium text-gray-900 text-sm leading-snug line-clamp-2 mb-0.5">
                          {c.campaign_name}
                        </h3>
                        <p className="text-xs font-mono text-gray-400 truncate">{c.campaign_id}</p>
                      </div>

                      <div className="px-4 pb-2 space-y-0.5 text-xs">
                        {c.phone_number && (
                          <p className="flex items-center gap-2">
                            <span className="text-gray-400">Caller</span>
                            <span className="font-mono font-medium text-gray-900">{c.phone_number}</span>
                          </p>
                        )}
                        {c.agent_name && (
                          <p className="flex items-center gap-2">
                            <span className="text-gray-400">Agent</span>
                            <span className="font-medium text-gray-900">{c.agent_name}</span>
                          </p>
                        )}
                      </div>

                      <div className="px-4 pb-3">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-gray-400">Progress</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-gray-600">{done} / {total}</span>
                            <span className="font-semibold text-indigo-600">{pct}%</span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full overflow-hidden bg-gray-100">
                          <div
                            className="h-full rounded-full transition-all duration-300 bg-indigo-500"
                            style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                      </div>

                      <div className="border-t border-gray-100 grid grid-cols-3 mt-auto">
                        <button
                          onClick={() => navigate(`/campaigns/${c.campaign_id}`)}
                          className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors border-r border-gray-100"
                        >
                          <LayoutDashboard size={12} /> Detail
                        </button>
                        <button
                          onClick={() => navigate(`/campaigns/${c.campaign_id}/quota-insight`)}
                          className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 transition-colors border-r border-gray-100"
                        >
                          <PieChartIcon size={12} /> Quota
                        </button>
                        <button
                          onClick={() => navigate(`/campaigns/${c.campaign_id}/agent-prompt`)}
                          className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                        >
                          <Bot size={12} /> Prompt
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── 4-column chart grid ────────────────────────────────────── */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">

            {/* Total Calls */}
            <ChartCard title="Total Calls per Day">
              {chartData.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                    <Tooltip content={<CallsTooltip />} />
                    <Line
                      type="monotone" dataKey="total_calls" name="Total Calls"
                      stroke="#4F46E5" strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Answer Rate */}
            <ChartCard title="Answer Rate per Day">
              {chartData.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis
                      domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }}
                      tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={36}
                    />
                    <Tooltip content={<RateTooltip />} />
                    <Line
                      type="monotone" dataKey="answer_rate" name="Answer Rate"
                      stroke="#10b981" strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Duration */}
            <ChartCard title="Call Duration per Day">
              {chartData.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                      tickFormatter={v => `${v}m`} width={36}
                    />
                    <Tooltip content={<DurationTooltip />} />
                    <Line
                      type="monotone" dataKey="duration_minutes" name="Duration"
                      stroke="#8b5cf6" strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Pie — Status Distribution */}
            {stats && (
              <ChartCard title="Status Distribution">
                {stats.category_distribution.length === 0 ? <EmptyChart /> : (
                  <div className="flex flex-col items-center gap-2">
                    <ResponsiveContainer width="100%" height={110}>
                      <PieChart>
                        <Pie
                          data={stats.category_distribution}
                          dataKey="count"
                          nameKey="category"
                          cx="50%" cy="50%"
                          outerRadius={50} innerRadius={28}
                          paddingAngle={2}
                        >
                          {stats.category_distribution.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                          formatter={(value: number, name: string) => {
                            const pct = stats.totals.total_calls > 0
                              ? Math.round(value / stats.totals.total_calls * 1000) / 10
                              : 0
                            return [`${value.toLocaleString()} (${pct}%)`, name]
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="w-full space-y-1">
                      {stats.category_distribution.slice(0, 5).map((entry, i) => {
                        const pct = stats.totals.total_calls > 0
                          ? Math.round(entry.count / stats.totals.total_calls * 1000) / 10
                          : 0
                        return (
                          <div key={entry.category} className="flex items-center gap-1.5 text-xs">
                            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="text-gray-500 capitalize flex-1 truncate">{entry.category}</span>
                            <span className="text-gray-400 tabular-nums">{pct}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </ChartCard>
            )}
          </div>
        </>
      )}
    </div>
  )
}
