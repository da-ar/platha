import { z } from 'zod'
import type { Result } from '../shared/types'
import { normalizeEmail } from './calendar'

export interface GitHubIdentity {
  id: number
  login: string
  name: string | null
  avatarUrl: string
  /** Email used to find their public Google Calendar. */
  email?: string | null
  /** Where `email` came from: the account's (possibly private) emails, or the public profile. */
  emailSource?: EmailSource | null
}

export type EmailSource = 'account' | 'public'

const EmailsSchema = z.array(z.object({ email: z.string(), primary: z.boolean().optional(), verified: z.boolean().optional() }))
type AccountEmail = z.infer<typeof EmailsSchema>[number]

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const d = raw.trim().toLowerCase().replace(/^@/, '')
  return DOMAIN.test(d) ? d : null
}

/**
 * Picks the address to look up a calendar with: a verified account email at the
 * company domain if one is configured, else the primary verified one, else the
 * public profile email.
 */
export function pickEmail(
  accountEmails: AccountEmail[] | null,
  publicEmail: string | null,
  domain: string | null,
): { email: string; source: EmailSource } | null {
  const verified = (accountEmails ?? [])
    .filter((e) => e.verified)
    .map((e) => ({ email: normalizeEmail(e.email), primary: e.primary === true }))
    .filter((e): e is { email: string; primary: boolean } => e.email !== null)
  if (domain) {
    const match = verified.find((e) => e.email.endsWith(`@${domain}`))
    if (match) return { email: match.email, source: 'account' }
    if (publicEmail?.endsWith(`@${domain}`)) return { email: publicEmail, source: 'public' }
  }
  const primary = verified.find((e) => e.primary)
  if (primary && !domain) return { email: primary.email, source: 'account' }
  if (publicEmail) return { email: publicEmail, source: 'public' }
  if (primary) return { email: primary.email, source: 'account' }
  return null
}

/** The account's emails, or null if the token can't read them (missing permission) or GitHub fails. */
async function fetchAccountEmails(apiBase: string, token: string): Promise<AccountEmail[] | null> {
  try {
    const res = await fetch(`${apiBase}/user/emails`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'platha', Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const parsed = EmailsSchema.safeParse(await res.json().catch(() => null))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const UserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string(),
  email: z.string().nullable().optional(),
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
export async function fetchGitHubUser(
  apiBase: string,
  token: string,
  calendarDomain?: string,
): Promise<Result<GitHubIdentity, 'bad_token' | 'github_error'>> {
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
  // Never fails sign-in: without the permission (or on any error) we fall back to the public email.
  const picked = pickEmail(await fetchAccountEmails(apiBase, token), normalizeEmail(u.email), normalizeDomain(calendarDomain))
  return {
    ok: true,
    value: { id: u.id, login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url, email: picked?.email ?? null, emailSource: picked?.source ?? null },
  }
}
