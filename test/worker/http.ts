import { SELF } from 'cloudflare:test'

export const ORIGIN = 'http://example.com'

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  })
}

export function request(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { Origin: opts.origin ?? ORIGIN }
  if (opts.cookie) headers.Cookie = opts.cookie
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

export function cookieFrom(res: Response): string {
  const set = res.headers.get('Set-Cookie') ?? ''
  const match = /platha_session=([^;]+)/.exec(set)
  if (!match) throw new Error(`no session cookie in ${set}`)
  return `platha_session=${match[1]}`
}

/** Sets up the office as alice and returns her cookie and the invite code. */
export async function setupAlice(): Promise<{ cookie: string; inviteCode: string }> {
  const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-alice' })
  if (res.status !== 200) throw new Error(`setup failed: ${res.status}`)
  const { inviteUrl } = await res.json<{ inviteUrl: string }>()
  return { cookie: cookieFrom(res), inviteCode: inviteUrl.split('/join/')[1] }
}

export async function joinAs(token: string, inviteCode: string): Promise<string> {
  const res = await post('/api/join', { code: inviteCode, token })
  if (res.status !== 200) throw new Error(`join failed: ${res.status}`)
  return cookieFrom(res)
}
