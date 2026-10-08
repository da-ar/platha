import { describe, expect, test } from 'vitest'
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import type { Office } from '../../src/worker/office/Office'
import { alice, bob, carol, freshOffice, setNow } from './helpers'

const T0 = Date.UTC(2026, 9, 8, 9, 0, 0)
const DAY = 24 * 60 * 60 * 1000

async function setUpOffice() {
  const office = freshOffice()
  await setNow(office, T0)
  const r = await office.setup(alice)
  if (!r.ok) throw new Error('setup failed')
  return { office, ...r.value }
}

describe('setup', () => {
  test('setup creates admin + invite + session, and only once', async () => {
    const office = freshOffice()
    const r = await office.setup(alice)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const me = await office.getSession(r.value.sessionId)
    expect(me?.role).toBe('admin')
    expect(me?.login).toBe('alice')
    expect(r.value.inviteCode).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(r.value.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await office.setup(bob)).toEqual({ ok: false, error: 'already_setup' })
  })

  test('isSetUp reports whether an admin exists', async () => {
    const office = freshOffice()
    expect(await office.isSetUp()).toBe(false)
    await office.setup(alice)
    expect(await office.isSetUp()).toBe(true)
  })
})

describe('checkInvite', () => {
  test('checkInvite accepts the code and rejects others', async () => {
    const { office, inviteCode } = await setUpOffice()
    expect(await office.checkInvite(inviteCode, '1.1.1.1')).toEqual({ ok: true, value: null })
    expect(await office.checkInvite('nope', '1.1.1.1')).toEqual({ ok: false, error: 'bad_invite' })
  })

  test('checkInvite rejects everything before setup', async () => {
    const office = freshOffice()
    expect(await office.checkInvite('', '1.1.1.1')).toEqual({ ok: false, error: 'bad_invite' })
  })

  test('checkInvite rate-limits after 10 failures per ip in 10 minutes', async () => {
    const { office, inviteCode } = await setUpOffice()
    for (let i = 0; i < 10; i++) {
      expect(await office.checkInvite('wrong', '1.1.1.1')).toEqual({ ok: false, error: 'bad_invite' })
    }
    expect(await office.checkInvite(inviteCode, '1.1.1.1')).toEqual({ ok: false, error: 'rate_limited' })
    expect(await office.checkInvite(inviteCode, '2.2.2.2')).toEqual({ ok: true, value: null })
    await setNow(office, T0 + 10 * 60 * 1000 + 1)
    expect(await office.checkInvite(inviteCode, '1.1.1.1')).toEqual({ ok: true, value: null })
  })
})

describe('members and sessions', () => {
  test('addMember creates a member session', async () => {
    const { office } = await setUpOffice()
    const { sessionId } = await office.addMember(bob)
    const me = await office.getSession(sessionId)
    expect(me).toMatchObject({ githubId: 2, login: 'bob', name: 'Bob', role: 'member', status: 'available', slackUserId: null })
  })

  test('addMember with known id updates login, name and avatar', async () => {
    const { office } = await setUpOffice()
    const { sessionId } = await office.addMember({ ...alice, login: 'alice2', name: 'Alice Two', avatarUrl: 'https://a/2' })
    const me = await office.getSession(sessionId)
    expect(me).toMatchObject({ githubId: 1, login: 'alice2', name: 'Alice Two', avatarUrl: 'https://a/2', role: 'admin' })
    const count = await runInDurableObject(office, (_o: Office, state) => state.storage.sql.exec('SELECT COUNT(*) AS n FROM members').one().n)
    expect(count).toBe(1)
  })

  test('login rejects unknown ids', async () => {
    const { office } = await setUpOffice()
    expect(await office.login(carol)).toEqual({ ok: false, error: 'not_member' })
  })

  test('login refreshes profile and creates a session for members', async () => {
    const { office } = await setUpOffice()
    await office.addMember(bob)
    const r = await office.login({ ...bob, name: 'Robert' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((await office.getSession(r.value.sessionId))?.name).toBe('Robert')
  })

  test('expired session returns null', async () => {
    const { office, sessionId } = await setUpOffice()
    await setNow(office, T0 + 30 * DAY - 1)
    expect(await office.getSession(sessionId)).not.toBeNull()
    await setNow(office, T0 + 30 * DAY + 1)
    expect(await office.getSession(sessionId)).toBeNull()
    await setNow(office, T0)
    expect(await office.getSession(sessionId)).toBeNull()
  })

  test('logout deletes the session', async () => {
    const { office, sessionId } = await setUpOffice()
    await office.logout(sessionId)
    expect(await office.getSession(sessionId)).toBeNull()
  })

  test('getInvite is admin-only', async () => {
    const { office, inviteCode } = await setUpOffice()
    await office.addMember(bob)
    expect(await office.getInvite(1)).toEqual({ ok: true, value: inviteCode })
    expect(await office.getInvite(2)).toEqual({ ok: false, error: 'forbidden' })
    expect(await office.getInvite(99)).toEqual({ ok: false, error: 'forbidden' })
  })
})

describe('join failure cleanup', () => {
  const countFailures = (office: ReturnType<typeof freshOffice>) =>
    runInDurableObject(office, (_o: Office, state) => state.storage.sql.exec('SELECT COUNT(*) AS n FROM join_failures').one().n)

  test('failed joins are deleted by the alarm once they are 10 minutes old', async () => {
    const { office } = await setUpOffice()
    await office.checkInvite('wrong', '1.1.1.1')
    await setNow(office, T0 + 5 * 60 * 1000)
    await office.checkInvite('wrong', '2.2.2.2')
    expect(await countFailures(office)).toBe(2)

    // A failure schedules the cleanup alarm even with nobody connected.
    await setNow(office, T0 + 10 * 60 * 1000 + 1)
    expect(await runDurableObjectAlarm(office)).toBe(true)
    expect(await countFailures(office)).toBe(1)

    // The alarm is rescheduled for the remaining record.
    await setNow(office, T0 + 15 * 60 * 1000 + 1)
    expect(await runDurableObjectAlarm(office)).toBe(true)
    expect(await countFailures(office)).toBe(0)

    // Nothing left to clean up, so no further alarm.
    expect(await runDurableObjectAlarm(office)).toBe(false)
  })

  test('recent failures survive the alarm and still count toward the limit', async () => {
    const { office, inviteCode } = await setUpOffice()
    for (let i = 0; i < 10; i++) await office.checkInvite('wrong', '1.1.1.1')
    await setNow(office, T0 + 60 * 1000)
    await runDurableObjectAlarm(office)
    expect(await countFailures(office)).toBe(10)
    expect(await office.checkInvite(inviteCode, '1.1.1.1')).toEqual({ ok: false, error: 'rate_limited' })
  })
})
