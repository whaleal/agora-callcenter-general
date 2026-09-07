import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BookOpen, ChevronDown, GitFork, GitCompare, Loader2, Play,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { SideBySideDiff, UnifiedDiffView } from './PromptDiff'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

interface ForkedAgent {
  agent_id: string
  agent_name: string
  at?: string
}

interface RunItem {
  id: number
  biz_date: string
  agent_id: string
  agent_name: string | null
  calls_total: number
  answered_count: number
  effective_count: number
  min_effective?: number
  status: string
  summary: string | null
  notice?: string | null
  has_suggestion: boolean
  forked_agents: ForkedAgent[]
  error: string | null
  created_at: string | null
  baseline_system_content?: string | null
  suggested_system_content?: string | null
}

interface FilterLog {
  seq: number
  stage: string
  action: string
  input_count: number
  passed_count: number
  dropped_count: number
  message: string
}

interface QcCall {
  call_id: string
  campaign_id: string | null
  db_passed: boolean
  effective: boolean
  drop_stage: string | null
  drop_reason: string | null
  transcript_score: string | null
  audio_score: string | null
  criteria_passed: boolean | null
  evidence: string | null
  duration_seconds: number | null
  call_category: string | null
}

interface AgentOpt {
  agent_id: string
  agent_name: string
}

interface DiffResult {
  left_label: string
  right_label: string
  left_text: string
  right_text: string
  unified_diff: string[]
}

const STATUS_STYLE: Record<string, string> = {
  running: 'bg-amber-50 text-amber-700 border-amber-100',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  skipped: 'bg-gray-100 text-gray-500 border-gray-200',
  failed: 'bg-red-50 text-red-600 border-red-100',
}

function yesterdayISO() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function fmtScore(raw: string | null): string {
  if (raw == null || raw === '') return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return n.toFixed(3)
}

function localizeLog(msg: string): string {
  return msg
    .replace('[库筛选]', '[DB]')
    .replace('[AI质检]', '[AI QC]')
    .replace(/当日通话 (\d+)/, 'Calls today: $1')
    .replace(/接通成功（answered）(\d+)，淘汰 (\d+)/, 'Answered: $1, dropped $2')
    .replace(/时长≥(\d+)s → (\d+)/, 'Duration ≥ $1s → $2')
    .replace(/，淘汰 (\d+)/g, ', dropped $1')
    .replace(/有转写 → (\d+)/, 'Has transcript → $1')
    .replace(/Success Criteria：「([^」]*)」/, 'Success Criteria: "$1"')
    .replace(/内容不合格 (\d+) \/ 质量不合格 (\d+) \/ 未达 Success Criteria (\d+)/, 'Failed content $1 / quality $2 / Success Criteria $3')
    .replace(/；录音未检 (\d+)/, '; audio skipped $1')
    .replace(/有效通话 (\d+)，用于生成建议/, 'Effective calls: $1 (used for suggestions)')
}

function NotesCell({ text }: { text: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!text) return <span className="text-gray-400">—</span>
  const long = text.length > 80
  return (
    <div className="max-w-md">
      <p className={cn('text-gray-600 whitespace-pre-wrap break-words', !open && 'line-clamp-2')}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          className="mt-1 text-[11px] text-blue-600 hover:underline"
        >
          {open ? t('case_study.collapse') : t('case_study.expand')}
        </button>
      )}
    </div>
  )
}

