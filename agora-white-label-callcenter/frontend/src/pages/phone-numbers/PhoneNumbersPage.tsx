import { authFetch } from '../../lib/api'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, PlusCircle, Trash2, PhoneCall, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { bcp47ForI18n } from '../../i18n'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

interface PhoneNumber {
  id: number
  number_id: string
  name: string
  phone_number: string
  type: string
  sip_gateway_host: string | null
  sip_signaling_port: number | null
  outbound_protocol: string | null
  created_at: string | null
}

const PROTOCOL_OPTIONS = ['udp', 'tcp', 'tls']
const TYPE_OPTIONS = ['sip_trunk']

const defaultForm = {
  name: '',
  phone_number: '',
  type: 'sip_trunk',
  sip_gateway_host: '',
  sip_signaling_port: 5060,
  outbound_protocol: 'udp',
}

export function PhoneNumbersPage() {
  const { t, i18n } = useTranslation()
  const [numbers, setNumbers] = useState<PhoneNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...defaultForm })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadNumbers() {
    try {
      // 先从数据库快速加载
      const dbData = await authFetch(`${API}/api/phone-numbers`).then(r => r.json())
      setNumbers(dbData)
      setLoading(false)

      // 同时在后台同步 Agora 列表，有新增记录时刷新
      const synced = await authFetch(`${API}/api/phone-numbers/sync`, { method: 'POST' }).then(r => r.json())
      setNumbers(synced)
    } catch {
      setError(t('common.server_error'))
      setLoading(false)
    }
  }

  useEffect(() => { loadNumbers() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim() || !form.phone_number.trim()) {
      setFormError(t('phone_numbers.form_name_phone_required'))
      return
    }
    if (!/^\+\d{7,15}$/.test(form.phone_number.trim())) {
      setFormError('Phone number must be in E.164 format, e.g. +12013040791')
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        phone_number: form.phone_number.trim(),
        type: form.type,
      }
      if (form.sip_gateway_host.trim()) payload.sip_gateway_host = form.sip_gateway_host.trim()
      if (form.sip_signaling_port) payload.sip_signaling_port = Number(form.sip_signaling_port)
      if (form.outbound_protocol) payload.outbound_protocol = form.outbound_protocol

      const resp = await authFetch(`${API}/api/phone-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(err.detail || 'Request failed')
      }
      const newRecord = await resp.json()
      setNumbers(prev => [newRecord, ...prev])
      setShowModal(false)
      setForm({ ...defaultForm })
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(numberId: string) {
    if (!confirm(t('phone_numbers.delete_confirm'))) return
    setDeletingId(numberId)
    try {
      const resp = await authFetch(`${API}/api/phone-numbers/${numberId}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error()
      setNumbers(prev => prev.filter(n => n.number_id !== numberId))
    } catch {
      alert(t('common.delete_failed'))
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString(bcp47ForI18n(i18n.language), {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="p-8 bg-gray-50 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Phone Numbers</h1>
          <p className="text-sm text-gray-600 mt-0.5">{t('phone_numbers.page_subtitle')}</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setFormError('') }}
          className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <PlusCircle size={16} />
          Add Number
        </button>
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">{error}</div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {numbers.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-12 text-center text-gray-400">
              <PhoneCall size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('phone_numbers.empty')}</p>
              <p className="text-xs mt-1">{t('phone_numbers.empty_hint')}</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Number ID</th>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Phone Number</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-left px-4 py-3">SIP_TO_Domain</th>
                    <th className="text-left px-4 py-3">SIP_Port</th>
                    <th className="text-left px-4 py-3">Protocol</th>
                    <th className="text-left px-4 py-3">Created At</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {numbers.map(n => (
                    <tr key={n.number_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{n.number_id}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{n.name}</td>
                      <td className="px-4 py-3 font-mono text-gray-600">{n.phone_number}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600">
                          {n.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{n.sip_gateway_host ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{n.sip_signaling_port ?? '—'}</td>
                      <td className="px-4 py-3">
                        {n.outbound_protocol ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 uppercase">
                            {n.outbound_protocol}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(n.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDelete(n.number_id)}
                          disabled={deletingId === n.number_id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-40"
                        >
                          {deletingId === n.number_id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Trash2 size={13} />
                          }
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Number Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Add Phone Number</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="EmbrainDemo1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Phone Number <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={form.phone_number}
                  onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                  placeholder="+12013040791"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                />
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                >
                  {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* SIP Gateway Host */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  SIP_TO_Domain (sip_gateway_host)
                </label>
                <input
                  type="text"
                  value={form.sip_gateway_host}
                  onChange={e => setForm(f => ({ ...f, sip_gateway_host: e.target.value }))}
                  placeholder="43.166.133.68"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                />
              </div>

              {/* SIP Port + Protocol (2 columns) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    SIP_Port (sip_signaling_port)
                  </label>
                  <input
                    type="number"
                    value={form.sip_signaling_port}
                    onChange={e => setForm(f => ({ ...f, sip_signaling_port: Number(e.target.value) }))}
                    placeholder="5060"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Outbound Protocol</label>
                  <select
                    value={form.outbound_protocol}
                    onChange={e => setForm(f => ({ ...f, outbound_protocol: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                  >
                    {PROTOCOL_OPTIONS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>

              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
                    submitting ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                  )}
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {submitting ? 'Adding...' : 'Add Number'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
