import { getToken, logout } from './auth'

async function readErrorBody(resp: Response): Promise<unknown> {
  try {
    return await resp.clone().json()
  } catch {
    return await resp.clone().text().catch(() => null)
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let resp: Response
  try {
    resp = await fetch(input, { ...init, headers })
  } catch (err) {
    console.error(`[API] Network error: ${String(input)}`, err)
    throw err
  }

  if (!resp.ok) {
    const body = await readErrorBody(resp)
    console.error(`[API] ${resp.status} ${resp.statusText}: ${String(input)}`, body)
    if (resp.status === 401) {
      logout()
      window.location.href = '/login'
    }
  }

  return resp
}
