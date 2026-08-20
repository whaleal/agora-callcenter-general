import { authFetch } from '../../lib/api'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { StatusBadge, TypeBadge } from '../../components/ui/Badge'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { PlusCircle, LayoutDashboard, SlidersHorizontal, Sparkles, Loader2, Trash2, LayoutList, LayoutGrid, Copy } from 'lucide-react'
import { cn } from '../../lib/utils'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

interface SurveyAPI {
  id: string
  name: string
  type: 'CATI' | 'URL'
  status: 'draft' | 'running' | 'paused' | 'completed'
  quota_mode: string
  total_target: number
  total_completed: number
  created_at: string
}

export function SurveyListPage() {
  const { t } = useTranslation()
  const [surveys, setSurveys] = useState<SurveyAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [duplicateModal, setDuplicateModal] = useState<{ id: string; defaultName: string } | null>(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')

  useEffect(() => {
    authFetch(`${API}/api/surveys`)
      .then(r => r.json())
      .then(setSurveys)
      .catch(() => setError(t('common.server_error')))
      .finally(() => setLoading(false))
  }, [t])

  function openDuplicateModal(survey: SurveyAPI) {
    const base = survey.name.replace(/ \(\d+\)$/, '')
    const existing = new Set(surveys.map(s => s.name))
    let n = 2
    while (existing.has(`${base} (${n})`)) n++
    const suggested = `${base} (${n})`
    setDuplicateName(suggested)
    setDuplicateModal({ id: survey.id, defaultName: suggested })
  }

  async function confirmDuplicate() {
    if (!duplicateModal) return
    const name = duplicateName.trim()
    if (!name) return
    setDuplicatingId(duplicateModal.id)
    setDuplicateModal(null)
    try {
      const resp = await authFetch(`${API}/api/surveys/${duplicateModal.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!resp.ok) throw new Error()
      const newSurvey = await resp.json()
      setSurveys(prev => [newSurvey, ...prev])
    } catch {
      setError(t('common.error_occurred'))
    } finally {
      setDuplicatingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('survey_list.confirm_delete'))) return
    setDeletingId(id)
    try {
      const resp = await authFetch(`${API}/api/surveys/${id}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error()
      setSurveys(prev => prev.filter(s => s.id !== id))
    } catch {
      setError(t('common.error_occurred'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-medium text-gray-900">{t('survey_list.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{t('survey_list.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
                viewMode === 'list' ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <LayoutList size={15} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
                viewMode === 'grid' ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
          <Link
            to="/surveys/new"
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <PlusCircle size={16} />
            {t('survey_list.new_campaign')}
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2 text-indigo-600" />
          <span className="text-sm">{t('common.loading_data')}</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">{error}</div>
      )}

      {!loading && !error && surveys.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center shadow-sm">
          <p className="text-sm text-gray-600">{t('survey_list.empty')}</p>
          <p className="text-xs mt-1 text-gray-400">{t('survey_list.empty_hint')}</p>
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="grid gap-4">
          {surveys.map(survey => (
            <div key={survey.id} className="bg-white border border-gray-100 rounded-xl p-5 hover:border-indigo-200 transition-colors shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type={survey.type} />
                    <StatusBadge status={survey.status} />
                  </div>
                  <h2 className="font-semibold text-gray-900 truncate">{survey.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t('survey_list.created')}: {new Date(survey.created_at).toLocaleDateString()} · {t('survey_list.quota_mode')}: {survey.quota_mode}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link
                    to={`/surveys/${survey.id}/prompt`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                  >
                    <Sparkles size={13} />
                    {t('survey_list.btn_prompt')}
                  </Link>
                  <Link
                    to={`/surveys/${survey.id}/quotas`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <SlidersHorizontal size={13} />
                    {t('survey_list.btn_quota')}
                  </Link>
                  {survey.status !== 'draft' && (
                    <Link
                      to={`/surveys/${survey.id}/dashboard`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <LayoutDashboard size={13} />
                      {t('survey_list.btn_dashboard')}
                    </Link>
                  )}
                  <button
                    onClick={() => openDuplicateModal(survey)}
                    disabled={!!duplicatingId}
                    title={t('survey_list.btn_duplicate')}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
                  >
                    {duplicatingId === survey.id ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                  </button>
                  <button
                    onClick={() => handleDelete(survey.id)}
                    disabled={deletingId === survey.id}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                  >
                    {deletingId === survey.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <ProgressBar completed={survey.total_completed} target={survey.total_target} size="sm" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Duplicate name modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDuplicateModal(null)}>
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">{t('survey_list.duplicate_modal_title')}</h3>
            <p className="text-xs text-gray-400 mb-4">{t('survey_list.duplicate_modal_desc')}</p>
            <input
              type="text"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white mb-4"
              value={duplicateName}
              onChange={e => setDuplicateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmDuplicate(); if (e.key === 'Escape') setDuplicateModal(null) }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDuplicateModal(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDuplicate}
                disabled={!duplicateName.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40"
              >
                {t('survey_list.btn_duplicate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid view */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {surveys.map(survey => (
            <div key={survey.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-indigo-200 transition-colors shadow-sm flex flex-col gap-3">
              {/* Top: badges + actions */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <TypeBadge type={survey.type} />
                  <StatusBadge status={survey.status} />
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openDuplicateModal(survey)}
                    disabled={!!duplicatingId}
                    title={t('survey_list.btn_duplicate')}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-300 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
                  >
                    {duplicatingId === survey.id ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={() => handleDelete(survey.id)}
                    disabled={deletingId === survey.id}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                  >
                    {deletingId === survey.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              </div>

              {/* Name */}
              <div>
                <h2 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{survey.name}</h2>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(survey.created_at).toLocaleDateString()} · {survey.quota_mode}
                </p>
              </div>

              {/* Progress */}
              <ProgressBar completed={survey.total_completed} target={survey.total_target} size="sm" />

              {/* Actions */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100">
                <Link
                  to={`/surveys/${survey.id}/prompt`}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                >
                  <Sparkles size={12} />
                  {t('survey_list.btn_prompt')}
                </Link>
                <Link
                  to={`/surveys/${survey.id}/quotas`}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <SlidersHorizontal size={12} />
                  {t('survey_list.btn_quota')}
                </Link>
                {survey.status !== 'draft' && (
                  <Link
                    to={`/surveys/${survey.id}/dashboard`}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <LayoutDashboard size={12} />
                    {t('survey_list.btn_dashboard')}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