export function CaseStudyPage() {
  const { t } = useTranslation()
  const [bizDate, setBizDate] = useState('')
  const [agentId, setAgentId] = useState('')
  const [agents, setAgents] = useState<AgentOpt[]>([])
  const [runs, setRuns] = useState<RunItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [tab, setTab] = useState<'log' | 'suggest' | 'diff' | 'calls'>('log')
  const [logs, setLogs] = useState<FilterLog[]>([])
  const [calls, setCalls] = useState<QcCall[]>([])
  const [detail, setDetail] = useState<RunItem | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffRight, setDiffRight] = useState('')
  const [forkName, setForkName] = useState('')
  const [forking, setForking] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  const loadAgents = useCallback(() => {
    fetch(`${API}/api/agents`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: AgentOpt[]) => setAgents(Array.isArray(rows) ? rows : []))
      .catch(() => setAgents([]))
  }, [])

  const loadRuns = useCallback(() => {
    setLoading(true)
    setError('')
    const q = new URLSearchParams()
    if (bizDate) q.set('biz_date', bizDate)
    if (agentId) q.set('agent_id', agentId)
    q.set('limit', '100')
    fetch(`${API}/api/case-study/runs?${q}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => setRuns(data.items ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [bizDate, agentId])

  useEffect(() => { loadAgents() }, [loadAgents])
  useEffect(() => { loadRuns() }, [loadRuns])

  useEffect(() => {
    const hasRunning = runs.some(r => r.status === 'running')
    if (!hasRunning) return
    const tmr = setInterval(loadRuns, 4000)
    return () => clearInterval(tmr)
  }, [runs, loadRuns])

  async function triggerRun() {
    setRunning(true)
    setError('')
    try {
      const r = await fetch(`${API}/api/case-study/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_date: bizDate || yesterdayISO(),
          agent_id: agentId || undefined,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      await loadRuns()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function openRun(id: number) {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    setTab('log')
    setDetailLoading(true)
    setDiff(null)
    try {
      const [d, lg, cl] = await Promise.all([
        fetch(`${API}/api/case-study/runs/${id}`).then(r => r.json()),
        fetch(`${API}/api/case-study/runs/${id}/filter-log`).then(r => r.json()),
        fetch(`${API}/api/case-study/runs/${id}/calls`).then(r => r.json()),
      ])
      setDetail(d)
      setLogs(lg.items ?? [])
      setCalls(cl.items ?? [])
      setForkName(d.agent_name ? `${d.agent_name} · Case Study ${d.biz_date}` : '')
      setDiffRight(`run:${id}:suggested`)
    } finally {
      setDetailLoading(false)
    }
  }

  const otherRuns = useMemo(
    () => runs.filter(r => r.id !== openId && r.has_suggestion),
    [runs, openId],
  )

  async function loadDiff(left: string, right: string) {
    const q = new URLSearchParams({ left, right })
    const r = await fetch(`${API}/api/case-study/diff?${q}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    setDiff(await r.json())
  }

  useEffect(() => {
    if (tab !== 'diff' || !openId || !detail) return
    const left = `run:${openId}:baseline`
    const right = diffRight || `run:${openId}:suggested`
    loadDiff(left, right).catch(() => setDiff(null))
  }, [tab, openId, diffRight, detail])

  async function fork() {
    if (!openId) return
    setForking(true)
    setError('')
    try {
      const r = await fetch(`${API}/api/case-study/runs/${openId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: forkName || undefined }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`)
      await loadRuns()
      const d = await fetch(`${API}/api/case-study/runs/${openId}`).then(x => x.json())
      setDetail(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setForking(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0 gap-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{t('app_nav.case_study')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">{t('case_study.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            type="date"
            value={bizDate}
            onChange={e => setBizDate(e.target.value)}
            className="h-9 border border-gray-200 rounded-md px-2 text-sm"
          />
          <select
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            className="h-9 border border-gray-200 rounded-md px-2 text-sm max-w-[200px]"
          >
            <option value="">{t('case_study.all_agents')}</option>
            {agents.map(a => (
              <option key={a.agent_id} value={a.agent_id}>{a.agent_name}</option>
            ))}
          </select>
          <button
            onClick={triggerRun}
            disabled={running}
            className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t('case_study.run_today')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">{t('agora.loading')}</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <BookOpen size={36} className="mb-3 opacity-40" />
            <p className="text-sm">{t('case_study.empty')}</p>
            <p className="text-xs mt-1">{t('case_study.empty_hint')}</p>
          </div>
        ) : runs.map(run => {
          const open = openId === run.id
          return (
            <div key={run.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => openRun(run.id)}
                className="w-full text-left px-5 py-4 hover:bg-gray-50/80"
              >
                <div className="flex items-start gap-3">
                  <ChevronDown
                    size={16}
                    className={cn('mt-1 text-gray-400 transition-transform', open && 'rotate-180')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{run.agent_name || run.agent_id}</span>
                      <span className="text-xs text-gray-400">{run.biz_date}</span>
                      <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', STATUS_STYLE[run.status] || STATUS_STYLE.skipped)}>
                        {t(`case_study.status_${run.status}`, { defaultValue: run.status })}
                      </span>
                      {run.has_suggestion && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {t('case_study.has_suggestion')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {t('case_study.funnel', {
                        total: run.calls_total,
                        answered: run.answered_count,
                        effective: run.effective_count,
                      })}
                    </p>
                    {run.notice ? (
                      <div className="flex flex-wrap gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                        {run.notice === 'insufficient_samples' && (
                          <>
                            <span className="text-[11px] px-2.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-100">
                              {t('case_study.notice_qc_only')}
                            </span>
                            <span className="text-[11px] px-2.5 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                              {t('case_study.notice_effective', {
                                n: run.effective_count,
                                min: run.min_effective ?? 3,
                              })}
                            </span>
                          </>
                        )}
                        {run.notice === 'no_usable_calls' && (
                          <span className="text-[11px] px-2.5 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200">
                            {t('case_study.notice_no_usable')}
                          </span>
                        )}
                      </div>
                    ) : run.summary ? (
                      <p className="text-sm text-gray-700 mt-2 whitespace-pre-line line-clamp-4">{run.summary}</p>
                    ) : null}
                    {run.forked_agents?.length > 0 && (
                      <p className="text-xs text-emerald-700 mt-2">
                        {t('case_study.forked')}: {run.forked_agents.map(f => f.agent_name).join(', ')}
                      </p>
                    )}
                    {run.error && <p className="text-xs text-red-500 mt-1">{run.error}</p>}
                  </div>
                </div>
              </button>

              {open && (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50">
                  {detailLoading ? (
                    <div className="flex items-center text-gray-400 py-8 justify-center">
                      <Loader2 size={16} className="animate-spin mr-2" />
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-1 mb-4">
                        {(['log', 'suggest', 'diff', 'calls'] as const).map(k => (
                          <button
                            key={k}
                            onClick={() => setTab(k)}
                            className={cn(
                              'h-8 px-3 rounded-md text-xs font-medium',
                              tab === k ? 'bg-white border border-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800',
                            )}
                          >
                            {t(`case_study.tab_${k}`)}
                          </button>
                        ))}
                      </div>

                      {tab === 'log' && (
                        <div className="space-y-1 font-mono text-[12px] text-gray-700 bg-white border border-gray-200 rounded-lg p-3 max-h-80 overflow-auto">
                          {logs.length === 0 && <p className="text-gray-400">{t('case_study.no_log')}</p>}
                          {logs.map(l => (
                            <div key={l.seq} className="leading-5">
                              <span className="text-gray-400 mr-2">{String(l.seq).padStart(2, '0')}</span>
                              {localizeLog(l.message)}
                            </div>
                          ))}
                        </div>
                      )}

                      {tab === 'suggest' && (
                        <div className="space-y-3">
                          {detail?.notice === 'insufficient_samples' || detail?.notice === 'no_usable_calls' ? (
                            <div className="flex flex-wrap gap-1.5">
                              {detail.notice === 'insufficient_samples' && (
                                <>
                                  <span className="text-[11px] px-2.5 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-100">
                                    {t('case_study.notice_qc_only')}
                                  </span>
                                  <span className="text-[11px] px-2.5 py-0.5 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
                                    {t('case_study.notice_effective', {
                                      n: detail.effective_count,
                                      min: detail.min_effective ?? 3,
                                    })}
                                  </span>
                                </>
                              )}
                              {detail.notice === 'no_usable_calls' && (
                                <span className="text-[11px] px-2.5 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200">
                                  {t('case_study.notice_no_usable')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <pre className="text-sm text-gray-800 whitespace-pre-wrap bg-white border border-gray-200 rounded-lg p-3">
                              {detail?.summary || t('case_study.no_suggestion')}
                            </pre>
                          )}
                          {detail?.suggested_system_content && (
                            <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-white border border-gray-200 rounded-lg p-3 max-h-96 overflow-auto">
                              {detail.suggested_system_content}
                            </pre>
                          )}
                          {run.has_suggestion && (
                            <div className="flex items-center gap-2">
                              <input
                                value={forkName}
                                onChange={e => setForkName(e.target.value)}
                                className="flex-1 h-9 border border-gray-200 rounded-md px-2 text-sm bg-white"
                                placeholder={t('case_study.fork_name_ph')}
                              />
                              <button
                                onClick={fork}
                                disabled={forking}
                                className="h-9 px-3 rounded-md bg-indigo-600 text-white text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {forking ? <Loader2 size={14} className="animate-spin" /> : <GitFork size={14} />}
                                {t('case_study.fork')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {tab === 'diff' && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <GitCompare size={14} />
                            <span>{t('case_study.diff_left')}</span>
                            <select
                              value={diffRight}
                              onChange={e => setDiffRight(e.target.value)}
                              className="h-8 border border-gray-200 rounded-md px-2 text-xs bg-white"
                            >
                              <option value={`run:${run.id}:suggested`}>{t('case_study.diff_this_suggested')}</option>
                              <option value={`agent:${run.agent_id}`}>{t('case_study.diff_live_agent')}</option>
                              {otherRuns.map(o => (
                                <option key={o.id} value={`run:${o.id}:suggested`}>
                                  {o.biz_date} · {o.agent_name} #{o.id}
                                </option>
                              ))}
                            </select>
                          </div>
                          {diff ? (
                            <div className="space-y-3">
                              <SideBySideDiff
                                leftLabel={diff.left_label}
                                rightLabel={diff.right_label}
                                leftText={diff.left_text || ''}
                                rightText={diff.right_text || ''}
                              />
                              {diff.unified_diff?.length > 0 && (
                                <UnifiedDiffView lines={diff.unified_diff} />
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">{t('case_study.diff_empty')}</p>
                          )}
                        </div>
                      )}

                      {tab === 'calls' && (
                        <div className="overflow-auto max-h-96 bg-white border border-gray-200 rounded-lg">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 text-gray-400">
                              <tr>
                                <th className="px-3 py-2 text-left">{t('case_study.col_call')}</th>
                                <th className="px-3 py-2 text-left">{t('case_study.col_result')}</th>
                                <th className="px-3 py-2 text-left">{t('case_study.col_score')}</th>
                                <th className="px-3 py-2 text-left">{t('case_study.col_reason')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {calls.map(c => (
                                <tr key={c.call_id} className="border-t border-gray-100">
                                  <td className="px-3 py-2">
                                    {c.campaign_id ? (
                                      <Link className="text-blue-600 hover:underline" to={`/campaigns/${c.campaign_id}`}>
                                        {c.call_id.slice(0, 12)}…
                                      </Link>
                                    ) : c.call_id.slice(0, 12)}
                                    <div className="text-[10px] text-gray-400">{c.call_category} · {c.duration_seconds ?? '—'}s</div>
                                  </td>
                                  <td className="px-3 py-2">
                                    {c.effective ? (
                                      <span className="text-emerald-700">{t('case_study.effective')}</span>
                                    ) : (
                                      <span className="text-gray-500">{c.drop_stage}/{c.drop_reason}</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">{fmtScore(c.transcript_score)}</td>
                                  <td className="px-3 py-2 align-top">
                                    <NotesCell text={c.evidence || ''} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
