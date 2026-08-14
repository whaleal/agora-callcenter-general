import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Eye, EyeOff, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { login } from '../../lib/auth'
import { LANGUAGES, setLang, type Lang } from '../../i18n'
import agoraLogo from '../../assets/logo.png'
import taipeiBg from '../../assets/liberty.jpg'

export function LoginPage() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const currentLang = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0]

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setTimeout(() => {
      const ok = login(username.trim(), password)
      if (ok) {
        navigate('/dashboard', { replace: true })
      } else {
        setError(t('login.error'))
        setLoading(false)
      }
    }, 400)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundImage: `url(${taipeiBg})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={agoraLogo} alt="Jinmu Info" className="h-12 w-auto object-contain mb-3" />
        </div>

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
          <h1 className="text-lg font-semibold text-gray-900 mb-1">{t('login.title')}</h1>
          <p className="text-sm text-gray-400 mb-6">{t('login.subtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('login.username')}
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t('login.username_ph')}
                autoComplete="username"
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t('login.password')}
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('login.password_ph')}
                  autoComplete="current-password"
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

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
