import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ko from './locales/ko'
import zh from './locales/zh'
import en from './locales/en'
import ja from './locales/ja'

export type Lang = 'ko' | 'zh' | 'en' | 'ja'

export const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: 'zh', label: '简体中文', flag: '🇨🇳' },
  { code: 'en', label: 'EN',   flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
]

const saved = (localStorage.getItem('lang') as Lang) || 'en'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: saved,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

export function setLang(lang: Lang) {
  i18n.changeLanguage(lang)
  localStorage.setItem('lang', lang)
}

/** For Date#toLocaleString / Intl */
export function bcp47ForI18n(lng: string) {
  const base = (lng || 'en').split('-')[0] as Lang | string
  const map: Record<string, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
  }
  return map[base] ?? 'en-US'
}

export default i18n
