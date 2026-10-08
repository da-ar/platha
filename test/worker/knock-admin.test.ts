import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { reset } from 'cloudflare:test'
import { stubGitHub } from './github-stub'
import { joinAs, post, request, setupAlice } from './http'
import { closeAll, connect, settle } from './ws'

let aliceCookie: string
let bobCookie: string
let inviteCode: string

beforeEach(async () => {
  stubGitHub()
  const s = await setupAlice()
  aliceCookie = s.cookie
  inviteCode = s.inviteCode
  bobCookie = await joinAs('tok-bob', inviteCode)
})

afterEach(async () => {
  closeAll()
  await settle()
  await reset()
})

const MEET = 'https://meet.google.com/abc-defg-hij'

describe('knocks', () => {
  test('knock relays to every socket of the callee with normalised meet url', async () => {
    const a = await connect(aliceCookie)
    const b1 = await connect(bobCookie)
    const b2 = await connect(bobCookie)
    await Promise.all([a.next('snapshot'), b1.next('snapshot'), b2.next('snapshot')])
    const knockId = crypto.randomUUID()
    a.send({ type: 'knock', knockId, to: 2, meetUrl: `${MEET}?authuser=0` })
    for (const b of [b1, b2]) {
      expect(await b.next('knock')).toEqual({ type: 'knock', knockId, from: 1, meetUrl: MEET })
    }
    expect(a.all('knock')).toEqual([])
    expect(await a.next('knock_ringing')).toEqual({ type: 'knock_ringing', knockId })
    expect(a.all('knock_ringing')).toHaveLength(1)
  })

  test('knock to offline member returns knock_failed offline to caller', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const knockId = crypto.randomUUID()
    a.send({ type: 'knock', knockId, to: 2, meetUrl: MEET })
    expect(await a.next('knock_failed')).toEqual({ type: 'knock_failed', knockId, reason: 'offline' })
    expect(a.all('knock_ringing')).toEqual([])
  })

  test('knock_answer reaches caller', async () => {
    const a = await connect(aliceCookie)
    const b = await connect(bobCookie)
    await Promise.all([a.next('snapshot'), b.next('snapshot')])
    const knockId = crypto.randomUUID()
    a.send({ type: 'knock', knockId, to: 2, meetUrl: MEET })
    await b.next('knock')
    b.send({ type: 'knock_answer', knockId, to: 1, answer: 'decline' })
    expect(await a.next('knock_answered')).toEqual({ type: 'knock_answered', knockId, answer: 'decline' })
  })

  test('knock to self or non-member is ignored', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    a.send({ type: 'knock', knockId: crypto.randomUUID(), to: 1, meetUrl: MEET })
    a.send({ type: 'knock', knockId: crypto.randomUUID(), to: 99, meetUrl: MEET })
    a.send({ type: 'set_status', status: 'away' })
    await a.next('member_updated', (m) => m.member.status === 'away')
    expect(a.all('knock')).toEqual([])
    expect(a.all('knock_failed')).toEqual([])
  })
})

describe('profile', () => {
  test('updateProfile normalises slack id and rejects channel ids', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const ok = await request('PATCH', '/api/profile', { cookie: bobCookie, body: { slackUserId: ' u01abcdef' } })
    expect(ok.status).toBe(200)
    expect((await ok.json<{ member: { slackUserId: string } }>()).member.slackUserId).toBe('U01ABCDEF')
    await a.next('member_updated', (m) => m.member.slackUserId === 'U01ABCDEF')

    const bad = await request('PATCH', '/api/profile', { cookie: bobCookie, body: { slackUserId: 'C123456' } })
    expect(bad.status).toBe(400)

    const cleared = await request('PATCH', '/api/profile', { cookie: bobCookie, body: { slackUserId: null } })
    expect((await cleared.json<{ member: { slackUserId: string | null } }>()).member.slackUserId).toBeNull()
  })

  test('profile requires a session', async () => {
    expect((await request('PATCH', '/api/profile', { body: { slackUserId: null } })).status).toBe(401)
  })
})

describe('admin', () => {
  test('removeMember revokes every socket of that member', async () => {
    const a = await connect(aliceCookie)
    const b1 = await connect(bobCookie)
    const b2 = await connect(bobCookie)
    await Promise.all([a.next('snapshot'), b1.next('snapshot'), b2.next('snapshot')])
    const res = await request('DELETE', '/api/admin/members/2', { cookie: aliceCookie })
    expect(res.status).toBe(204)
    for (const b of [b1, b2]) {
      await b.next('session_revoked')
      expect((await b.waitClosed()).code).toBe(4403)
    }
    expect(await a.next('member_removed')).toEqual({ type: 'member_removed', githubId: 2 })
    expect((await request('GET', '/api/me', { cookie: bobCookie })).status).toBe(401)
    await settle()
    const a2 = await connect(aliceCookie)
    const snap = await a2.next('snapshot')
    expect(snap.members.map((m) => m.githubId)).toEqual([1])
  })

  test('removed member can rejoin only with a current invite', async () => {
    await request('DELETE', '/api/admin/members/2', { cookie: aliceCookie })
    expect((await post('/api/login', { token: 'tok-bob' })).status).toBe(403)
    expect((await post('/api/join', { code: inviteCode, token: 'tok-bob' })).status).toBe(200)
  })

  test('admin cannot remove self; unknown member is 404', async () => {
    expect((await request('DELETE', '/api/admin/members/1', { cookie: aliceCookie })).status).toBe(400)
    expect((await request('DELETE', '/api/admin/members/99', { cookie: aliceCookie })).status).toBe(404)
    expect((await request('DELETE', '/api/admin/members/x', { cookie: aliceCookie })).status).toBe(404)
  })

  test('rotateInvite invalidates old code, existing members unaffected', async () => {
    const get = await request('GET', '/api/admin/invite', { cookie: aliceCookie })
    expect((await get.json<{ inviteUrl: string }>()).inviteUrl).toBe(`http://example.com/join/${inviteCode}`)
    const res = await request('POST', '/api/admin/invite/rotate', { cookie: aliceCookie })
    expect(res.status).toBe(200)
    const { inviteUrl } = await res.json<{ inviteUrl: string }>()
    const newCode = inviteUrl.split('/join/')[1]
    expect(newCode).not.toBe(inviteCode)
    expect((await post('/api/join', { code: inviteCode, token: 'tok-carol' })).status).toBe(404)
    expect((await post('/api/join', { code: newCode, token: 'tok-carol' })).status).toBe(200)
    expect((await request('GET', '/api/me', { cookie: bobCookie })).status).toBe(200)
  })

  test('admin routes are 403 for members', async () => {
    expect((await request('GET', '/api/admin/invite', { cookie: bobCookie })).status).toBe(403)
    expect((await request('POST', '/api/admin/invite/rotate', { cookie: bobCookie })).status).toBe(403)
    expect((await request('DELETE', '/api/admin/members/1', { cookie: bobCookie })).status).toBe(403)
  })
})
