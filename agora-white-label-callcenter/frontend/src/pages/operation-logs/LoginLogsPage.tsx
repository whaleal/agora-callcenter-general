import { authFetch } from '../../lib/api'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { bcp47ForI18n } from '../../i18n'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')
const PAGE_SIZE = 50

interface OperationLogItem {
  id: number
  ip: string | null
  created_at: string | null
  method: string
  path: string
  action: string
  status_code: number
  success: boolean
  fail_reason: string | null
  duration_ms: number | null
  email: string | null
}

function statusStyle(success: boolean): { dot: string; text: string } {
  return success
    ? { dot: 'bg-emerald-500', text: 'text-emerald-700' }
    : { dot: 'bg-red-500', text: 'text-red-700' }
}

function fmtTs(ts: string | null, lng: string): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(bcp47ForI18n(lng))
}

export function OperationLogsPage() {
  const { t, i18n } = useTranslation()
  const [logs, setLogs] = useState<OperationLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    authFetch(`${API}/api/operation-logs?page=${page}&page_size=${PAGE_SIZE}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setLogs(data.items ?? [])
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{t('app_nav.operation_logs')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('operation_logs.subtitle', { n: total })}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">{t('agora.loading')}</span>
          </div>
        ) : error ? (
          <div className="m-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">{error}</div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-400">
            <ScrollText size={36} className="mb-3 opacity-40" />
            <p className="text-sm">{t('operation_logs.empty')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_type')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_path')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_user')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_ip')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_status')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_duration')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('operation_logs.col_time')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {logs.map(l => {
                const st = statusStyle(l.success)
                return (
                  <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      <span className="text-gray-400 mr-1">{l.method}</span>
                      {l.path}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{l.email ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-400">{l.ip ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5" title={l.fail_reason ?? undefined}>
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', st.dot)} />
                        <span className={cn('text-xs font-medium', st.text)}>
                          {l.success ? t('operation_logs.status_success') : t('operation_logs.status_fail')}
                        </span>
                        {!l.success && l.fail_reason && (
                          <span className="text-xs text-gray-400 truncate max-w-[200px]">({l.fail_reason})</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{l.duration_ms != null ? `${l.duration_ms}ms` : '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {fmtTs(l.created_at, i18n.language)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white flex-shrink-0">
          <p className="text-xs text-gray-400">
            {t('operation_logs.page_info', { page, totalPages, total })}
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
