import { cn } from '../../lib/utils'

type Kind = 'same' | 'del' | 'add' | 'change'

export interface DiffRow {
  kind: Kind
  left: string | null
  right: string | null
}

const DP_CELL_LIMIT = 400_000

function tokenize(s: string): string[] {
  return s.split(/(\s+|[A-Za-z0-9_]+|[\u4e00-\u9fff])/).filter(t => t.length > 0)
}

function tokenMarks(from: string, to: string, side: 'del' | 'add'): boolean[] {
  const a = tokenize(from)
  const b = tokenize(to)
  const n = a.length
  const m = b.length
  if (!n || !m || n * m > 80_000) {
    return (side === 'del' ? a : b).map(() => true)
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const keepA = Array(n).fill(false)
  const keepB = Array(m).fill(false)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepA[i] = true
      keepB[j] = true
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return side === 'del' ? keepA.map(k => !k) : keepB.map(k => !k)
}

function InlineTokens({
  text,
  other,
  side,
}: {
  text: string
  other: string | null
  side: 'del' | 'add'
}) {
  if (other == null || other === text) return <>{text}</>
  const src = tokenize(text)
  const marks = tokenMarks(
    side === 'del' ? text : other,
    side === 'del' ? other : text,
    side,
  )
  const flag = src.length === marks.length ? marks : src.map(() => true)
  return (
    <>
      {src.map((tok, idx) => (
        <span
          key={idx}
          className={cn(
            flag[idx] && side === 'del' && 'bg-red-200/90 rounded-[2px]',
            flag[idx] && side === 'add' && 'bg-emerald-200/90 rounded-[2px]',
          )}
        >
          {tok}
        </span>
      ))}
    </>
  )
}

function lcsAlign(a: string[], b: string[]): DiffRow[] {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map(line => ({ kind: 'add' as const, left: null, right: line }))
  if (m === 0) return a.map(line => ({ kind: 'del' as const, left: line, right: null }))
  if (n * m > DP_CELL_LIMIT) {
    const rows: DiffRow[] = a.map(line => ({ kind: 'del' as const, left: line, right: null }))
    for (const line of b) rows.push({ kind: 'add', left: null, right: line })
    return rows
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? (dp[i + 1][j + 1] + 1)
        : dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1]
    }
  }
  const raw: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: 'same', left: a[i], right: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ kind: 'del', left: a[i], right: null })
      i++
    } else {
      raw.push({ kind: 'add', left: null, right: b[j] })
      j++
    }
  }
  while (i < n) {
    raw.push({ kind: 'del', left: a[i], right: null })
    i++
  }
  while (j < m) {
    raw.push({ kind: 'add', left: null, right: b[j] })
    j++
  }
  return packChanges(raw)
}

function packChanges(raw: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i].kind !== 'del') {
      out.push(raw[i])
      i++
      continue
    }
    let d0 = i
    while (i < raw.length && raw[i].kind === 'del') i++
    const dels = raw.slice(d0, i)
    let a0 = i
    while (i < raw.length && raw[i].kind === 'add') i++
    const adds = raw.slice(a0, i)
    if (adds.length === 0) {
      out.push(...dels)
      continue
    }
    const paired = Math.min(dels.length, adds.length)
    for (let k = 0; k < paired; k++) {
      out.push({
        kind: dels[k].left === adds[k].right ? 'same' : 'change',
        left: dels[k].left,
        right: adds[k].right,
      })
    }
    out.push(...dels.slice(paired))
    out.push(...adds.slice(paired))
  }
  return out
}

export function alignLines(leftText: string, rightText: string): DiffRow[] {
  const a = (leftText || '').split('\n')
  const b = (rightText || '').split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--
    bEnd--
  }
  const rows: DiffRow[] = []
  for (let i = 0; i < start; i++) rows.push({ kind: 'same', left: a[i], right: b[i] })
  rows.push(...lcsAlign(a.slice(start, aEnd), b.slice(start, bEnd)))
  const tail = a.length - aEnd
  for (let i = 0; i < tail; i++) {
    rows.push({ kind: 'same', left: a[aEnd + i], right: b[bEnd + i] })
  }
  return rows
}

function SideCell({
  row,
  side,
}: {
  row: DiffRow
  side: 'left' | 'right'
}) {
  const text = side === 'left' ? row.left : row.right
  const empty = text == null
  const isDel = !empty && (row.kind === 'del' || (row.kind === 'change' && side === 'left'))
  const isAdd = !empty && (row.kind === 'add' || (row.kind === 'change' && side === 'right'))
  const sign = isDel ? '−' : isAdd ? '+' : ' '
  return (
    <>
      <td
        className={cn(
          'align-top w-5 select-none px-1 py-0.5 text-[11px] font-mono leading-5 text-center border-b border-black/[0.03]',
          empty && 'bg-slate-50/80 text-slate-300',
          !empty && row.kind === 'same' && 'bg-white text-gray-300',
          isDel && 'bg-red-100 text-red-600',
          isAdd && 'bg-emerald-100 text-emerald-700',
        )}
      >
        {sign}
      </td>
      <td
        className={cn(
          'align-top px-2 py-0.5 text-[11px] font-mono leading-5 whitespace-pre-wrap break-all border-b border-black/[0.03]',
          empty && 'bg-slate-50/80',
          !empty && row.kind === 'same' && 'bg-white text-gray-700',
          isDel && 'bg-red-50 text-red-900',
          isAdd && 'bg-emerald-50 text-emerald-900',
          side === 'left' && 'border-r border-gray-200',
        )}
      >
        {empty ? '\u00a0' : row.kind === 'change' ? (
          <InlineTokens
            text={text}
            other={side === 'left' ? row.right : row.left}
            side={side === 'left' ? 'del' : 'add'}
          />
        ) : (
          text
        )}
      </td>
    </>
  )
}

export function SideBySideDiff({
  leftLabel,
  rightLabel,
  leftText,
  rightText,
}: {
  leftLabel: string
  rightLabel: string
  leftText: string
  rightText: string
}) {
  const rows = alignLines(leftText, rightText)
  const changed = rows.filter(r => r.kind !== 'same').length
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="grid grid-cols-2 text-[11px] text-gray-500 border-b border-gray-200 bg-gray-50">
        <p className="px-3 py-1.5 truncate border-r border-gray-200">{leftLabel}</p>
        <p className="px-3 py-1.5 truncate">{rightLabel}</p>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full table-fixed border-collapse">
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="align-top">
                <SideCell row={row} side="left" />
                <SideCell row={row} side="right" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-100">
        {changed === 0 ? 'No line changes' : `${changed} changed line${changed === 1 ? '' : 's'}`}
        <span className="ml-3 text-red-600">− deleted</span>
        <span className="ml-2 text-emerald-700">+ added</span>
      </p>
    </div>
  )
}

function unifiedLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-slate-400'
  if (line.startsWith('@@')) return 'text-cyan-300 bg-cyan-950/40'
  if (line.startsWith('+')) return 'text-emerald-300 bg-emerald-950/50'
  if (line.startsWith('-')) return 'text-red-300 bg-red-950/50'
  return 'text-slate-300'
}

export function UnifiedDiffView({ lines }: { lines: string[] }) {
  if (!lines?.length) return null
  return (
    <pre className="text-[11px] font-mono leading-5 bg-slate-950 rounded-lg p-3 max-h-64 overflow-auto">
      {lines.map((line, idx) => (
        <div key={idx} className={cn('whitespace-pre-wrap break-all px-1 -mx-1 rounded-[2px]', unifiedLineClass(line))}>
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}
