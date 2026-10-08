import { afterEach, describe, expect, test } from 'vitest'
import { reset, runInDurableObject } from 'cloudflare:test'
import type { Office } from '../../src/worker/office/Office'
import { stubGitHub } from './github-stub'
import { mainOffice } from './helpers'
import { cookieFrom, joinAs, post, request, setupAlice } from './http'

afterEach(async () => {
  await reset()
})

describe('setup', () => {
  test('setup with right secret creates admin and returns invite url', async () => {
    stubGitHub()
    const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-alice' })
    expect(res.status).toBe(200)
    const body = await res.json<{ inviteUrl: string }>()
    expect(body.inviteUrl).toMatch(/^http:\/\/example\.com\/join\/[\w-]{22}$/)
    const cookie = res.headers.get('Set-Cookie') ?? ''
    for (const part of ['platha_session=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000']) {
      expect(cookie).toContain(part)
    }
  })

  test('setup with wrong secret is 403 and never calls GitHub', async () => {
    const seen = stubGitHub()
    const res = await post('/api/setup', { secret: 'nope', token: 'tok-alice' })
    expect(res.status).toBe(403)
    expect(seen).toEqual([])
  })

  test('second setup is 409', async () => {
    stubGitHub()
    await setupAlice()
    const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-bob' })
    expect(res.status).toBe(409)
  })

  test('setup status reports whether an admin exists', async () => {
    stubGitHub()
    expect(await (await request('GET', '/api/setup')).json()).toEqual({ setUp: false })
    await setupAlice()
    expect(await (await request('GET', '/api/setup')).json()).toEqual({ setUp: true })
  })

  test('setup with GitHub down is 502', async () => {
    stubGitHub({ status: 500 })
    const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-alice' })
    expect(res.status).toBe(502)
  })
})

describe('join and login', () => {
  test('join trims the pasted token', async () => {
    const seen = stubGitHub()
    const { inviteCode } = await setupAlice()
    const res = await post('/api/join', { code: inviteCode, token: 'tok-bob\n ' })
    expect(res.status).toBe(200)
    expect(seen.at(-1)).toBe('Bearer tok-bob')
  })

  test('join with bad invite is 404', async () => {
    const seen = stubGitHub()
    await setupAlice()
    const res = await post('/api/join', { code: 'wrong', token: 'tok-bob' })
    expect(res.status).toBe(404)
    // Only setup's two calls (/user and /user/emails); the bad invite never reaches GitHub.
    expect(seen).toHaveLength(2)
  })

  test('join is rate limited after 10 bad codes', async () => {
    stubGitHub()
    const { inviteCode } = await setupAlice()
    for (let i = 0; i < 10; i++) {
      await post('/api/join', { code: 'wrong', token: 'tok-bob' }, { 'CF-Connecting-IP': '9.9.9.9' })
    }
    const res = await post('/api/join', { code: inviteCode, token: 'tok-bob' }, { 'CF-Connecting-IP': '9.9.9.9' })
    expect(res.status).toBe(429)
  })

  test('join with revoked GitHub token is 401', async () => {
    stubGitHub()
    const { inviteCode } = await setupAlice()
    const res = await post('/api/join', { code: inviteCode, token: 'tok-revoked' })
    expect(res.status).toBe(401)
  })

  test('login works for existing member without invite', async () => {
    stubGitHub()
    const { inviteCode } = await setupAlice()
    await joinAs('tok-bob', inviteCode)
    const res = await post('/api/login', { token: 'tok-bob' })
    expect(res.status).toBe(200)
    const me = await request('GET', '/api/me', { cookie: cookieFrom(res) })
    expect((await me.json<{ member: { login: string } }>()).member.login).toBe('bob')
  })

  test('login for a non-member is 403', async () => {
    stubGitHub()
    await setupAlice()
    const res = await post('/api/login', { token: 'tok-carol' })
    expect(res.status).toBe(403)
  })
})

describe('session', () => {
  test('me returns member and config; 401 without cookie', async () => {
    stubGitHub()
    const { cookie } = await setupAlice()
    const res = await request('GET', '/api/me', { cookie })
    expect(res.status).toBe(200)
    const body = await res.json<{ member: { login: string; role: string }; config: unknown }>()
    expect(body.member).toMatchObject({ login: 'alice', role: 'admin' })
    expect(body.config).toEqual({ org: 'acme', slackTeamId: 'T0000000' })
    expect((await request('GET', '/api/me')).status).toBe(401)
  })

  test('logout clears the session', async () => {
    stubGitHub()
    const { cookie } = await setupAlice()
    const res = await request('POST', '/api/logout', { cookie })
    expect(res.status).toBe(204)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect((await request('GET', '/api/me', { cookie })).status).toBe(401)
  })

  test('mutating route with foreign Origin is 403', async () => {
    const seen = stubGitHub()
    const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-alice' }, { Origin: 'http://evil.io' })
    expect(res.status).toBe(403)
    expect(seen).toEqual([])
  })

  test('unknown api route is 404', async () => {
    expect((await request('GET', '/api/nope')).status).toBe(404)
  })

  test('token never appears in responses or stored rows', async () => {
    stubGitHub()
    const { inviteCode } = await setupAlice()
    const res = await post('/api/join', { code: inviteCode, token: 'tok-bob' })
    expect(await res.text()).not.toContain('tok-')
    const dump = await runInDurableObject(mainOffice(), (_o, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'")
        .toArray()
      return tables.map((t) => state.storage.sql.exec(`SELECT * FROM "${t.name}"`).toArray())
    })
    expect(JSON.stringify(dump)).not.toContain('tok-')
  })
})

describe('me resilience', () => {
  test('me still returns the member if an extra lookup fails', async () => {
    stubGitHub()
    const { cookie } = await setupAlice()
    await runInDurableObject(mainOffice(), (o: Office) => {
      o.getCalendar = async () => {
        throw new Error('getCalendar is not a function on this version')
      }
    })
    const res = await request('GET', '/api/me', { cookie })
    expect(res.status).toBe(200)
    const body = await res.json<{ member: { login: string }; calendarState: string; meetUrl: null }>()
    expect(body.member.login).toBe('alice')
    expect(body.calendarState).toBe('no_email')
    expect(body.meetUrl).toBeNull()
  })
})
