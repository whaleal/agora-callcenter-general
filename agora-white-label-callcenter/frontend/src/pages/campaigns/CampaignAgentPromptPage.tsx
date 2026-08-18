import { authFetch } from '../../lib/api'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bot, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  extractSections,
  sectionsToProps,
  JsonPropsEditor,
  type JsonSections,
  type JsonSectionErrors,
  type Agent,
} from '../agents/AgentsPage'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

export function CampaignAgentPromptPage() {
  const { t } = useTranslation()
  const { id: campaignId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [agent, setAgent] = useState<Agent | null>(null)
  const [original, setOriginal] = useState<Record<string, unknown>>({})
  const [sections, setSections] = useState<JsonSections | null>(null)
  const [sectionErrors, setSectionErrors] = useState<JsonSectionErrors>({})
  const [updating, setUpdating] = useState(false)
  const [saveError, setSaveError] = useState('')

  const load = useCallback(async () => {
    if (!campaignId) return
    setError('')
    setLoading(true)
    try {
      const cResp = await authFetch(`${API}/api/campaigns-v2/${campaignId}`)
      if (!cResp.ok) {
        setError(t('campaign_agent_prompt.err_load'))
        return
      }
      const c = await cResp.json() as { campaign_name?: string; agent_id?: string | null }
      setCampaignName(c.campaign_name ?? campaignId)
      const aid = c.agent_id
      if (!aid) {
        setError(t('campaign_agent_prompt.err_no_agent'))
        return
      }
      const agents: Agent[] = await authFetch(`${API}/api/agents`).then(r => r.json())
      const a = agents.find(x => x.agent_id === aid)
      if (!a) {
        setError(t('campaign_agent_prompt.err_agent_missing'))
        return
      }
      setAgent(a)
      const orig = (a.properties ?? {}) as Record<string, unknown>
      setOriginal(JSON.parse(JSON.stringify(orig)) as Record<string, unknown>)
      setSections(extractSections(orig))
    } catch {
      setError(t('campaign_agent_prompt.err_network'))
    } finally {
      setLoading(false)
    }
  }, [campaignId, t])

  useEffect(() => { load().catch(() => {}) }, [load])

  async function handleUpdate() {
    if (!agent || !sections) return
    setSaveError('')

    // Validate all sections
    const errors: JsonSectionErrors = {}
    let hasErrors = false
    for (const key of Object.keys(sections) as (keyof JsonSections)[]) {
      try { JSON.parse(sections[key]) } catch {
        errors[key] = 'Invalid JSON'
        hasErrors = true
      }
    }
    if (hasErrors) {
      setSectionErrors(errors)
      return
    }

    setUpdating(true)
    try {
      const rebuilt = sectionsToProps(sections, original)
      const resp = await authFetch(`${API}/api/agents/${agent.agent_id}/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rebuilt),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || t('campaign_agent_prompt.err_update'))
      }
      await resp.json()
      if (campaignId) {
        navigate(`/campaigns/${campaignId}`, { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : t('campaign_agent_prompt.err_update'))
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center text-gray-400">
        <Loader2 size={22} className="mr-2 animate-spin text-indigo-600" />
        <span className="text-sm">{t('campaign_agent_prompt.loading')}</span>
      </div>
    )
  }

  if (error || !agent || !sections) {
    return (
      <div className="p-8">
        <Link
          to={campaignId ? `/campaigns/${campaignId}` : '/'}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700"
        >
          <ArrowLeft size={15} />
          {t('agora.back')}
        </Link>
        <div className="max-w-lg rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-600">
          {error || t('campaign_agent_prompt.err_cannot_edit')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="mb-4 flex flex-shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/campaigns/${campaignId}`}
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700"
          >
            <ArrowLeft size={15} />
            {t('campaign_agent_prompt.back_campaign')}
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Bot className="h-5 w-5 text-indigo-600" />
            {t('campaign_agent_prompt.title')}
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {campaignName}
            <span className="mx-1.5 text-gray-300">·</span>
            <span className="font-mono text-xs text-gray-600">{agent.agent_name}</span>
            <span className="ml-1.5 text-xs text-gray-400">{agent.agent_id}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={updating}
          className={cn(
            'inline-flex flex-shrink-0 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors',
            updating ? 'cursor-not-allowed bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700',
          )}
        >
          {updating && <Loader2 size={16} className="animate-spin" />}
          {updating ? t('campaign_agent_prompt.updating') : t('campaign_agent_prompt.update')}
        </button>
      </div>

      <div className="mb-3 flex-shrink-0 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t('campaign_agent_prompt.sensitive_hint')}
      </div>

      {saveError && (
        <p className="mb-3 flex-shrink-0 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {saveError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <JsonPropsEditor
          sections={sections}
          errors={sectionErrors}
          onChange={(key, value) => {
            let sectionError: string | undefined
            try { JSON.parse(value) } catch { sectionError = 'Invalid JSON' }
            setSections(prev => prev ? { ...prev, [key]: value } : null)
            setSectionErrors(prev => ({ ...prev, [key]: sectionError }))
          }}
        />
      </div>
    </div>
  )
}
