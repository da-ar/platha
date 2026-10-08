import { z } from 'zod'
import type { Result } from '../shared/types'

export interface GitHubIdentity {
  id: number
  login: string
  name: string | null
  avatarUrl: string
}

const UserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string(),
})

/** A pasted token must be a single run of printable ASCII; anything else can't be a GitHub token. */
export function cleanToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const token = raw.trim()
  return /^[\x21-\x7e]{1,255}$/.test(token) ? token : null
}

/**
 * Looks up the token's owner. The token is used for this one request and never
 * logged or included in an error.
 */
export async function fetchGitHubUser(apiBase: string, token: string): Promise<Result<GitHubIdentity, 'bad_token' | 'github_error'>> {
  let res: Response
  try {
    res = await fetch(`${apiBase}/user`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'platha', Accept: 'application/vnd.github+json' },
    })
  } catch {
    return { ok: false, error: 'github_error' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_token' }
  if (!res.ok) return { ok: false, error: 'github_error' }
  const parsed = UserSchema.safeParse(await res.json().catch(() => null))
  if (!parsed.success) return { ok: false, error: 'github_error' }
  const u = parsed.data
  return { ok: true, value: { id: u.id, login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url } }
}
