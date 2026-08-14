import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Upload, Phone, AlertCircle, Download, Loader2, CheckCircle2,
  Plus, Trash2, Clock, ChevronDown, X,
} from 'lucide-react'
import { cn } from '../../lib/utils'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhoneNumberOption { number_id: string; name: string; phone_number: string }
interface AgentOption { agent_id: string; agent_name: string }
interface DialTask { phone_number: string; [variable: string]: string }
interface CsvResult { valid: boolean; tasks: DialTask[]; errors: string[] }
interface QCell { id: string; label: string; filters: Record<string, string>; target: number }

interface TimeRange { id: string; start: string; end: string }
interface WeekdaySchedule { id: string; weekday: number; time_ranges: TimeRange[] }

type EvalType = 'string' | 'number' | 'boolean'
interface CustomEval {
  id: string
  variable_name: string
  type: EvalType
  criteria: string
  enums: string[]
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ALL_TIMEZONES = [
  // UTC
  'UTC',
  // Africa
  'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Asmara',
  'Africa/Bamako', 'Africa/Bangui', 'Africa/Banjul', 'Africa/Bissau', 'Africa/Blantyre',
  'Africa/Brazzaville', 'Africa/Bujumbura', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Ceuta',
  'Africa/Conakry', 'Africa/Dakar', 'Africa/Dar_es_Salaam', 'Africa/Djibouti', 'Africa/Douala',
  'Africa/El_Aaiun', 'Africa/Freetown', 'Africa/Gaborone', 'Africa/Harare', 'Africa/Johannesburg',
  'Africa/Juba', 'Africa/Kampala', 'Africa/Khartoum', 'Africa/Kigali', 'Africa/Kinshasa',
  'Africa/Lagos', 'Africa/Libreville', 'Africa/Lome', 'Africa/Luanda', 'Africa/Lubumbashi',
  'Africa/Lusaka', 'Africa/Malabo', 'Africa/Maputo', 'Africa/Maseru', 'Africa/Mbabane',
  'Africa/Mogadishu', 'Africa/Monrovia', 'Africa/Nairobi', 'Africa/Ndjamena', 'Africa/Niamey',
  'Africa/Nouakchott', 'Africa/Ouagadougou', 'Africa/Porto-Novo', 'Africa/Sao_Tome',
  'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek',
  // America
  'America/Adak', 'America/Anchorage', 'America/Anguilla', 'America/Antigua', 'America/Araguaina',
  'America/Argentina/Buenos_Aires', 'America/Argentina/Catamarca', 'America/Argentina/Cordoba',
  'America/Argentina/Jujuy', 'America/Argentina/La_Rioja', 'America/Argentina/Mendoza',
  'America/Argentina/Rio_Gallegos', 'America/Argentina/Salta', 'America/Argentina/San_Juan',
  'America/Argentina/San_Luis', 'America/Argentina/Tucuman', 'America/Argentina/Ushuaia',
  'America/Aruba', 'America/Asuncion', 'America/Atikokan', 'America/Bahia', 'America/Bahia_Banderas',
  'America/Barbados', 'America/Belem', 'America/Belize', 'America/Blanc-Sablon', 'America/Boa_Vista',
  'America/Bogota', 'America/Boise', 'America/Cambridge_Bay', 'America/Campo_Grande', 'America/Cancun',
  'America/Caracas', 'America/Cayenne', 'America/Cayman', 'America/Chicago', 'America/Chihuahua',
  'America/Costa_Rica', 'America/Creston', 'America/Cuiaba', 'America/Curacao', 'America/Danmarkshavn',
  'America/Dawson', 'America/Dawson_Creek', 'America/Denver', 'America/Detroit', 'America/Dominica',
  'America/Edmonton', 'America/Eirunepe', 'America/El_Salvador', 'America/Fortaleza', 'America/Glace_Bay',
  'America/Godthab', 'America/Goose_Bay', 'America/Grand_Turk', 'America/Grenada', 'America/Guadeloupe',
  'America/Guatemala', 'America/Guayaquil', 'America/Guyana', 'America/Halifax', 'America/Havana',
  'America/Hermosillo', 'America/Indiana/Indianapolis', 'America/Indiana/Knox', 'America/Indiana/Marengo',
  'America/Indiana/Petersburg', 'America/Indiana/Tell_City', 'America/Indiana/Vevay',
  'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Inuvik', 'America/Iqaluit',
  'America/Jamaica', 'America/Juneau', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
  'America/Kralendijk', 'America/La_Paz', 'America/Lima', 'America/Los_Angeles', 'America/Lower_Princes',
  'America/Maceio', 'America/Managua', 'America/Manaus', 'America/Marigot', 'America/Martinique',
  'America/Matamoros', 'America/Mazatlan', 'America/Menominee', 'America/Merida', 'America/Metlakatla',
  'America/Mexico_City', 'America/Miquelon', 'America/Moncton', 'America/Monterrey', 'America/Montevideo',
  'America/Montserrat', 'America/Nassau', 'America/New_York', 'America/Nipigon', 'America/Nome',
  'America/Noronha', 'America/North_Dakota/Beulah', 'America/North_Dakota/Center',
  'America/North_Dakota/New_Salem', 'America/Ojinaga', 'America/Panama', 'America/Pangnirtung',
  'America/Paramaribo', 'America/Phoenix', 'America/Port-au-Prince', 'America/Port_of_Spain',
  'America/Porto_Velho', 'America/Puerto_Rico', 'America/Rainy_River', 'America/Rankin_Inlet',
  'America/Recife', 'America/Regina', 'America/Resolute', 'America/Rio_Branco', 'America/Santa_Isabel',
  'America/Santarem', 'America/Santiago', 'America/Santo_Domingo', 'America/Sao_Paulo',
  'America/Scoresbysund', 'America/Sitka', 'America/St_Barthelemy', 'America/St_Johns',
  'America/St_Kitts', 'America/St_Lucia', 'America/St_Thomas', 'America/St_Vincent',
  'America/Swift_Current', 'America/Tegucigalpa', 'America/Thule', 'America/Thunder_Bay',
  'America/Tijuana', 'America/Toronto', 'America/Tortola', 'America/Vancouver', 'America/Whitehorse',
  'America/Winnipeg', 'America/Yakutat', 'America/Yellowknife',
  // Antarctica
  'Antarctica/Casey', 'Antarctica/Davis', 'Antarctica/DumontDUrville', 'Antarctica/Macquarie',
  'Antarctica/Mawson', 'Antarctica/McMurdo', 'Antarctica/Palmer', 'Antarctica/Rothera',
  'Antarctica/Syowa', 'Antarctica/Troll', 'Antarctica/Vostok',
  // Arctic
  'Arctic/Longyearbyen',
  // Asia
  'Asia/Aden', 'Asia/Almaty', 'Asia/Amman', 'Asia/Anadyr', 'Asia/Aqtau', 'Asia/Aqtobe',
  'Asia/Ashgabat', 'Asia/Baghdad', 'Asia/Bahrain', 'Asia/Baku', 'Asia/Bangkok', 'Asia/Beirut',
  'Asia/Bishkek', 'Asia/Brunei', 'Asia/Choibalsan', 'Asia/Chongqing', 'Asia/Colombo',
  'Asia/Damascus', 'Asia/Dhaka', 'Asia/Dili', 'Asia/Dubai', 'Asia/Dushanbe', 'Asia/Gaza',
  'Asia/Harbin', 'Asia/Hebron', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Hovd', 'Asia/Irkutsk',
  'Asia/Jakarta', 'Asia/Jayapura', 'Asia/Jerusalem', 'Asia/Kabul', 'Asia/Kamchatka', 'Asia/Karachi',
  'Asia/Kashgar', 'Asia/Kathmandu', 'Asia/Khandyga', 'Asia/Kolkata', 'Asia/Krasnoyarsk',
  'Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Kuwait', 'Asia/Macau', 'Asia/Magadan', 'Asia/Makassar',
  'Asia/Manila', 'Asia/Muscat', 'Asia/Nicosia', 'Asia/Novokuznetsk', 'Asia/Novosibirsk', 'Asia/Omsk',
  'Asia/Oral', 'Asia/Phnom_Penh', 'Asia/Pontianak', 'Asia/Pyongyang', 'Asia/Qatar', 'Asia/Qyzylorda',
  'Asia/Rangoon', 'Asia/Riyadh', 'Asia/Sakhalin', 'Asia/Samarkand', 'Asia/Seoul', 'Asia/Shanghai',
  'Asia/Singapore', 'Asia/Taipei', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Tehran', 'Asia/Thimphu',
  'Asia/Tokyo', 'Asia/Ulaanbaatar', 'Asia/Urumqi', 'Asia/Ust-Nera', 'Asia/Vientiane',
  'Asia/Vladivostok', 'Asia/Yakutsk', 'Asia/Yekaterinburg', 'Asia/Yerevan',
  // Atlantic
  'Atlantic/Azores', 'Atlantic/Bermuda', 'Atlantic/Canary', 'Atlantic/Cape_Verde',
  'Atlantic/Faroe', 'Atlantic/Madeira', 'Atlantic/Reykjavik', 'Atlantic/South_Georgia',
  'Atlantic/St_Helena', 'Atlantic/Stanley',
  // Australia
  'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Broken_Hill', 'Australia/Currie',
  'Australia/Darwin', 'Australia/Eucla', 'Australia/Hobart', 'Australia/Lindeman',
  'Australia/Lord_Howe', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  // Europe
  'Europe/Amsterdam', 'Europe/Andorra', 'Europe/Athens', 'Europe/Belgrade', 'Europe/Berlin',
  'Europe/Bratislava', 'Europe/Brussels', 'Europe/Bucharest', 'Europe/Budapest', 'Europe/Busingen',
  'Europe/Chisinau', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Gibraltar', 'Europe/Guernsey',
  'Europe/Helsinki', 'Europe/Isle_of_Man', 'Europe/Istanbul', 'Europe/Jersey', 'Europe/Kaliningrad',
  'Europe/Kiev', 'Europe/Lisbon', 'Europe/Ljubljana', 'Europe/London', 'Europe/Luxembourg',
  'Europe/Madrid', 'Europe/Malta', 'Europe/Mariehamn', 'Europe/Minsk', 'Europe/Monaco',
  'Europe/Moscow', 'Europe/Nicosia', 'Europe/Oslo', 'Europe/Paris', 'Europe/Podgorica',
  'Europe/Prague', 'Europe/Riga', 'Europe/Rome', 'Europe/Samara', 'Europe/San_Marino',
  'Europe/Sarajevo', 'Europe/Simferopol', 'Europe/Skopje', 'Europe/Sofia', 'Europe/Stockholm',
  'Europe/Tallinn', 'Europe/Tirane', 'Europe/Uzhgorod', 'Europe/Vaduz', 'Europe/Vatican',
  'Europe/Vienna', 'Europe/Vilnius', 'Europe/Volgograd', 'Europe/Warsaw', 'Europe/Zagreb',
  'Europe/Zaporozhye', 'Europe/Zurich',
  // Indian
  'Indian/Antananarivo', 'Indian/Chagos', 'Indian/Christmas', 'Indian/Cocos', 'Indian/Comoro',
  'Indian/Kerguelen', 'Indian/Mahe', 'Indian/Maldives', 'Indian/Mauritius', 'Indian/Mayotte',
  'Indian/Reunion',
  // Pacific
  'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Chuuk', 'Pacific/Easter',
  'Pacific/Efate', 'Pacific/Enderbury', 'Pacific/Fakaofo', 'Pacific/Fiji', 'Pacific/Funafuti',
  'Pacific/Galapagos', 'Pacific/Gambier', 'Pacific/Guadalcanal', 'Pacific/Guam', 'Pacific/Honolulu',
  'Pacific/Johnston', 'Pacific/Kiritimati', 'Pacific/Kosrae', 'Pacific/Kwajalein', 'Pacific/Majuro',
  'Pacific/Marquesas', 'Pacific/Midway', 'Pacific/Nauru', 'Pacific/Niue', 'Pacific/Norfolk',
  'Pacific/Noumea', 'Pacific/Pago_Pago', 'Pacific/Palau', 'Pacific/Pitcairn', 'Pacific/Pohnpei',
  'Pacific/Port_Moresby', 'Pacific/Rarotonga', 'Pacific/Saipan', 'Pacific/Tahiti', 'Pacific/Tarawa',
  'Pacific/Tongatapu', 'Pacific/Wake', 'Pacific/Wallis',
]

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsv(text: string, t: TFunction): CsvResult {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) return { valid: false, tasks: [], errors: [t('nc_wiz.csv_empty')] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^﻿/, '').toLowerCase())
  const phoneIdx = headers.indexOf('phone_number')
  if (phoneIdx === -1) return { valid: false, tasks: [], errors: [t('nc_wiz.csv_missing_col')] }
  const errors: string[] = []
  const tasks: DialTask[] = []
  const seen = new Set<string>()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const phone = (cols[phoneIdx] ?? '').trim()
    if (!phone) { errors.push(t('nc_wiz.csv_row_empty', { n: i + 1 })); continue }
    if (seen.has(phone)) { errors.push(t('nc_wiz.csv_row_dup', { n: i + 1, phone })); continue }
    seen.add(phone)
    const task: DialTask = { phone_number: phone }
    headers.forEach((h, idx) => {
      if (idx === phoneIdx) return
      task[h] = (cols[idx] ?? '').trim()
    })
    tasks.push(task)
  }
  return { valid: errors.length === 0 && tasks.length > 0, tasks, errors }
}

