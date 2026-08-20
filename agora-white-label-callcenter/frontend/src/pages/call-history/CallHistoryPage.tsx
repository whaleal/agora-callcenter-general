import { authFetch } from '../../lib/api'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, PhoneCall, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { bcp47ForI18n } from '../../i18n'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')
const PAGE_SIZE = 50

interface CallItem {
  call_id: string
  campaign_id: string
  from_number: string | null
  to_number: string | null
  call_category: string | null
  hangup_reason: string | null
  duration_seconds: number | null
  call_ts: number | null
  start_ts: number | null
  end_ts: number | null
  has_transcript: boolean
  has_structured_output: boolean
}

function categoryStyle(cat: string | null): { dot: string; text: string } {
  const c = (cat ?? '').toLowerCase()
  if (c.includes('answered')) return { dot: 'bg-emerald-500', text: 'text-emerald-700' }
  if (c.includes('transferred_success') || c.includes('transfer_success')) return { dot: 'bg-green-600', text: 'text-green-700' }
  if (c.includes('transferred_failed') || c.includes('transfer_failed')) return { dot: 'bg-rose-500', text: 'text-rose-700' }
  if (c.includes('voicemail')) return { dot: 'bg-violet-500', text: 'text-violet-700' }
  if (c.includes('no_answer') || c === 'no-answer') return { dot: 'bg-amber-500', text: 'text-amber-700' }
  if (c.includes('failed') || c.includes('error')) return { dot: 'bg-red-500', text: 'text-red-700' }
  if (c.includes('ai_assistant') || c.includes('ai-assistant')) return { dot: 'bg-blue-500', text: 'text-blue-700' }
  return { dot: 'bg-slate-300', text: 'text-slate-500' }
}

function fmtDuration(s: number | null): string {
  if (s == null) return '—'
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

function fmtTs(ts: number | null, lng: string): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(bcp47ForI18n(lng))
}

export function CallHistoryPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [calls, setCalls] = useState<CallItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    authFetch(`${API}/api/calls-v2/?page=${page}&page_size=${PAGE_SIZE}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setCalls(data.items ?? [])
        setTotal(Number(data.total ?? 0))
      })
      .catch(e => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [page])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{t('app_nav.call_history')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('call_history.subtitle', { n: total })}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">{t('agora.loading')}</span>
          </div>
        ) : error ? (
          <div className="m-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">{error}</div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-400">
            <PhoneCall size={36} className="mb-3 opacity-40" />
            <p className="text-sm">{t('call_history.empty')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_from')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_to')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_category')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_hangup')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_duration')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_time')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Start Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Call ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('call_history.col_campaign')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {calls.map(c => {
                const st = categoryStyle(c.call_category)
                return (
                  <tr
                    key={c.call_id}
                    onClick={() => navigate(`/campaigns/${c.campaign_id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-gray-400">{c.from_number ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-900">{c.to_number ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', st.dot)} />
                        <span className={cn('text-xs font-medium', st.text)}>{c.call_category ?? '—'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{c.hangup_reason ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{fmtDuration(c.duration_seconds)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {fmtTs(c.call_ts, i18n.language)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {fmtTs(c.start_ts, i18n.language)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400 break-all">
                      {c.call_id}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-400 truncate max-w-[160px]">
                      {c.campaign_id}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white flex-shrink-0">
          <p className="text-xs text-gray-400">
            {t('call_history.page_info', { page, totalPages, total })}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-600 px-2">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
