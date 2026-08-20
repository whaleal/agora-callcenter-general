import { authFetch } from '../../lib/api'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Brain, Loader2, AlertCircle, ChevronLeft, CheckCircle2, Wand2, Save, Phone, Upload } from 'lucide-react'
import { cn } from '../../lib/utils'

const PHONE_RE = /^\+\d{7,15}$/

function validateCsvText(text: string): { valid: boolean; count: number; errors: string[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (!lines.length) return { valid: false, count: 0, errors: ['Empty file'] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^﻿/, ''))
  if (!headers.includes('phone_number')) return { valid: false, count: 0, errors: ['Missing column: phone_number'] }
  const idx = headers.indexOf('phone_number')
  const errors: string[] = []
  const seen = new Set<string>()
  let count = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const phone = (lines[i].split(',')[idx] ?? '').trim()
    if (!phone) { errors.push(`Row ${i + 1}: empty`); continue }
    if (!PHONE_RE.test(phone)) { errors.push(`Row ${i + 1}: invalid "${phone}"`); continue }
    if (seen.has(phone)) { errors.push(`Row ${i + 1}: duplicate "${phone}"`); continue }
    seen.add(phone); count++
  }
  return { valid: errors.length === 0, count, errors }
}

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')
const SLIDER_MAX = 500;

interface Cell {
  id: string
  area_name: string
  gender_name: string
  age_name: string
  target: number
  completed: number
  status: 'open' | 'closed'
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

function groupCells(cells: Cell[]) {
  const map = new Map<string, Map<string, Cell[]>>()
  for (const c of cells) {
    if (!map.has(c.area_name)) map.set(c.area_name, new Map())
    const gMap = map.get(c.area_name)!
    if (!gMap.has(c.gender_name)) gMap.set(c.gender_name, [])
    gMap.get(c.gender_name)!.push(c)
  }
  return map
}

export function QuotaEditorPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()

