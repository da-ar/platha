export type Status = 'available' | 'focusing' | 'away'
export type Role = 'admin' | 'member'

export interface Member {
  githubId: number
  login: string
  name: string | null
  avatarUrl: string
  slackUserId: string | null
  role: Role
  status: Status
  statusText: string | null
  online: boolean
}

export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E }

export const STATUSES: readonly Status[] = ['available', 'focusing', 'away']

export function displayName(m: Pick<Member, 'name' | 'login'>): string {
  return m.name?.trim() || m.login
}
