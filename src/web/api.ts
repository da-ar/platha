import type { Member } from '../shared/types'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number }

export interface OfficeConfig {
  org: string
  slackTeamId: string
}

export interface Me {
  member: Member
  config: OfficeConfig
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0 }
  }
  if (!res.ok) return { ok: false, status: res.status }
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined)
  return { ok: true, data: data as T }
}

export const me = () => call<Me>('GET', '/api/me')
export const setupStatus = () => call<{ setUp: boolean }>('GET', '/api/setup')
export const setup = (secret: string, token: string) => call<{ inviteUrl: string }>('POST', '/api/setup', { secret, token: token.trim() })
export const join = (code: string, token: string) => call<object>('POST', '/api/join', { code, token: token.trim() })
export const login = (token: string) => call<object>('POST', '/api/login', { token: token.trim() })
export const logout = () => call<void>('POST', '/api/logout')
export const updateProfile = (slackUserId: string | null) => call<{ member: Member }>('PATCH', '/api/profile', { slackUserId })
export const getInvite = () => call<{ inviteUrl: string }>('GET', '/api/admin/invite')
export const rotateInvite = () => call<{ inviteUrl: string }>('POST', '/api/admin/invite/rotate')
export const removeMember = (githubId: number) => call<void>('DELETE', `/api/admin/members/${githubId}`)
