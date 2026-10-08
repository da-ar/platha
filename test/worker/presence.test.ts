import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SELF, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import type { Office } from '../../src/worker/office/Office'
import { stubGitHub } from './github-stub'
import { mainOffice, setNow } from './helpers'
import { ORIGIN, joinAs, request, setupAlice } from './http'
import { closeAll, connect, settle } from './ws'

let T0: number
let aliceCookie: string
let bobCookie: string

beforeEach(async () => {
  stubGitHub()
  T0 = Date.now()
  await setNow(mainOffice(), T0)
  const s = await setupAlice()
  aliceCookie = s.cookie
  bobCookie = await joinAs('tok-bob', s.inviteCode)
})

afterEach(async () => {
  closeAll()
  await settle()
  await reset()
})

async function onlineOf(githubId: number): Promise<boolean | undefined> {
  return runInDurableObject(mainOffice(), async (o: Office) => (await o.snapshot()).find((m) => m.githubId === githubId)?.online)
}

describe('connecting', () => {
  test('ws without session is 401; foreign origin is 403', async () => {
    const noCookie = await SELF.fetch(`${ORIGIN}/ws`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } })
    expect(noCookie.status).toBe(401)
    const foreign = await SELF.fetch(`${ORIGIN}/ws`, { headers: { Upgrade: 'websocket', Origin: 'http://evil.io', Cookie: aliceCookie } })
    expect(foreign.status).toBe(403)
  })

  test('client cannot impersonate another member via X-Platha-Member', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const res = await SELF.fetch(`${ORIGIN}/ws`, {
      headers: { Upgrade: 'websocket', Origin: ORIGIN, Cookie: bobCookie, 'X-Platha-Member': '1' },
    })
    res.webSocket!.accept()
    await a.next('member_updated', (m) => m.member.githubId === 2 && m.member.online)
    res.webSocket!.close()
  })

  test('connect sends snapshot including self online', async () => {
    const a = await connect(aliceCookie)
    const snap = await a.next('snapshot')
    expect(snap.members.find((m) => m.login === 'alice')?.online).toBe(true)
    expect(snap.members.find((m) => m.login === 'bob')?.online).toBe(false)
  })

  test('second member sees first come online', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    await connect(bobCookie)
    const upd = await a.next('member_updated', (m) => m.member.githubId === 2)
    expect(upd.member.online).toBe(true)
  })

  test('me reports online while connected', async () => {
    await (await connect(aliceCookie)).next('snapshot')
    const res = await request('GET', '/api/me', { cookie: aliceCookie })
    expect((await res.json<{ member: { online: boolean } }>()).member.online).toBe(true)
  })
})

describe('going offline', () => {
  test('closing one of two tabs keeps member online', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const b1 = await connect(bobCookie)
    const b2 = await connect(bobCookie)
    await b1.next('snapshot')
    await b2.next('snapshot')
    b1.ws.close()
    await settle()
    await setNow(mainOffice(), T0 + 31_000)
    await runDurableObjectAlarm(mainOffice())
    expect(a.all('member_updated').filter((m) => m.member.githubId === 2 && !m.member.online)).toEqual([])
    expect(await onlineOf(2)).toBe(true)
  })

  test('closing last tab: still online during grace, offline after 30s alarm', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const b = await connect(bobCookie)
    await b.next('snapshot')
    b.ws.close()
    await settle()
    await setNow(mainOffice(), T0 + 29_000)
    await runDurableObjectAlarm(mainOffice())
    expect(await onlineOf(2)).toBe(true)
    expect(a.all('member_updated').some((m) => m.member.githubId === 2 && !m.member.online)).toBe(false)
    await setNow(mainOffice(), T0 + 31_000)
    expect(await runDurableObjectAlarm(mainOffice())).toBe(true)
    const off = await a.next('member_updated', (m) => m.member.githubId === 2 && !m.member.online)
    expect(off.member.online).toBe(false)
    expect(await onlineOf(2)).toBe(false)
  })

  test('reconnect within grace does not broadcast offline', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const b = await connect(bobCookie)
    await a.next('member_updated', (m) => m.member.githubId === 2 && m.member.online)
    b.ws.close()
    await settle()
    await setNow(mainOffice(), T0 + 10_000)
    const b2 = await connect(bobCookie)
    await b2.next('snapshot')
    await setNow(mainOffice(), T0 + 31_000)
    await runDurableObjectAlarm(mainOffice())
    const bobUpdates = a.all('member_updated').filter((m) => m.member.githubId === 2)
    expect(bobUpdates.every((m) => m.member.online)).toBe(true)
    expect(bobUpdates).toHaveLength(1)
  })

  test('stale socket with no ping for 60s is closed and goes offline after grace', async () => {
    const b = await connect(bobCookie)
    await b.next('snapshot')
    await setNow(mainOffice(), T0 + 61_000)
    await runDurableObjectAlarm(mainOffice())
    expect((await b.waitClosed()).code).toBe(4408)
    expect(await onlineOf(2)).toBe(true)
    await setNow(mainOffice(), T0 + 92_000)
    await runDurableObjectAlarm(mainOffice())
    expect(await onlineOf(2)).toBe(false)
  })
})

describe('status', () => {
  test('set_status persists and broadcasts; survives reconnect', async () => {
    const a = await connect(aliceCookie)
    await a.next('snapshot')
    const b = await connect(bobCookie)
    await b.next('snapshot')
    b.send({ type: 'set_status', status: 'focusing', text: '  deep in the parser ' })
    const upd = await a.next('member_updated', (m) => m.member.githubId === 2 && m.member.status === 'focusing')
    expect(upd.member.statusText).toBe('deep in the parser')
    b.ws.close()
    const b2 = await connect(bobCookie)
    const snap = await b2.next('snapshot')
    expect(snap.members.find((m) => m.githubId === 2)).toMatchObject({ status: 'focusing', statusText: 'deep in the parser' })
  })

  test('invalid client message is ignored and socket stays open', async () => {
    const b = await connect(bobCookie)
    await b.next('snapshot')
    b.send('garbage')
    b.send({ type: 'set_status', status: 'busy' })
    b.send({ type: 'set_status', status: 'away' })
    const upd = await b.next('member_updated', (m) => m.member.status === 'away')
    expect(upd.member.githubId).toBe(2)
    expect(b.closed).toBeNull()
  })
})
