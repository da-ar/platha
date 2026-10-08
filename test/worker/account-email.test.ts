import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reset } from 'cloudflare:test'
import { normalizeDomain, pickEmail } from '../../src/worker/github'
import { cookieFrom, post, request } from './http'
import { closeAll, connect, settle } from './ws'

const v = (email: string, primary = false, verified = true) => ({ email, primary, verified })

describe('pickEmail', () => {
  test('a verified address at the company domain beats the primary', () => {
    expect(pickEmail([v('me@gmail.com', true), v('Me@Acme.dev')], null, 'acme.dev')).toEqual({ email: 'me@acme.dev', source: 'account' })
  })

  test('unverified addresses are ignored', () => {
    expect(pickEmail([v('me@acme.dev', false, false), v('me@gmail.com', true)], null, 'acme.dev')).toEqual({ email: 'me@gmail.com', source: 'account' })
  })

  test('no domain: the primary verified address', () => {
    expect(pickEmail([v('a@x.dev'), v('b@y.dev', true)], 'pub@z.dev', null)).toEqual({ email: 'b@y.dev', source: 'account' })
  })

  test('no readable account emails: the public email', () => {
    expect(pickEmail(null, 'pub@acme.dev', 'acme.dev')).toEqual({ email: 'pub@acme.dev', source: 'public' })
    expect(pickEmail(null, 'pub@other.dev', null)).toEqual({ email: 'pub@other.dev', source: 'public' })
    expect(pickEmail([], null, null)).toBeNull()
  })

  test('domain set but nothing matches: public email, then primary', () => {
    expect(pickEmail([v('me@gmail.com', true)], 'pub@other.dev', 'acme.dev')).toEqual({ email: 'pub@other.dev', source: 'public' })
    expect(pickEmail([v('me@gmail.com', true)], null, 'acme.dev')).toEqual({ email: 'me@gmail.com', source: 'account' })
  })

  test('normalizeDomain', () => {
    expect(normalizeDomain(' @Acme.Dev ')).toBe('acme.dev')
    for (const bad of ['', 'acme', 'acme.dev/x', 'a b.dev', undefined]) expect(normalizeDomain(bad)).toBeNull()
  })
})

let emailsResponse: () => Response | 'network'

beforeEach(() => {
  emailsResponse = () => Response.json([{ email: 'Bob@Acme.dev', primary: true, verified: true, visibility: 'private' }])
  const original = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    if (!req.url.startsWith('https://api.github.com/')) return original(input, init)
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    const login = token === 'tok-alice' ? 'alice' : token === 'tok-bob' ? 'bob' : null
    if (!login) return new Response('{}', { status: 401 })
    if (req.url.endsWith('/user/emails')) {
      if (login === 'alice') return new Response('{}', { status: 403 })
      const r = emailsResponse()
      if (r === 'network') throw new TypeError('network down')
      return r
    }
    return Response.json({ id: login === 'alice' ? 1 : 2, login, name: null, avatar_url: 'https://a', email: login === 'alice' ? 'alice@acme.dev' : null })
  })
})

afterEach(async () => {
  closeAll()
  await settle()
  await reset()
})

async function joinBob(): Promise<{ alice: string; bob: string }> {
  const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-alice' })
  const code = (await res.json<{ inviteUrl: string }>()).inviteUrl.split('/join/')[1]
  const bob = await post('/api/join', { code, token: 'tok-bob' })
  expect(bob.status).toBe(200)
  return { alice: cookieFrom(res), bob: cookieFrom(bob) }
}

type MeBody = { email: string | null; emailSource: string | null; calendarState: string }

describe('sign-in with account emails', () => {
  test('a private account email is used when the token can read it', async () => {
    const c = await joinBob()
    expect(await (await request('GET', '/api/me', { cookie: c.bob })).json<MeBody>()).toMatchObject({
      email: 'bob@acme.dev',
      emailSource: 'account',
      calendarState: 'pending',
    })
  })

  test('without the permission (403) the public email is used and sign-in works', async () => {
    const c = await joinBob()
    expect(await (await request('GET', '/api/me', { cookie: c.alice })).json<MeBody>()).toMatchObject({ email: 'alice@acme.dev', emailSource: 'public' })
  })

  test('GitHub failing on emails never blocks sign-in', async () => {
    emailsResponse = () => new Response('oops', { status: 500 })
    const c = await joinBob()
    expect(await (await request('GET', '/api/me', { cookie: c.bob })).json<MeBody>()).toMatchObject({ email: null, emailSource: null, calendarState: 'no_email' })
    emailsResponse = () => 'network'
    expect((await post('/api/login', { token: 'tok-bob' })).status).toBe(200)
  })

  test('the email and its source never reach other members', async () => {
    const c = await joinBob()
    const a = await connect(c.alice)
    await a.next('snapshot')
    await post('/api/login', { token: 'tok-bob' })
    await connect(c.bob)
    await a.next('member_updated', (m) => m.member.githubId === 2)
    const seen = JSON.stringify(a.messages) + (await (await request('GET', '/api/calendar/2', { cookie: c.alice })).text())
    expect(seen).not.toContain('acme.dev')
    expect(seen).not.toContain('account')
  })
})
