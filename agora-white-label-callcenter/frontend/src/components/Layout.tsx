import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/utils'
import { BookOpen, PlusCircle, Radio, PhoneCall, Bot, History, PhoneIncoming, BarChart2, LogOut, Settings, UserCircle2, FolderInput, ChevronDown, ScrollText } from 'lucide-react'
import agoraLogo from '../assets/logo.png'
import { LANGUAGES, setLang, type Lang } from '../i18n'
import { getUser, logout } from '../lib/auth'

const UNLOCK_CLICKS = 5
const SESSION_KEY = 'import_unlocked'

export function Layout() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [logoClicks, setLogoClicks] = useState(0)
  const [langOpen, setLangOpen] = useState(false)
  const currentLang = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0]
  const [importUnlocked, setImportUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === '1'
  )
  const user = getUser()

  function handleLogoClick() {
    if (importUnlocked) return
    const next = logoClicks + 1
    setLogoClicks(next)
    if (next >= UNLOCK_CLICKS) {
      setImportUnlocked(true)
      sessionStorage.setItem(SESSION_KEY, '1')
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY)
    logout()
    navigate('/login', { replace: true })
  }

  const NAV = [
    { to: '/dashboard',       label: t('app_nav.dashboard'),       icon: BarChart2 },
    { to: '/surveys/new',     label: t('nav.new_campaign'),        icon: PlusCircle },
    { to: '/campaigns',       label: t('app_nav.campaigns'),       icon: Radio },
    { to: '/inbound-routing', label: t('app_nav.inbound_routing'), icon: PhoneIncoming },
    { to: '/phone-numbers',   label: t('app_nav.phone_numbers'),   icon: PhoneCall },
    { to: '/agents',          label: t('app_nav.agents'),          icon: Bot },
    { to: '/call-history',    label: t('app_nav.call_history'),    icon: History },
    { to: '/case-study',      label: t('app_nav.case_study'),      icon: BookOpen },
    { to: '/login-logs',      label: t('app_nav.login_logs'),      icon: ScrollText },
    ...(importUnlocked ? [{ to: '/import', label: t('app_nav.import'), icon: FolderInput }] : []),
  ]

  return (
    <div className="flex h-screen bg-[#F6F7F9]">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div
          className="h-16 px-5 flex items-center justify-center border-b border-gray-100 cursor-default select-none flex-shrink-0"
          onClick={handleLogoClick}
        >
          <img src={agoraLogo} alt="Jinmu Info" className="h-[42px] w-auto object-contain" />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 h-10 px-3 rounded-md text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-blue-600" />
                  )}
                  <Icon
                    size={17}
                    strokeWidth={isActive ? 2.25 : 1.75}
                    className={isActive ? 'text-blue-600' : 'text-gray-400'}
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Language switcher */}
        <div className="px-3 py-3 border-t border-gray-100">
          {langOpen && (
            <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
          )}
          <div className="relative z-50">
            <button
              onClick={() => setLangOpen(o => !o)}
              className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs text-gray-600 bg-white hover:bg-gray-50 border border-gray-200 transition-colors cursor-pointer"
            >
              <span className="text-sm leading-none">{currentLang.flag}</span>
              <span className="flex-1 text-left">{currentLang.label}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {langOpen && (
              <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
                {LANGUAGES.map(({ code, flag, label }) => (
                  <button
                    key={code}
                    onClick={() => { setLang(code as Lang); setLangOpen(false) }}
                    className={[
                      'flex items-center gap-2 w-full px-2.5 py-1.5 text-xs hover:bg-gray-50',
                      i18n.language === code ? 'text-blue-700 font-medium bg-blue-50' : 'text-gray-600',
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

        {/* User profile */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-gray-50 transition-colors">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <UserCircle2 size={15} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{user?.username ?? 'Admin'}</p>
              <p className="text-[10px] text-gray-400 truncate">Administrator</p>
            </div>
            <NavLink
              to="/settings"
              title={t('nav.settings')}
              className={({ isActive }) =>
                cn(
                  'p-1 rounded-md transition-colors',
                  isActive ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                )
              }
            >
              <Settings size={14} />
            </NavLink>
            <button
              onClick={handleLogout}
              title={t('login.logout')}
              className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