  const [cells, setCells] = useState<Cell[]>([])
  const [surveyStatus, setSurveyStatus] = useState<'draft' | 'running' | 'paused' | 'completed'>('draft')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ target_population: string; screening_rules: string[]; notes: string } | null>(null)

  const [requirements, setRequirements] = useState('')
  const [reqLoading, setReqLoading] = useState(false)
  const [reqError, setReqError] = useState('')
  const [reqResult, setReqResult] = useState<{ changed: number; created: number } | null>(null)

  const [phoneCount, setPhoneCount] = useState<number | null>(null)
  const [phoneUploading, setPhoneUploading] = useState(false)
  const [phoneUploadMsg, setPhoneUploadMsg] = useState('')
  const phoneInputRef = useRef<HTMLInputElement>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestCellsRef = useRef<Cell[]>([])

  useEffect(() => {
    Promise.all([
      authFetch(`${API}/api/surveys/${id}/quotas`).then(r => r.json()),
      authFetch(`${API}/api/surveys/${id}`).then(r => r.json()),
      authFetch(`${API}/api/surveys/${id}/phone-list/count`).then(r => r.json()),
    ])
      .then(([cellData, surveyData, phoneData]: [Cell[], { status: typeof surveyStatus }, { count: number }]) => {
        setCells(cellData)
        latestCellsRef.current = cellData
        setSurveyStatus(surveyData.status)
        setPhoneCount(phoneData.count)
      })
      .catch(() => setErrorMsg(t('common.server_error')))
      .finally(() => setLoading(false))
  }, [id, t])

  async function handlePhoneReupload(file: File) {
    const text = await file.text()
    const validation = validateCsvText(text)
    if (!validation.valid) {
      setPhoneUploadMsg('✗ ' + validation.errors[0] + (validation.errors.length > 1 ? ` (+${validation.errors.length - 1})` : ''))
      return
    }
    setPhoneUploading(true)
    setPhoneUploadMsg('')
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await authFetch(`${API}/api/surveys/${id}/phone-list`, { method: 'POST', body: form })
      if (!resp.ok) throw new Error()
      setPhoneCount(validation.count)
      setPhoneUploadMsg(t('quota_editor.phone_list_upload_ok', { n: validation.count }))
    } catch {
      setPhoneUploadMsg(t('common.error_occurred'))
    } finally {
      setPhoneUploading(false)
    }
  }

  const saveCells = useCallback(async (toSave: Cell[]) => {
    setSaveState('saving')
    try {
      const resp = await authFetch(`${API}/api/surveys/${id}/quotas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSave.map(c => ({ id: c.id, target: c.target }))),
      })
      if (!resp.ok) throw new Error()
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')
    }
  }, [id])

  function handleTargetChange(cellId: string, value: string) {
    const n = parseInt(value, 10)
    if (isNaN(n) || n < 0) return
    const updated = cells.map(c => c.id === cellId ? { ...c, target: n } : c)
    setCells(updated)
    latestCellsRef.current = updated
    setSaveState('pending')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveCells(latestCellsRef.current), 800)
  }

  async function handleAiSuggest() {
    setAiLoading(true)
    setAiResult(null)
    setErrorMsg('')
    try {
      const resp = await authFetch(`${API}/api/surveys/${id}/quotas/ai-suggest`, { method: 'POST' })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || t('common.error_occurred'))
      }
      const data = await resp.json()
      setAiResult({
        target_population: data.target_population,
        screening_rules: data.screening_rules,
        notes: data.notes,
      })
      const fresh = await authFetch(`${API}/api/surveys/${id}/quotas`).then(r => r.json())
      setCells(fresh)
      latestCellsRef.current = fresh
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('common.error_occurred'))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleApplyRequirements() {
    if (!requirements.trim()) return
    setReqLoading(true)
    setReqError('')
    setReqResult(null)

    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 65_000)

    try {
      const resp = await authFetch(`${API}/api/surveys/${id}/quotas/ai-requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirements }),
        signal: ctrl.signal,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || t('common.error_occurred'))
      }
      const updated: Cell[] = await resp.json()

      // 기존 셀과 비교: 업데이트된 셀 vs 새로 생성된 셀
      const prevIds = new Set(cells.map(c => c.id))
      const prevTargetMap = Object.fromEntries(cells.map(c => [c.id, c.target]))
      const created = updated.filter(c => !prevIds.has(c.id)).length
      const changed = updated.filter(c => prevIds.has(c.id) && prevTargetMap[c.id] !== c.target).length

      setCells(updated)
      latestCellsRef.current = updated
      setReqResult({ changed, created })
      if (changed > 0 || created > 0) {
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2000)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        setReqError(t('common.timeout_error'))
      } else {
        setReqError(e instanceof Error ? e.message : t('common.error_occurred'))
      }
    } finally {
      clearTimeout(timeoutId)
      setReqLoading(false)
    }
  }

  const grouped = groupCells(cells)
  const totalTarget = cells.reduce((s, c) => s + c.target, 0)
  const totalCompleted = cells.reduce((s, c) => s + c.completed, 0)

  return (
    <div className="p-8 max-w-5xl bg-gray-50 min-h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('quota_editor.title')}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('quota_editor.cell_count', { count: cells.length })} · {t('quota_editor.target_total', { n: totalTarget })} · {t('quota_editor.completed_total', { n: totalCompleted })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {saveState === 'pending' && <span className="text-gray-400">{t('common.changed')}</span>}
          {saveState === 'saving' && <span className="flex items-center gap-1 text-gray-400"><Loader2 size={11} className="animate-spin" /> {t('common.saving')}</span>}
          {saveState === 'saved' && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> {t('common.saved')}</span>}
          {saveState === 'error' && <span className="flex items-center gap-1 text-red-600"><AlertCircle size={12} /> {t('common.save_failed')}</span>}
          {saveState === 'idle' && cells.length > 0 && (
            <button
              onClick={() => saveCells(cells)}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Save size={11} /> {t('common.save')}
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">
          <AlertCircle size={14} /> {errorMsg}
        </div>
      )}

      {/* Phone List */}
      <div className="mb-4 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Phone size={14} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-700">{t('quota_editor.phone_list_title')}</span>
            {phoneCount !== null && (
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                phoneCount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
              )}>
                {phoneCount > 0
                  ? t('quota_editor.phone_list_count', { n: phoneCount })
                  : t('quota_editor.phone_list_empty')}
              </span>
            )}
            {phoneUploadMsg && (
              <span className={cn('text-xs', phoneUploadMsg.startsWith('✗') ? 'text-red-600' : 'text-emerald-600')}>
                {phoneUploadMsg}
              </span>
            )}
          </div>
          <button
            onClick={() => phoneInputRef.current?.click()}
            disabled={phoneUploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {phoneUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {t('quota_editor.phone_list_reupload')}
          </button>
          <input
            ref={phoneInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoneReupload(f); e.target.value = '' }}
          />
        </div>
      </div>

      {/* AI 추천 패널 */}
      <div className="mb-5 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t('quota_editor.ai_suggest_title')}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t('quota_editor.ai_suggest_desc')}</p>
          </div>
          <button
            onClick={handleAiSuggest}
            disabled={aiLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors flex-shrink-0"
          >
            {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
            {aiLoading ? t('quota_editor.btn_ai_analyzing') : cells.length > 0 ? t('quota_editor.btn_ai_re_suggest') : t('quota_editor.btn_ai_suggest')}
          </button>
        </div>

        {aiResult && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
            <p className="text-xs text-indigo-700">
              <span className="font-medium">{t('quota_editor.label_target_pop')}:</span> {aiResult.target_population}
            </p>
            {aiResult.screening_rules.length > 0 && (
              <div className="text-xs text-gray-600">
                <span className="font-medium text-gray-700">{t('quota_editor.label_screening')}</span>
                <ul className="mt-0.5 space-y-0.5">
                  {aiResult.screening_rules.map((r, i) => (
                    <li key={i} className="flex gap-1.5"><span className="text-gray-400">·</span>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {aiResult.notes && (
              <p className="text-xs text-amber-600 flex gap-1.5 items-start">
                <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />{aiResult.notes}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 고객 요구사항 */}
      <div className="mb-5 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-900 mb-1">{t('quota_editor.req_title')}</p>
        <p className="text-xs text-gray-400 mb-3">{t('quota_editor.req_desc')}</p>
        <textarea
          value={requirements}
          onChange={e => setRequirements(e.target.value)}
          placeholder={t('quota_editor.req_placeholder')}
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white resize-none"
        />
        {reqError && (
          <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{reqError}</p>
        )}
        {reqResult && !reqError && (
          reqResult.changed > 0 || reqResult.created > 0 ? (
            <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle2 size={11} />
              {reqResult.created > 0 && reqResult.changed > 0
                ? t('quota_editor.req_changed_and_created', {
                    changed: reqResult.changed,
                    created: reqResult.created,
                  })
                : reqResult.created > 0
                  ? t('quota_editor.req_created', { n: reqResult.created })
                  : t('quota_editor.req_changed', { n: reqResult.changed })
              }
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle size={11} />
              {t('quota_editor.req_no_change')}
            </p>
          )
        )}
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleApplyRequirements}
            disabled={reqLoading || !requirements.trim() || cells.length === 0}
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {reqLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {reqLoading ? t('quota_editor.btn_applying') : t('quota_editor.btn_apply')}
          </button>
        </div>
      </div>

      {/* Quota matrix */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">{t('common.loading_data')}</span>
        </div>
      ) : cells.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center text-gray-400 text-sm shadow-sm">
          <Brain size={32} className="mx-auto mb-3 opacity-30" />
          <p>{t('quota_editor.empty_title')}</p>
          <p className="text-xs mt-1">{t('quota_editor.empty_hint')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from(grouped.entries()).map(([areaName, genderMap]) => (
            <div key={areaName} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">{areaName}</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {Array.from(genderMap.entries()).map(([genderName, ageCells]) => (
                  <div key={genderName} className="p-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">{genderName}</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {ageCells.map(cell => {
                        const sliderMax = Math.max(SLIDER_MAX, cell.target);
                        const completedPct = sliderMax > 0
                          ? Math.min(100, (cell.completed / sliderMax) * 100)
                          : 0;
                        const targetPct = sliderMax > 0
                          ? Math.min(100, (cell.target / sliderMax) * 100)
                          : 0;
                        // Track: green=completed · blue=remaining-to-target · gray=beyond
                        const trackBg = `linear-gradient(to right,
                          #22c55e 0%, #22c55e ${completedPct}%,
                          #93c5fd ${completedPct}%, #93c5fd ${targetPct}%,
                          #e2e8f0 ${targetPct}%, #e2e8f0 100%)`;

                        return (
                          <div key={cell.id} className={cn(
                            'rounded-lg border p-3 flex flex-col gap-2',
                            cell.status === 'closed' ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'
                          )}>
                            {/* Header: age label + completed/target */}
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs text-gray-600 font-medium truncate min-w-0">{cell.age_name}</p>
                              <span className={cn(
                                'text-[10px] font-semibold flex-shrink-0',
                                cell.status === 'closed' ? 'text-emerald-600' : 'text-gray-400'
                              )}>
                                {cell.completed}/{cell.target}
                              </span>
                            </div>

                            {/* Single slider: gradient track encodes progress + target */}
                            <input
                              type="range"
                              min={0}
                              max={sliderMax}
                              step={1}
                              value={cell.target}
                              onChange={e => handleTargetChange(cell.id, e.target.value)}
                              disabled={cell.status === 'closed'}
                              className="quota-slider"
                              style={{ background: trackBg }}
                            />

                            {/* Number input: target */}
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400 flex-shrink-0">목표</span>
                              <input
                                type="number"
                                value={cell.target}
                                onChange={e => handleTargetChange(cell.id, e.target.value)}
                                disabled={cell.status === 'closed'}
                                className="w-full text-xs border border-gray-200 rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:bg-transparent text-gray-700 min-w-0 bg-white"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {cells.length > 0 && (
        <div className="mt-6 flex justify-between items-center">
          <p className="text-xs text-gray-400">{t('quota_editor.autosave_hint')}</p>
          {surveyStatus === 'draft' ? (
            <span
              title={t('quota_editor.dashboard_locked_hint')}
              className="inline-flex items-center gap-2 px-5 py-2 bg-gray-100 text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed select-none"
            >
              {t('quota_editor.to_dashboard')}
            </span>
          ) : (
            <Link
              to={`/surveys/${id}/dashboard`}
              className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              {t('quota_editor.to_dashboard')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
