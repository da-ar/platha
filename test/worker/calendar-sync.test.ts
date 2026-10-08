import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reset, runInDurableObject } from 'cloudflare:test'
import type { Office } from '../../src/worker/office/Office'
import { mainOffice, setNow } from './helpers'
import { ORIGIN, cookieFrom, post, request } from './http'
import { closeAll, connect, settle } from './ws'

const T0 = Date.UTC(2026, 9, 8, 8, 0, 0) // 09:00 London
const MIN = 60_000

const people: Record<string, { id: number; login: string; name: string; avatar_url: string; email: string | null }> = {
  'tok-alice': { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://avatars.githubusercontent.com/u/1', email: 'Alice@Acme.dev' },
  'tok-bob': { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://avatars.githubusercontent.com/u/2', email: null },
  'tok-carol': { id: 3, login: 'carol', name: 'Carol', avatar_url: 'https://avatars.githubusercontent.com/u/3', email: 'carol@acme.dev' },
  'tok-dan': { id: 4, login: 'dan', name: 'Dan', avatar_url: 'https://avatars.githubusercontent.com/u/4', email: 'dan@acme.dev' },
  'tok-erin': { id: 5, login: 'erin', name: 'Erin', avatar_url: 'https://avatars.githubusercontent.com/u/5', email: 'erin@acme.dev' },
}

/** A calendar with a meeting 10:00–11:00 UTC on 8 Oct. */
function ics(summary = 'Busy'): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:m1',
    'DTSTART:20261008T100000Z',
    'DTEND:20261008T110000Z',
    `SUMMARY:${summary}`,
    'LOCATION:Board room',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

let calendarResponse: (email: string) => Response
const calendarHits: string[] = []

beforeEach(async () => {
  calendarHits.length = 0
  calendarResponse = () => new Response(ics(), { headers: { 'Content-Type': 'text/calendar' } })
  const original = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    if (req.url.startsWith('https://api.github.com/')) {
      const user = people[(req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')]
      return user ? Response.json(user) : new Response('{}', { status: 401 })
    }
    const m = /^https:\/\/calendar\.google\.com\/calendar\/ical\/([^/]+)\/public\/basic\.ics$/.exec(req.url)
    if (m) {
      const email = decodeURIComponent(m[1])
      calendarHits.push(email)
      return calendarResponse(email)
    }
    return original(input, init)
  })
  await setNow(mainOffice(), T0)
})

afterEach(async () => {
  closeAll()
  await settle()
  await reset()
})

async function setupAll(...tokens: string[]): Promise<Record<string, string>> {
  const cookies: Record<string, string> = {}
  const res = await post('/api/setup', { secret: 'test-secret', token: 'tok-alice' })
  cookies.alice = cookieFrom(res)
  const code = (await res.json<{ inviteUrl: string }>()).inviteUrl.split('/join/')[1]
  for (const t of tokens) {
    const r = await post('/api/join', { code, token: t })
    cookies[people[t].login] = cookieFrom(r)
  }
  return cookies
}

const at = (ms: number) => setNow(mainOffice(), ms)
const alarm = () => runInDurableObject(mainOffice(), (o: Office) => o.alarm())
const sync = (id: number) =>
  runInDurableObject(mainOffice(), (_o: Office, state) => state.storage.sql.exec('SELECT * FROM calendar_sync WHERE github_id = ?', id).toArray()[0] as Record<string, unknown>)

describe('email', () => {
  test('public email is captured at join, lowercased, and shown only to its owner', async () => {
    const c = await setupAll('tok-bob')
    const alice = await (await request('GET', '/api/me', { cookie: c.alice })).json<{ email: string; calendarState: string }>()
    expect(alice.email).toBe('alice@acme.dev')
    expect(alice.calendarState).toBe('pending')
    const bob = await (await request('GET', '/api/me', { cookie: c.bob })).json<{ email: string | null; calendarState: string }>()
    expect(bob).toMatchObject({ email: null, calendarState: 'no_email' })
  })

  test('no public email: never fetched', async () => {
    await setupAll('tok-bob')
    await alarm()
    expect(calendarHits).toEqual(['alice@acme.dev'])
    expect(sync(2)).resolves.toMatchObject({ state: 'no_email', next_at: null })
  })

  test('a changed email at sign-in restarts the sync', async () => {
    await setupAll()
    await alarm()
    expect(await sync(1)).toMatchObject({ state: 'ok', email: 'alice@acme.dev' })
    people['tok-alice'].email = 'alice@new.dev'
    try {
      await post('/api/login', { token: 'tok-alice' })
      expect(await sync(1)).toMatchObject({ state: 'pending', email: 'alice@new.dev', busy_json: '[]' })
    } finally {
      people['tok-alice'].email = 'Alice@Acme.dev'
    }
  })
})

describe('sync and backoff', () => {
  test('at most 3 calendars per run; only due ones are fetched', async () => {
    await setupAll('tok-carol', 'tok-dan', 'tok-erin')
    await alarm()
    expect(calendarHits).toHaveLength(3)
    await alarm()
    expect(calendarHits).toHaveLength(4)
    await alarm()
    expect(calendarHits).toHaveLength(4)
    await at(T0 + 5 * MIN)
    await alarm()
    expect(calendarHits).toHaveLength(7)
  })

  test('errors back off 5, 10, 20 min and keep the last good busy times for 2 h', async () => {
    await setupAll()
    await alarm()
    expect(await sync(1)).toMatchObject({ state: 'ok', failures: 0 })
    calendarResponse = () => new Response('oops', { status: 500 })
    const expected = [5, 10, 20, 40, 60, 60]
    let t = T0 + 5 * MIN
    for (const mins of expected) {
      await at(t)
      await alarm()
      const row = await sync(1)
      expect(row.state).toBe('error')
      const wait = (Number(row.next_at) - t) / MIN
      expect(wait).toBeGreaterThanOrEqual(mins * 0.8)
      expect(wait).toBeLessThanOrEqual(mins * 1.2)
      t = Number(row.next_at)
    }
    // still within 2 h of the last good fetch? last good was at T0, now well past → no busy shown
    const cal = await (await request('GET', '/api/calendar/1', { cookie: (await post('/api/login', { token: 'tok-alice' })).headers.get('Set-Cookie')!.split(';')[0] })).json<{ state: string; busy: unknown[] }>()
    expect(cal.state).toBe('error')
    expect(cal.busy).toEqual([])
  })

  test('a short outage keeps showing the last good busy times', async () => {
    const c = await setupAll()
    await alarm()
    calendarResponse = () => new Response('oops', { status: 503 })
    await at(T0 + 5 * MIN)
    await alarm()
    const cal = await (await request('GET', '/api/calendar/1', { cookie: c.alice })).json<{ state: string; busy: unknown[] }>()
    expect(cal.state).toBe('error')
    expect(cal.busy).toHaveLength(1)
  })

  test('not public (404) waits 6 hours', async () => {
    await setupAll()
    calendarResponse = () => new Response('Not Found', { status: 404 })
    await alarm()
    const row = await sync(1)
    expect(row.state).toBe('unavailable')
    expect(Number(row.next_at) - T0).toBe(6 * 60 * MIN)
    await at(T0 + 5 * 60 * MIN)
    await alarm()
    expect(calendarHits).toHaveLength(1)
  })

  test('oversized or unparseable feeds are errors', async () => {
    await setupAll()
    calendarResponse = () => new Response('x', { headers: { 'Content-Length': String(3 * 1024 * 1024) } })
    await alarm()
    expect(await sync(1)).toMatchObject({ state: 'error', failures: 1 })
    calendarResponse = () => new Response('<html>nope</html>')
    await at(T0 + 10 * MIN)
    await alarm()
    expect(await sync(1)).toMatchObject({ state: 'error', failures: 2 })
  })
})

describe('meetings and privacy', () => {
  test('entering and leaving a meeting broadcasts once each', async () => {
    const c = await setupAll('tok-bob')
    await alarm() // fetch at 08:00 UTC: not in a meeting yet
    // Sockets are opened just before each check: a long jump of the test clock would mark them stale.
    await at(Date.UTC(2026, 9, 8, 9, 59))
    const b = await connect(c.bob)
    expect((await b.next('snapshot')).members.find((m) => m.githubId === 1)?.meetingUntil).toBeNull()
    await at(Date.UTC(2026, 9, 8, 10, 0))
    await alarm()
    const start = await b.next('member_updated', (m) => m.member.githubId === 1)
    expect(start.member.meetingUntil).toBe(Date.UTC(2026, 9, 8, 11, 0))
    await at(Date.UTC(2026, 9, 8, 10, 1))
    await alarm()
    expect(b.all('member_updated').filter((m) => m.member.githubId === 1)).toHaveLength(1)

    await at(Date.UTC(2026, 9, 8, 10, 59))
    const b2 = await connect(c.bob)
    expect((await b2.next('snapshot')).members.find((m) => m.githubId === 1)?.meetingUntil).toBe(Date.UTC(2026, 9, 8, 11, 0))
    await at(Date.UTC(2026, 9, 8, 11, 0))
    await alarm()
    const end = await b2.next('member_updated', (m) => m.member.githubId === 1)
    expect(end.member.meetingUntil).toBeNull()
    await at(Date.UTC(2026, 9, 8, 11, 1))
    await alarm()
    expect(b2.all('member_updated').filter((m) => m.member.githubId === 1)).toHaveLength(1)
  })

  test('the email, calendar address and event details never reach other members', async () => {
    const c = await setupAll('tok-bob')
    calendarResponse = () => new Response(ics('Acquisition talks'))
    await alarm()
    await at(Date.UTC(2026, 9, 8, 10, 14))
    const b = await connect(c.bob)
    await b.next('snapshot')
    await at(Date.UTC(2026, 9, 8, 10, 15))
    await alarm()
    await b.next('member_updated', (m) => m.member.meetingUntil !== null)
    const cal = await (await request('GET', '/api/calendar/1', { cookie: c.bob })).text()
    const seen = JSON.stringify(b.messages) + cal + (await (await request('GET', '/api/me', { cookie: c.bob })).text())
    for (const secret of ['acme.dev', 'calendar.google.com', 'Acquisition', 'Board room']) expect(seen).not.toContain(secret)
  })

  test('the calendar route serves the cache only and needs a session', async () => {
    const c = await setupAll('tok-bob')
    await alarm()
    const hits = calendarHits.length
    const res = await request('GET', '/api/calendar/1', { cookie: c.bob })
    expect(await res.json()).toEqual({
      state: 'ok',
      busy: [{ start: Date.UTC(2026, 9, 8, 10), end: Date.UTC(2026, 9, 8, 11), allDay: false }],
      fetchedAt: T0,
    })
    expect(calendarHits.length).toBe(hits)
    expect((await request('GET', '/api/calendar/1')).status).toBe(401)
    expect((await request('GET', '/api/calendar/99', { cookie: c.bob })).status).toBe(404)
    expect(await (await request('GET', '/api/calendar/2', { cookie: c.bob })).json()).toEqual({ state: 'no_email', busy: [], fetchedAt: null })
  })

  test('removing a member deletes their sync row', async () => {
    const c = await setupAll('tok-carol')
    await alarm()
    await request('DELETE', '/api/admin/members/3', { cookie: c.alice })
    expect(await sync(3)).toBeUndefined()
  })
})

void ORIGIN