// ── QuotaCellTable ─────────────────────────────────────────────────────────────
function QuotaCellTable({ cells, onAdd, onRemove, onUpdate }: {
  cells: QCell[]
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: 'label' | 'target', val: string | number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1fr_90px_36px] bg-gray-50 border-b border-gray-200">
        <div className="px-4 py-2 text-xs font-medium text-gray-400">{t('nc_wiz.quota_dim')}</div>
        <div className="px-3 py-2 text-xs font-medium text-gray-400 text-center border-l border-gray-200">{t('nc_wiz.quota_target')}</div>
        <div />
      </div>
      <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
        {cells.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            {t('nc_wiz.no_quota_hint', 'No quota cells — add rows to set targets')}
          </div>
        )}
        {cells.map((cell, idx) => (
          <div key={cell.id} className={cn('grid grid-cols-[1fr_90px_36px] items-center hover:bg-gray-50', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
            <div className="px-4 py-2.5">
              <input
                type="text" value={cell.label}
                onChange={e => onUpdate(cell.id, 'label', e.target.value)}
                placeholder={t('nc_wiz.filter_ph')}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="px-3 py-2.5 border-l border-gray-100">
              <input
                type="number" min={0} value={cell.target}
                onChange={e => onUpdate(cell.id, 'target', Number(e.target.value))}
                className="w-full text-sm text-center border border-gray-200 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center justify-center">
              <button onClick={() => onRemove(cell.id)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 bg-gray-50">
        <button onClick={onAdd} className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 transition-colors">
          <Plus size={12} /> {t('nc_wiz.add_row')}
        </button>
        <span className="text-xs text-gray-400">
          {t('nc_wiz.n_total', { n: cells.length, t: cells.reduce((s, c) => s + (Number(c.target) || 0), 0) })}
        </span>
      </div>
    </div>
  )
}

// ── Toggle ─────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-3 select-none text-left">
      <div className={cn('relative w-9 h-5 rounded-full transition-colors flex-shrink-0', checked ? 'bg-indigo-600' : 'bg-gray-200')}>
        <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </div>
      <span className="text-sm text-gray-700">{label}</span>
    </button>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white border border-gray-100 rounded-xl shadow-sm p-6', className)}>
      {children}
    </div>
  )
}

// ── Main wizard ────────────────────────────────────────────────────────────────
export function NewSurveyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const [step, setStep] = useState<1 | 2>(1)

  // Basic info
  const [campaignName, setCampaignName] = useState('')
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberOption[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedPhoneId, setSelectedPhoneId] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')

  // Phone list
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null)
  const [phoneFile, setPhoneFile] = useState<File | null>(null)
  const [phoneDragging, setPhoneDragging] = useState(false)
  const phoneInputRef = useRef<HTMLInputElement>(null)

  // Schedule
  const [startImmediately, setStartImmediately] = useState(true)
  const [scheduledStartTime, setScheduledStartTime] = useState('')
  const [timezone, setTimezone] = useState('Asia/Taipei')
  const [weekdaySchedules, setWeekdaySchedules] = useState<WeekdaySchedule[]>([])

  // End call config
  const [maxCallDuration, setMaxCallDuration] = useState(900)
  const [silenceTimeout, setSilenceTimeout] = useState(120)
  const [ringTimeout, setRingTimeout] = useState(30)
  const [endCallOnVoicemail, setEndCallOnVoicemail] = useState(false)
  const [endCallOnUserRequest, setEndCallOnUserRequest] = useState(true)
  const [endCallOnAiAssistant, setEndCallOnAiAssistant] = useState(true)
  const [endCallOnSilenceTimeout, setEndCallOnSilenceTimeout] = useState(true)
  const [endCallExpanded, setEndCallExpanded] = useState(true)

  // Recording
  const [enableTranscript, setEnableTranscript] = useState(true)
  const [enableRecording, setEnableRecording] = useState(true)

  // Call analysis
  const [enableStructuredOutput, setEnableStructuredOutput] = useState(true)
  const [callSuccessCriteria, setCallSuccessCriteria] = useState('')
  const [customEvals, setCustomEvals] = useState<CustomEval[]>([])
  const [enumInputs, setEnumInputs] = useState<Record<string, string>>({})

  // Quota
  const [quotaCells, setQuotaCells] = useState<QCell[]>([])

  // Submit
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    fetch(`${API}/api/phone-numbers`).then(r => r.json()).then(setPhoneNumbers).catch(() => {})
    fetch(`${API}/api/agents`).then(r => r.json()).then(setAgents).catch(() => {})
  }, [])

  // Pre-populate from duplicate
  useEffect(() => {
    const dup = (location.state as { duplicateFrom?: Record<string, unknown> } | null)?.duplicateFrom
    if (!dup) return
    if (typeof dup.campaign_name === 'string') setCampaignName('Copy of ' + dup.campaign_name)
    if (typeof dup.phone_number_id === 'string') setSelectedPhoneId(dup.phone_number_id)
    if (typeof dup.agent_id === 'string') setSelectedAgentId(dup.agent_id)
    if (typeof dup.start_immediately === 'boolean') setStartImmediately(dup.start_immediately)
    if (typeof dup.max_call_duration_seconds === 'number') setMaxCallDuration(dup.max_call_duration_seconds)
    if (typeof dup.silence_timeout_seconds === 'number') setSilenceTimeout(dup.silence_timeout_seconds)
    if (typeof dup.ring_timeout_seconds === 'number') setRingTimeout(dup.ring_timeout_seconds)
    if (typeof dup.end_call_on_silence_timeout === 'boolean') setEndCallOnSilenceTimeout(dup.end_call_on_silence_timeout)
    if (typeof dup.end_call_on_user_request === 'boolean') setEndCallOnUserRequest(dup.end_call_on_user_request)
    if (typeof dup.end_call_on_ai_assistant === 'boolean') setEndCallOnAiAssistant(dup.end_call_on_ai_assistant)
    if (typeof dup.enable_transcript === 'boolean') setEnableTranscript(dup.enable_transcript)
    if (typeof dup.enable_recording === 'boolean') setEnableRecording(dup.enable_recording)
    const so = dup.structured_output as Record<string, unknown> | null
    if (so?.enable_structured_output === true) {
      setEnableStructuredOutput(true)
      const cse = so.call_success_evaluation as Record<string, unknown> | undefined
      if (typeof cse?.criteria === 'string') setCallSuccessCriteria(cse.criteria)
      if (Array.isArray(so.custom_evaluations)) {
        setCustomEvals((so.custom_evaluations as Record<string, unknown>[]).map(e => ({
          id: crypto.randomUUID(),
          variable_name: typeof e.variable_name === 'string' ? e.variable_name : '',
          type: (e.type === 'number' || e.type === 'boolean') ? e.type as EvalType : 'string',
          criteria: typeof e.criteria === 'string' ? e.criteria : '',
          enums: Array.isArray(e.enums) ? (e.enums as string[]) : [],
        })))
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePhoneFile(f: File) {
    setPhoneFile(f)
    setCsvResult(parseCsv(await f.text(), t))
  }

  function downloadTemplate() {
    const csv = 'phone_number\n251204886289522369\n251204886221910025\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'phone_list_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // WeekdaySchedule handlers
  function addWeekdaySchedule() {
    setWeekdaySchedules(prev => [...prev, {
      id: crypto.randomUUID(), weekday: 1,
      time_ranges: [{ id: crypto.randomUUID(), start: '09:00', end: '18:00' }],
    }])
  }
  function removeWeekdaySchedule(id: string) {
    setWeekdaySchedules(prev => prev.filter(ws => ws.id !== id))
  }
  function updateWeekdayScheduleDay(id: string, weekday: number) {
    setWeekdaySchedules(prev => prev.map(ws => ws.id === id ? { ...ws, weekday } : ws))
  }
  function addTimeRange(wsId: string) {
    setWeekdaySchedules(prev => prev.map(ws => ws.id === wsId
      ? { ...ws, time_ranges: [...ws.time_ranges, { id: crypto.randomUUID(), start: '09:00', end: '18:00' }] }
      : ws))
  }
  function removeTimeRange(wsId: string, trId: string) {
    setWeekdaySchedules(prev => prev.map(ws => ws.id === wsId
      ? { ...ws, time_ranges: ws.time_ranges.filter(tr => tr.id !== trId) }
      : ws))
  }
  function updateTimeRange(wsId: string, trId: string, field: 'start' | 'end', val: string) {
    setWeekdaySchedules(prev => prev.map(ws => ws.id === wsId
      ? { ...ws, time_ranges: ws.time_ranges.map(tr => tr.id === trId ? { ...tr, [field]: val } : tr) }
      : ws))
  }

  // CustomEval handlers
  function addCustomEval() {
    setCustomEvals(prev => [...prev, { id: crypto.randomUUID(), variable_name: '', type: 'string', criteria: '', enums: [] }])
  }
  function removeCustomEval(id: string) {
    setCustomEvals(prev => prev.filter(e => e.id !== id))
    setEnumInputs(prev => { const n = { ...prev }; delete n[id]; return n })
  }
  function updateCustomEval(id: string, field: keyof CustomEval, val: string) {
    setCustomEvals(prev => prev.map(e => e.id === id ? { ...e, [field]: val } : e))
  }
  function addEnumTag(id: string) {
    const val = (enumInputs[id] ?? '').trim()
    if (!val) return
    setCustomEvals(prev => prev.map(e =>
      e.id === id && !e.enums.includes(val) ? { ...e, enums: [...e.enums, val] } : e
    ))
    setEnumInputs(prev => ({ ...prev, [id]: '' }))
  }
  function removeEnumTag(id: string, tag: string) {
    setCustomEvals(prev => prev.map(e =>
      e.id === id ? { ...e, enums: e.enums.filter(v => v !== tag) } : e
    ))
  }

  // Quota handlers
  function addQuotaCell() {
    setQuotaCells(prev => [...prev, { id: crypto.randomUUID(), label: '', filters: {}, target: 30 }])
  }
  function removeQuotaCell(id: string) {
    setQuotaCells(prev => prev.filter(c => c.id !== id))
  }
  function updateQuotaCell(id: string, field: 'label' | 'target', val: string | number) {
    setQuotaCells(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c))
  }

  async function handleCreate() {
    if (!csvResult?.valid) return
    if (!selectedPhoneId) { setCreateError(t('nc_wiz.need_phone')); return }
    if (!selectedAgentId) { setCreateError(t('nc_wiz.need_agent')); return }
    setCreating(true); setCreateError('')

    try {
      const scheduleOption = startImmediately ? undefined : {
        ...(scheduledStartTime ? { scheduled_start_time: scheduledStartTime + ':00Z' } : {}),
        timezone,
        allowed_time_ranges_config: weekdaySchedules.map(ws => ({
          weekday: ws.weekday,
          time_ranges: ws.time_ranges.map(tr => ({ start: tr.start, end: tr.end })),
        })),
      }

      const structuredOutput = enableStructuredOutput ? {
        enable_structured_output: true,
        call_success_evaluation: { criteria: callSuccessCriteria },
        custom_evaluations: customEvals
          .filter(e => e.variable_name.trim())
          .map(e => {
            const base = { variable_name: e.variable_name.trim(), type: e.type, criteria: e.criteria.trim() }
            if (e.type !== 'boolean' && e.enums.length > 0) {
              return { ...base, enums: e.enums }
            }
            return base
          }),
      } : undefined

      const resp = await fetch(`${API}/api/campaigns-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_name: campaignName,
          phone_number_id: selectedPhoneId,
          agent_id: selectedAgentId,
          questionnaire_type: 'existing_agent',
          quota_mode: 'manual',
          dial_tasks: csvResult.tasks.map(row => ({ ...row })),
          start_immediately: startImmediately,
          ...(scheduleOption ? { schedule_option: scheduleOption } : {}),
          end_call_config: {
            max_call_duration_seconds: maxCallDuration,
            silence_timeout_seconds: silenceTimeout,
            ring_timeout_seconds: ringTimeout,
            end_call_on_voicemail: endCallOnVoicemail,
            end_call_on_user_request: endCallOnUserRequest,
            end_call_on_ai_assistant: endCallOnAiAssistant,
            end_call_on_silence_timeout: endCallOnSilenceTimeout,
          },
          enable_transcript: enableTranscript,
          enable_recording: enableRecording,
          ...(structuredOutput ? { structured_output: structuredOutput } : {}),
        }),
      })

      if (!resp.ok) { const err = await resp.json(); throw new Error(err.detail ?? t('nc_wiz.err_create')) }
      const campaign = await resp.json()

      if (quotaCells.length > 0 && campaign.campaign_id) {
        await fetch(`${API}/api/quota-v2/${campaign.campaign_id}/cells`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cells: quotaCells.map(c => ({ label: c.label, filters: c.filters, target: c.target })),
          }),
        })
      }

      navigate('/')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t('nc_wiz.err_create'))
      setCreating(false)
    }
  }

  const step1Valid = Boolean(campaignName.trim()) && Boolean(selectedPhoneId) && Boolean(selectedAgentId) && Boolean(csvResult?.valid)
  const STEP_LABELS = ['Basic Info', 'Call Analysis']

  return (
    <div className="p-6 w-full bg-gray-50 min-h-screen">

      {/* ── Step indicator ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm mb-6 px-6 py-4 max-w-5xl mx-auto">
        <div className="flex items-start">
          {([1, 2] as const).map((s, i) => {
            const done = step > s
            const current = step === s
            return (
              <div key={s} className="flex items-start flex-1 min-w-0">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold',
                    current ? 'bg-indigo-600 text-white' : done ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400',
                  )}>
                    {done ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <span className={cn(
                    'mt-1.5 text-[11px] text-center leading-tight w-24 break-words',
                    current ? 'text-gray-900 font-medium' : 'text-gray-400',
                  )}>
                    {STEP_LABELS[i]}
                  </span>
                </div>
                {i < 1 && (
                  <div className={cn('flex-1 h-px mt-3.5 mx-1', step > s ? 'bg-indigo-300' : 'bg-gray-200')} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Step 1: two-column layout ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 items-start">

            {/* ── Left column ──────────────────────────────────────────────────── */}
            <div className="space-y-4">

              {/* Basic info */}
              <Card className="space-y-5">
                <h2 className="font-semibold text-gray-900">Basic Info</h2>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">
                    Campaign Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)}
                    placeholder={t('nc_wiz.campaign_name_ph')}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">
                    {t('nc_wiz.phone_lbl')} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedPhoneId} onChange={e => setSelectedPhoneId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    <option value="">{t('nc_wiz.select_phone')}</option>
                    {phoneNumbers.map(p => (
                      <option key={p.number_id} value={p.number_id}>{p.name} ({p.phone_number})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">
                    Agent <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    <option value="">{t('nc_wiz.select_agent')}</option>
                    {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.agent_name}</option>)}
                  </select>
                </div>
              </Card>

              {/* Schedule */}
              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-indigo-600" />
                  <h2 className="font-semibold text-gray-900">Schedule</h2>
                </div>

                <Toggle checked={startImmediately} onChange={setStartImmediately} label="Start Immediately" />

                {!startImmediately && (
                  <div className="space-y-4 pl-4 border-l-2 border-indigo-100">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Scheduled Start Time (UTC)</label>
                        <input
                          type="datetime-local" value={scheduledStartTime}
                          onChange={e => setScheduledStartTime(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Timezone (IANA)</label>
                        <select
                          value={timezone}
                          onChange={e => setTimezone(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                        >
                          {ALL_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600">Allowed Call Time Windows</span>
                        <button
                          onClick={addWeekdaySchedule}
                          className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 transition-colors"
                        >
                          <Plus size={12} /> Add Weekday
                        </button>
                      </div>

                      {weekdaySchedules.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No restrictions — calls will be placed at any time</p>
                      )}

                      {weekdaySchedules.map(ws => (
                        <div key={ws.id} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <select
                              value={ws.weekday}
                              onChange={e => updateWeekdayScheduleDay(ws.id, Number(e.target.value))}
                              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            >
                              {WEEKDAY_LABELS.map((label, idx) => (
                                <option key={idx} value={idx}>{label}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => addTimeRange(ws.id)}
                              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded px-2 py-1 hover:bg-indigo-50 transition-colors"
                            >
                              <Plus size={11} /> Add Range
                            </button>
                            <button
                              onClick={() => removeWeekdaySchedule(ws.id)}
                              className="ml-auto text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="space-y-1.5 pl-1">
                            {ws.time_ranges.map(tr => (
                              <div key={tr.id} className="flex items-center gap-2">
                                <input type="time" value={tr.start}
                                  onChange={e => updateTimeRange(ws.id, tr.id, 'start', e.target.value)}
                                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                />
                                <span className="text-xs text-gray-400">to</span>
                                <input type="time" value={tr.end}
                                  onChange={e => updateTimeRange(ws.id, tr.id, 'end', e.target.value)}
                                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                />
                                {ws.time_ranges.length > 1 && (
                                  <button onClick={() => removeTimeRange(ws.id, tr.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              {/* End call config (collapsible) */}
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEndCallExpanded(v => !v)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900 text-sm">End Call Config</span>
                    {!endCallExpanded && (
                      <span className="text-xs text-gray-400">
                        Max {maxCallDuration}s · Silence {silenceTimeout}s · Ring {ringTimeout}s
                      </span>
                    )}
                  </div>
                  <ChevronDown size={15} className={cn('text-gray-400 transition-transform', endCallExpanded && 'rotate-180')} />
                </button>

                {endCallExpanded && (
                  <div className="px-6 pb-6 space-y-4 border-t border-gray-100">
                    <div className="grid grid-cols-3 gap-4 pt-4">
                      {([
                        { label: 'Max Duration (s)', val: maxCallDuration, set: setMaxCallDuration },
                        { label: 'Silence Timeout (s)', val: silenceTimeout, set: setSilenceTimeout },
                        { label: 'Ring Timeout (s)', val: ringTimeout, set: setRingTimeout },
                      ] as const).map(({ label, val, set }) => (
                        <div key={label}>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
                          <input
                            type="number" min={0} value={val}
                            onChange={e => set(Number(e.target.value))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
                      <Toggle checked={endCallOnVoicemail} onChange={setEndCallOnVoicemail} label="End call on voicemail" />
                      <Toggle checked={endCallOnUserRequest} onChange={setEndCallOnUserRequest} label="End call on user request" />
                      <Toggle checked={endCallOnAiAssistant} onChange={setEndCallOnAiAssistant} label="End call when AI finishes" />
                      <Toggle checked={endCallOnSilenceTimeout} onChange={setEndCallOnSilenceTimeout} label="End call on silence timeout" />
                    </div>
                  </div>
                )}
              </div>

              {/* Recording */}
              <Card className="space-y-3">
                <h2 className="font-semibold text-gray-900 text-sm">Recording & Transcript</h2>
                <div className="flex items-center gap-8">
                  <Toggle checked={enableTranscript} onChange={setEnableTranscript} label="Enable Transcript" />
                  <Toggle checked={enableRecording} onChange={setEnableRecording} label="Enable Recording" />
                </div>
              </Card>

              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next')}
              </button>
            </div>

            {/* ── Right column: Phone list ──────────────────────────────────────── */}
            <div>
              <Card className="space-y-4 sticky top-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-indigo-600" />
                    <h2 className="font-semibold text-gray-900">
                      {t('nc_wiz.step_5')} <span className="text-red-500">*</span>
                    </h2>
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition-colors"
                  >
                    <Download size={13} /> {t('new_survey.phone_download_template')}
                  </button>
                </div>

                <div
                  onDragOver={e => { e.preventDefault(); setPhoneDragging(true) }}
                  onDragLeave={() => setPhoneDragging(false)}
                  onDrop={e => { e.preventDefault(); setPhoneDragging(false); const f = e.dataTransfer.files[0]; if (f) handlePhoneFile(f) }}
                  onClick={() => phoneInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
                    phoneDragging                           ? 'border-indigo-300 bg-indigo-50' :
                    csvResult?.valid                        ? 'border-indigo-200 bg-indigo-50/50' :
                    csvResult?.valid === false && phoneFile ? 'border-red-200 bg-red-50/50' :
                    'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50',
                  )}
                >
                  <Upload size={28} className={cn('mx-auto mb-3',
                    csvResult?.valid                        ? 'text-indigo-400' :
                    csvResult?.valid === false && phoneFile ? 'text-red-400' : 'text-gray-300')} />
                  {phoneFile ? (
                    <div>
                      <span className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 text-sm font-medium">
                        <Phone size={13} /> {phoneFile.name}
                      </span>
                      <p className="text-xs text-gray-400 mt-2">{(phoneFile.size / 1024).toFixed(1)} KB</p>
                      {csvResult?.valid && (
                        <p className="text-xs text-indigo-600 font-medium mt-1.5">
                          {t('nc_wiz.n_lines', { n: csvResult.tasks.length })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-600">{t('new_survey.phone_drag_drop')}</p>
                      <p className="text-xs text-gray-400 mt-1">{t('new_survey.phone_file_hint')}</p>
                    </div>
                  )}
                  <input ref={phoneInputRef} type="file" accept=".csv,text/csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoneFile(f) }} />
                </div>

                {csvResult && !csvResult.valid && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-red-700">{t('nc_wiz.n_errs', { n: csvResult.errors.length })}</span>
                    </div>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {csvResult.errors.map((err, i) => (
                        <li key={i} className="text-xs text-red-600 font-mono bg-red-100 rounded px-2 py-1">{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* CSV format hint */}
                <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-medium text-gray-500">CSV Format</p>
                  <pre className="text-xs text-gray-400 font-mono leading-relaxed whitespace-pre">{`phone_number\n251204886289522369\n251204886221910025`}</pre>
                </div>
              </Card>
            </div>

          </div>
        </div>
      )}

      {/* ── Step 2: Quota & Analysis ──────────────────────────────────────────── */}
      {step === 2 && (
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Call Analysis */}
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Call Analysis</h2>
              <Toggle checked={enableStructuredOutput} onChange={setEnableStructuredOutput} label="Enable" />
            </div>

            {enableStructuredOutput && (
              <div className="space-y-5 pt-1">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">Call Success Criteria</label>
                  <textarea
                    value={callSuccessCriteria}
                    onChange={e => setCallSuccessCriteria(e.target.value)}
                    rows={2}
                    placeholder="e.g. Customer confirmed the contract info is all correct."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white resize-none"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Custom Evaluations</span>
                    <button
                      onClick={addCustomEval}
                      className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 transition-colors"
                    >
                      <Plus size={12} /> Add Variable
                    </button>
                  </div>

                  {customEvals.length === 0 && (
                    <p className="text-xs text-gray-400 italic">No custom variables defined</p>
                  )}

                  {customEvals.map((ev, idx) => (
                    <div key={ev.id} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50/40">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Variable {idx + 1}</span>
                        <button
                          onClick={() => removeCustomEval(ev.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Variable Name</label>
                          <input
                            type="text" value={ev.variable_name}
                            onChange={e => updateCustomEval(ev.id, 'variable_name', e.target.value)}
                            placeholder="e.g. region"
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Type</label>
                          <select
                            value={ev.type}
                            onChange={e => updateCustomEval(ev.id, 'type', e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Criteria / Extraction Prompt</label>
                        <input
                          type="text" value={ev.criteria}
                          onChange={e => updateCustomEval(ev.id, 'criteria', e.target.value)}
                          placeholder="e.g. 提取用户所在区域"
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                        />
                      </div>

                      {ev.type !== 'boolean' && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Enum Values <span className="text-gray-400 font-normal">(optional)</span></label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={enumInputs[ev.id] ?? ''}
                              onChange={e => setEnumInputs(prev => ({ ...prev, [ev.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEnumTag(ev.id) } }}
                              placeholder="e.g. 台中"
                              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => addEnumTag(ev.id)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
                            >
                              <Plus size={12} /> Add
                            </button>
                          </div>
                          {ev.enums.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {ev.enums.map(tag => (
                                <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-xs font-medium">
                                  {tag}
                                  <button type="button" onClick={() => removeEnumTag(ev.id, tag)} className="text-indigo-400 hover:text-indigo-700 transition-colors">
                                    <X size={11} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Quota Setup */}
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{t('nc_wiz.step_4')}</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{t('nc_wiz.mode_badge_manual')}</span>
            </div>
            <QuotaCellTable
              cells={quotaCells}
              onAdd={addQuotaCell}
              onRemove={removeQuotaCell}
              onUpdate={updateQuotaCell}
            />
          </Card>

          {createError && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              {createError}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              {t('common.prev')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {creating && <Loader2 size={14} className="animate-spin" />}
              {creating ? t('nc_wiz.creating_campaign') : t('nc_wiz.create_campaign')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
