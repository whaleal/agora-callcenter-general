import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2, Eye, EyeOff, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { register, requestVerificationCode } from '../../lib/auth'
import { isValidEmail } from '../../lib/utils'
import { LANGUAGES, setLang, type Lang } from '../../i18n'
import agoraLogo from '../../assets/logo.png'
import taipeiBg from '../../assets/liberty.jpg'

const CODE_COUNTDOWN_SECONDS = 60

export function RegisterPage() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [appId, setAppId] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [langOpen, setLangOpen] = useState(false)
  const currentLang = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0]
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const emailInvalid = emailTouched && email.trim() !== '' && !isValidEmail(email.trim())

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  async function handleGetCode() {
    setError('')
    setEmailTouched(true)
    if (!email.trim()) {
      setError(t('register.email_required'))
      return
    }
    if (!isValidEmail(email.trim())) {
      setError(t('register.email_invalid'))
      return
    }
    setSendingCode(true)
    try {
      await requestVerificationCode(email.trim(), 'register')
      setCountdown(CODE_COUNTDOWN_SECONDS)
      timerRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            if (timerRef.current) clearInterval(timerRef.current)
            return 0
          }
          return c - 1
        })
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.code_error'))
    } finally {
      setSendingCode(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setEmailTouched(true)
    if (!isValidEmail(email.trim())) {
      setError(t('register.email_invalid'))
      return
    }
    setLoading(true)
    try {
      await register(username.trim(), email.trim(), password, code.trim(), appId.trim())
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.error'))
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundImage: `url(${taipeiBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
    >
      <div className="w-full max-w-xl">
        {/* Language selector */}
        <div className="flex justify-center mb-4">
          {langOpen && (
            <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
          )}
          <div className="relative z-50">
            <button
              onClick={() => setLangOpen(o => !o)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-600 bg-white border border-gray-200 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <span className="text-sm leading-none">{currentLang.flag}</span>
              <span>{currentLang.label}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {langOpen && (
              <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-full">
                {LANGUAGES.map(({ code, flag, label }) => (
                  <button
                    key={code}
                    onClick={() => { setLang(code as Lang); setLangOpen(false) }}
                    className={[
                      'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-gray-50',
                      i18n.language === code ? 'text-indigo-600 font-medium bg-indigo-50' : 'text-gray-600',
                    ].join(' ')}
                  >
                    <span className="text-sm leading-none">{flag}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex flex-col items-center">
            <img src={agoraLogo} alt="Jinmu Info" className="h-12 w-auto object-contain mb-3" />
            <h1 className="text-2xl font-semibold text-gray-900 mb-6">{t('register.title')}</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('register.username')}
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t('register.username_ph')}
                autoComplete="username"
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('register.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                placeholder={t('register.email_ph')}
                autoComplete="email"
                className={[
                  'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent bg-white transition-shadow',
                  emailInvalid ? 'border-red-300 focus:ring-red-500' : 'border-gray-200 focus:ring-indigo-500',
                ].join(' ')}
              />
              {emailInvalid && (
                <p className="mt-1 text-xs text-red-600">{t('register.email_invalid')}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('register.password')}
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('register.password_ph')}
                  autoComplete="new-password"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('register.app_id')}
              </label>
              <input
                type="text"
                value={appId}
                onChange={e => setAppId(e.target.value)}
                placeholder={t('register.app_id_ph')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('register.code')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder={t('register.code_ph')}
                  autoComplete="one-time-code"
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow"
                />
                <button
                  type="button"
                  onClick={handleGetCode}
                  disabled={sendingCode || countdown > 0}
                  className="shrink-0 whitespace-nowrap px-3 py-2.5 rounded-lg text-xs font-medium border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent transition-colors"
                >
                  {sendingCode ? (
                    <Loader2 size={14} className="animate-spin mx-auto" />
                  ) : countdown > 0 ? (
                    t('register.resend_code', { s: countdown })
                  ) : (
                    t('register.get_code')
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !email || !password || !code || !appId || !isValidEmail(email.trim())}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? t('register.submitting') : t('register.submit')}
            </button>

            <p className="text-center text-sm text-gray-500">
              {t('register.have_account')}{' '}
              <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
                {t('register.sign_in')}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
