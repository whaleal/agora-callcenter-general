import { authFetch } from '../../lib/api'
import { useState, useRef, useEffect } from 'react'
import { Upload, CloudUpload, Play, Square, RefreshCw, CheckCircle2, XCircle, Loader2, FileText, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

interface ImportResult {
  campaigns_created: number
  calls_created: number
  calls_skipped: number
}

interface MigStatus {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped' | 'stopping'
  total: number
  done: number
  failed: number
  errors: string[]
  current_call_id: string
  pending?: number
  log?: string[]
}

export function ImportPage() {
  // ── CSV import state ──────────────────────────────────────────────────────
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // ── audio migration state ─────────────────────────────────────────────────
  const [mig, setMig] = useState<MigStatus>({
    status: 'idle', total: 0, done: 0, failed: 0, errors: [], current_call_id: '',
  })
  const [migLoading, setMigLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // poll status while running
  useEffect(() => {
    if (mig.status === 'running') {
      pollRef.current = setInterval(async () => {
        try {
          const s: MigStatus = await authFetch(`${API}/api/import/migrate-audio/status`).then(r => r.json())
          setMig(s)
          if (s.status !== 'running') clearInterval(pollRef.current!)
        } catch { /* ignore */ }
      }, 2000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [mig.status])

  // fetch initial migration status on mount
  useEffect(() => {
    authFetch(`${API}/api/import/migrate-audio/status`)
      .then(r => r.json())
      .then((s: MigStatus) => setMig(s))
      .catch(() => {})
  }, [])

  // auto-scroll log to bottom when new lines arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [mig.log?.length])

  // ── CSV handlers ──────────────────────────────────────────────────────────
  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && f.name.endsWith('.csv')) setCsvFile(f)
  }

  async function handleImport() {
    if (!csvFile) return
    setImporting(true)
    setImportError('')
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', csvFile)
      const resp = await authFetch(`${API}/api/import/campaign-csv`, { method: 'POST', body: fd })
      if (!resp.ok) {
        const contentType = resp.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const err = await resp.json()
          throw new Error(err.detail ?? `Import failed (${resp.status})`)
        }
        throw new Error(resp.status === 413 ? 'File too large — please split the CSV into smaller chunks' : `Import failed (${resp.status})`)
      }
      const result: ImportResult = await resp.json()
      setImportResult(result)
      setCsvFile(null)
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // ── migration handlers ────────────────────────────────────────────────────
  async function startMigration() {
    setMigLoading(true)
    try {
      const s: MigStatus = await authFetch(`${API}/api/import/migrate-audio/start`, { method: 'POST' }).then(r => r.json())
      setMig(s)
    } catch { /* ignore */ } finally {
      setMigLoading(false)
    }
  }

  async function stopMigration() {
    setMigLoading(true)
    try {
      const s: MigStatus = await authFetch(`${API}/api/import/migrate-audio/stop`, { method: 'POST' }).then(r => r.json())
      setMig(s)
    } catch { /* ignore */ } finally {
      setMigLoading(false)
    }
  }

  async function refreshStatus() {
    try {
      const s: MigStatus = await authFetch(`${API}/api/import/migrate-audio/status`).then(r => r.json())
      setMig(s)
    } catch { /* ignore */ }
  }

  const migPct = mig.total > 0 ? Math.min(100, Math.round(((mig.done + mig.failed) / mig.total) * 100)) : 0
  const migRunning = mig.status === 'running'

  const statusColor: Record<string, string> = {
    idle:     'text-gray-400',
    running:  'text-emerald-600',
    done:     'text-indigo-600',
    error:    'text-red-500',
    stopped:  'text-amber-500',
    stopping: 'text-amber-500',
  }
  const statusLabel: Record<string, string> = {
    idle:     'Idle',
    running:  'Running…',
    done:     'Done',
    error:    'Error',
    stopped:  'Stopped',
    stopping: 'Stopping…',
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="glass-bar px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Import &amp; Migration</h1>
          <p className="text-sm text-gray-400 mt-0.5">Import campaigns from CSV or migrate audio recordings to S3</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* ── CSV Import ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <FileText size={16} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Import Campaign CSV</h2>
              <p className="text-xs text-gray-400">Upload a CSV file to create campaigns and call records</p>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                dragging
                  ? 'border-indigo-400 bg-indigo-50'
                  : csvFile
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/50',
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) setCsvFile(e.target.files[0]) }}
              />
              {csvFile ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 size={32} className="text-emerald-500" />
                  <p className="text-sm font-medium text-emerald-700">{csvFile.name}</p>
                  <p className="text-xs text-emerald-500">{(csvFile.size / 1024).toFixed(1)} KB — ready to import</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload size={28} className="text-gray-300" />
                  <p className="text-sm font-medium text-gray-600">Drop CSV file here or click to browse</p>
                  <p className="text-xs text-gray-400">Supports UTF-8, UTF-8 BOM, and GBK encodings</p>
                </div>
              )}
            </div>

            {/* Expected columns hint */}
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-medium text-gray-500 mb-1.5">Expected CSV columns</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Campaign ID', 'Campaign Name', 'Call ID', 'Agent ID', 'Agent Name',
                  'From Number', 'To Number', 'Call Start Time', 'Answered Time',
                  'Duration (seconds)', 'Call Category', 'Hangup Reason', 'Channel',
                  'Transcript', 'Structured Output', 'Audio Record File Download URL',
                ].map(col => (
                  <span key={col} className="inline-flex px-2 py-0.5 bg-white border border-gray-200 rounded-md text-[11px] font-mono text-gray-500">
                    {col}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleImport}
                disabled={!csvFile || importing}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  csvFile && !importing
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed',
                )}
              >
                {importing
                  ? <><Loader2 size={15} className="animate-spin" /> Importing…</>
                  : <><CloudUpload size={15} /> Import CSV</>}
              </button>
              {csvFile && !importing && (
                <button
                  onClick={() => { setCsvFile(null); setImportResult(null); setImportError('') }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  <Trash2 size={14} /> Clear
                </button>
              )}
            </div>

            {/* Result */}
            {importResult && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-800">
                  <p className="font-medium mb-1">Import complete</p>
                  <ul className="space-y-0.5 text-xs">
                    <li>Campaigns created: <span className="font-mono font-semibold">{importResult.campaigns_created}</span></li>
                    <li>Calls created: <span className="font-mono font-semibold">{importResult.calls_created}</span></li>
                    <li>Calls skipped (duplicates): <span className="font-mono font-semibold">{importResult.calls_skipped}</span></li>
                  </ul>
                </div>
              </div>
            )}
            {importError && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
                <XCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{importError}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Audio Migration ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center">
              <CloudUpload size={16} className="text-sky-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Migrate Audio to S3</h2>
              <p className="text-xs text-gray-400">Re-upload call recordings from temporary URLs to your AWS S3 bucket</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Status row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {migRunning && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                <span className={cn('text-sm font-medium', statusColor[mig.status] ?? 'text-gray-400')}>
                  {statusLabel[mig.status] ?? mig.status}
                </span>
                {mig.current_call_id && (
                  <span className="text-xs font-mono text-gray-400 truncate max-w-[240px]">
                    · {mig.current_call_id}
                  </span>
                )}
              </div>
              <button
                onClick={refreshStatus}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Refresh status"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Progress */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              {/* Counts row */}
              <div className="flex items-center justify-between">
                {mig.status === 'idle' ? (
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-gray-400 mb-0.5">待 Migrate</span>
                      <span className="font-mono font-semibold text-gray-900 text-lg">
                        {mig.pending ?? '—'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-gray-400 mb-0.5">已完成</span>
                      <span className="font-mono font-semibold text-emerald-600 text-lg">{mig.done}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[11px] text-gray-400 mb-0.5">總數</span>
                      <span className="font-mono font-semibold text-gray-900 text-lg">{mig.total}</span>
                    </div>
                    {mig.failed > 0 && (
                      <div className="flex flex-col">
                        <span className="text-[11px] text-gray-400 mb-0.5">失敗</span>
                        <span className="font-mono font-semibold text-red-500 text-lg">{mig.failed}</span>
                      </div>
                    )}
                  </div>
                )}
                <span className="font-mono text-sm text-gray-400">{migPct}%</span>
              </div>

              {/* Bar */}
              <div className="h-2.5 w-full rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: mig.status === 'idle' ? '0%' : `${migPct}%`,
                    backgroundColor: mig.failed > 0 ? '#F59E0B' : mig.status === 'done' ? '#059669' : '#0EA5E9',
                  }}
                />
              </div>

              {mig.current_call_id && (
                <p className="text-[11px] font-mono text-gray-400 truncate">
                  處理中：{mig.current_call_id}
                </p>
              )}
            </div>

            {/* Log */}
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 border-b border-gray-200">
                <span className="text-[11px] font-medium text-gray-500 tracking-wide">Migration Log</span>
                {(mig.log?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-gray-400 font-mono">{mig.log!.length} 行</span>
                )}
              </div>
              <div
                ref={logRef}
                className="h-48 overflow-y-auto bg-gray-950 p-3 space-y-0.5 font-mono text-[11px] leading-relaxed"
              >
                {(mig.log?.length ?? 0) === 0 ? (
                  <span className="text-gray-600">尚無記錄，點擊 Start Migration 開始…</span>
                ) : (
                  mig.log!.map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        'whitespace-pre-wrap break-all',
                        line.startsWith('[OK]')    ? 'text-emerald-400' :
                        line.startsWith('[ERROR]') ? 'text-red-400' :
                        line.startsWith('[停止]')  ? 'text-amber-400' :
                        line.startsWith('[完成]')  ? 'text-sky-400' :
                        'text-gray-400'
                      )}
                    >
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              {!migRunning ? (
                <button
                  onClick={startMigration}
                  disabled={migLoading}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    migLoading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-sky-600 text-white hover:bg-sky-700',
                  )}
                >
                  {migLoading
                    ? <><Loader2 size={15} className="animate-spin" /> Starting…</>
                    : <><Play size={15} /> Start Migration</>}
                </button>
              ) : (
                <button
                  onClick={stopMigration}
                  disabled={migLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  {migLoading
                    ? <><Loader2 size={15} className="animate-spin" /> Stopping…</>
                    : <><Square size={14} fill="white" /> Stop</>}
                </button>
              )}
            </div>

            {/* Info box */}
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 text-xs text-sky-800 space-y-1">
              <p className="font-medium">How it works</p>
              <ul className="list-disc list-inside space-y-0.5 text-sky-700">
                <li>Finds all calls whose recording URL is still a temporary http(s) link</li>
                <li>Downloads each recording and uploads it to your configured S3 bucket</li>
                <li>Updates the database to point to the permanent <span className="font-mono">s3://…</span> URI</li>
                <li>Configure <span className="font-mono">AWS_S3_BUCKET</span>, <span className="font-mono">AWS_S3_REGION</span>, and keys in Settings</li>
              </ul>
            </div>

            {/* Error list */}
            {mig.errors.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                <p className="text-xs font-medium text-red-700 mb-2">Errors ({mig.errors.length})</p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {mig.errors.map((e, i) => (
                    <li key={i} className="text-xs font-mono text-red-600 break-all">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
