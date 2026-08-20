const AUTH_KEY = 'cwc_auth'
const TOKEN_KEY = 'cwc_token'
const USER_KEY = 'cwc_user'

const API = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, '')

export interface AuthUser {
  id: number
  email: string
  username: string
  app_id: string
}

async function extractErrorMessage(resp: Response, fallback: string): Promise<string> {
  const data = await resp.clone().json().catch(() => resp.text().catch(() => null))
  console.error(`[Auth] ${resp.status} ${resp.statusText} ${resp.url}`, data)
  if (resp.status === 401) return '邮箱、密码或验证码不正确'
  if (resp.status === 422) {
    if (Array.isArray(data?.detail)) {
      const msg = data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('；')
      if (msg) return msg
    }
    return '请求参数有误，请检查填写内容'
  }
  if (resp.status >= 500) return '服务器出错，请稍后重试'
  if (typeof data?.message === 'string') return data.message
  if (typeof data?.detail === 'string') return data.detail
  return fallback
}

async function postJson(path: string, body: unknown, fallback: string): Promise<Response> {
  let resp: Response
  try {
    resp = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`[Auth] Network error calling ${path}`, err)
    throw new Error('网络连接失败，请检查网络后重试')
  }
  if (!resp.ok) {
    throw new Error(await extractErrorMessage(resp, fallback))
  }
  return resp
}

export async function requestVerificationCode(email: string, type: 'register' | 'login', password?: string): Promise<void> {
  await postJson(
    '/api/auth/send-code',
    type === 'login' ? { email, type, password } : { email, type },
    '获取验证码失败'
  )
}

export async function login(email: string, password: string, code: string): Promise<void> {
  const resp = await postJson('/api/auth/login', { email, password, code }, '登录失败')
  const data = await resp.json().catch(() => null)
  localStorage.setItem(AUTH_KEY, '1')
  if (data?.access_token) {
    localStorage.setItem(TOKEN_KEY, data.access_token)
  }
  if (data?.user) {
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
  }
}

export async function register(username: string, email: string, password: string, code: string, appId: string): Promise<void> {
  await postJson('/api/auth/register', { email, username, password, code, appId }, '注册失败')
}

export function logout(): void {
  localStorage.removeItem(AUTH_KEY)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return localStorage.getItem(AUTH_KEY) === '1'
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}
