import { Hono, type Context } from 'hono'
import type { Member } from '../shared/types'
import { clearSessionCookie, readSessionId, sessionCookie } from './cookies'
import { safeEqual } from './crypto'
import type { Env } from './env'
import { cleanToken, fetchGitHubUser } from './github'

export { Office } from './office/Office'

type AppContext = Context<{ Bindings: Env }>

export function office(env: Env) {
  return env.OFFICE.get(env.OFFICE.idFromName('office'))
}

function sameOrigin(req: Request): boolean {
  return req.headers.get('Origin') === new URL(req.url).origin
}

function error(c: AppContext, status: 400 | 401 | 403 | 404 | 409 | 429 | 502, code: string): Response {
  return c.json({ error: code }, status)
}

function githubError(c: AppContext, e: 'bad_token' | 'github_error'): Response {
  return e === 'bad_token' ? error(c, 401, 'bad_token') : error(c, 502, 'github_error')
}

async function body(c: AppContext): Promise<Record<string, unknown>> {
  const json = await c.req.json().catch(() => null)
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
}

function withSession(c: AppContext, sessionId: string, payload: object): Response {
  c.header('Set-Cookie', sessionCookie(sessionId))
  return c.json(payload)
}

/** Resolves the signed-in member, or a 401 response. */
export async function requireMember(c: AppContext): Promise<Member | Response> {
  const sessionId = readSessionId(c.req.raw)
  const member = sessionId ? await office(c.env).getSession(sessionId) : null
  return member ?? error(c, 401, 'unauthorized')
}

export const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !sameOrigin(c.req.raw)) return error(c, 403, 'bad_origin')
  await next()
})

app.get('/api/setup', async (c) => c.json({ setUp: await office(c.env).isSetUp() }))

app.post('/api/setup', async (c) => {
  const { secret, token: rawToken } = await body(c)
  if (!c.env.SETUP_SECRET || typeof secret !== 'string' || !(await safeEqual(secret, c.env.SETUP_SECRET))) {
    return error(c, 403, 'bad_secret')
  }
  const o = office(c.env)
  if (await o.isSetUp()) return error(c, 409, 'already_setup')
  const token = cleanToken(rawToken)
  if (!token) return error(c, 401, 'bad_token')
  const user = await fetchGitHubUser(c.env.GITHUB_API_BASE, token)
  if (!user.ok) return githubError(c, user.error)
  const r = await o.setup(user.value)
  if (!r.ok) return error(c, 409, r.error)
  return withSession(c, r.value.sessionId, { inviteUrl: `${new URL(c.req.url).origin}/join/${r.value.inviteCode}` })
})

app.post('/api/join', async (c) => {
  const { code, token: rawToken } = await body(c)
  const o = office(c.env)
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const invite = await o.checkInvite(typeof code === 'string' ? code : '', ip)
  if (!invite.ok) return invite.error === 'rate_limited' ? error(c, 429, 'rate_limited') : error(c, 404, 'bad_invite')
  const token = cleanToken(rawToken)
  if (!token) return error(c, 401, 'bad_token')
  const user = await fetchGitHubUser(c.env.GITHUB_API_BASE, token)
  if (!user.ok) return githubError(c, user.error)
  const { sessionId } = await o.addMember(user.value)
  return withSession(c, sessionId, {})
})

app.post('/api/login', async (c) => {
  const token = cleanToken((await body(c)).token)
  if (!token) return error(c, 401, 'bad_token')
  const user = await fetchGitHubUser(c.env.GITHUB_API_BASE, token)
  if (!user.ok) return githubError(c, user.error)
  const r = await office(c.env).login(user.value)
  if (!r.ok) return error(c, 403, 'not_member')
  return withSession(c, r.value.sessionId, {})
})

app.post('/api/logout', async (c) => {
  const sessionId = readSessionId(c.req.raw)
  if (sessionId) await office(c.env).logout(sessionId)
  c.header('Set-Cookie', clearSessionCookie())
  return c.body(null, 204)
})

app.get('/api/me', async (c) => {
  const member = await requireMember(c)
  if (member instanceof Response) return member
  return c.json({ member, config: { org: c.env.GITHUB_ORG, slackTeamId: c.env.SLACK_TEAM_ID } })
})

app.all('/api/*', (c) => error(c, 404, 'not_found'))
app.all('/ws', (c) => error(c, 404, 'not_found'))
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
