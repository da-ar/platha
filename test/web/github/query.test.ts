import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildRequests, fetchSnapshot } from '../../../src/web/github/query'
import full from '../../fixtures/graphql-full.json'

const NOW = new Date('2026-10-08T12:00:00Z')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildRequests', () => {
  test('one small request per search, each scoped to the org', () => {
    const reqs = buildRequests('acme', ['bob', 'carol'], NOW)
    expect(reqs.map((r) => r.alias)).toEqual(['reviewRequested', 'mine', 'mentions', 't0', 't1'])
    for (const r of reqs) {
      expect(r.query.match(/org:acme/g)).toHaveLength(1)
      expect(r.query.match(/search\(/g)).toHaveLength(1)
      expect(r.query).toContain('first: 30')
    }
    expect(reqs[0].query).toContain('"is:pr is:open review-requested:@me org:acme"')
    expect(reqs[1].query).toContain('"is:pr is:open author:@me org:acme"')
    expect(reqs[3].query).toMatch(/t0: search\(type: ISSUE, first: 30, query: "is:pr is:open author:bob org:acme"\)/)
    expect(reqs[4].query).toContain('author:carol')
  })

  test('mentions limited to last 14 days', () => {
    expect(buildRequests('acme', [], NOW)[2].query).toContain('"is:open mentions:@me org:acme updated:>=2026-09-24"')
  })

  test('invalid login is skipped, keeping teammate positions', () => {
    const reqs = buildRequests('acme', ['bob', 'evil" org:other', 'carol'], NOW)
    expect(reqs.map((r) => r.alias)).toEqual(['reviewRequested', 'mine', 'mentions', 't0', 't2'])
    expect(reqs.some((r) => r.query.includes('org:other'))).toBe(false)
  })
})

/** Answers each request from the full fixture, keeping only the alias that request asked for. */
function respond(override: (alias: string, attempt: number) => Response | 'network' | undefined = () => undefined) {
  const attempts = new Map<string, number>()
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string }
    const alias = /query \{ (\w+): search/.exec(query)![1]
    const attempt = (attempts.get(alias) ?? 0) + 1
    attempts.set(alias, attempt)
    const o = override(alias, attempt)
    if (o === 'network') throw new TypeError('Failed to fetch')
    if (o) return o
    return Response.json({ data: { [alias]: (full.data as Record<string, unknown>)[alias] ?? { nodes: [] } } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, attempts }
}

describe('fetchSnapshot', () => {
  test('combines the separate searches and sends the bearer token', async () => {
    const { fetchMock } = respond()
    const r = await fetchSnapshot('tok', 'acme', ['bob', 'carol'])
    expect(r.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(r.snapshot?.mine).toHaveLength(3)
    expect(r.snapshot?.reviewRequested.map((p) => p.number)).toEqual([412])
    expect(r.snapshot?.mentions).toHaveLength(1)
    expect((r.snapshot?.byTeammate.bob as unknown[]).length).toBe(2)
    expect(r.snapshot?.byTeammate.carol).toEqual([])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/graphql')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  test('a gateway timeout is retried once', async () => {
    const { attempts } = respond((alias, attempt) => (alias === 'mine' && attempt === 1 ? new Response('', { status: 502 }) : undefined))
    const r = await fetchSnapshot('tok', 'acme', [])
    expect(r.status).toBe(200)
    expect(attempts.get('mine')).toBe(2)
    expect(r.snapshot?.mine).toHaveLength(3)
  })

  test('a 502 hidden by CORS (network error) is retried too', async () => {
    const { attempts } = respond((alias, attempt) => (alias === 'mentions' && attempt === 1 ? 'network' : undefined))
    expect((await fetchSnapshot('tok', 'acme', [])).status).toBe(200)
    expect(attempts.get('mentions')).toBe(2)
  })

  test("a teammate's failing search only marks that teammate", async () => {
    respond((alias) => (alias === 't0' ? new Response('', { status: 502 }) : undefined))
    const r = await fetchSnapshot('tok', 'acme', ['bob', 'carol'])
    expect(r.status).toBe(200)
    expect(r.snapshot?.byTeammate.bob).toBe('error')
    expect(r.snapshot?.byTeammate.carol).toEqual([])
    expect(r.snapshot?.mine).toHaveLength(3)
  })

  test('a graphql error on a teammate search marks that teammate', async () => {
    respond((alias) => (alias === 't0' ? Response.json({ data: { t0: null }, errors: [{ type: 'FORBIDDEN', path: ['t0'] }] }) : undefined))
    const r = await fetchSnapshot('tok', 'acme', ['bob'])
    expect(r.snapshot?.byTeammate.bob).toBe('error')
  })

  test('your own search failing fails the poll so it backs off', async () => {
    respond((alias) => (alias === 'reviewRequested' ? new Response('', { status: 502 }) : undefined))
    expect(await fetchSnapshot('tok', 'acme', [])).toEqual({ status: 502 })
  })

  test('auth and rate limits are reported', async () => {
    respond(() => new Response('', { status: 401 }))
    expect(await fetchSnapshot('tok', 'acme', ['bob'])).toEqual({ status: 401 })
    respond((alias) => (alias === 'mine' ? Response.json({ errors: [{ type: 'RATE_LIMITED' }] }) : undefined))
    expect(await fetchSnapshot('tok', 'acme', [])).toEqual({ status: 429 })
    respond(() => 'network')
    expect(await fetchSnapshot('tok', 'acme', [])).toEqual({ status: 0 })
  })

  test('no more than 4 requests run at once', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        const alias = /query \{ (\w+): search/.exec(JSON.parse(String(init.body)).query)![1]
        return Response.json({ data: { [alias]: { nodes: [] } } })
      }),
    )
    const r = await fetchSnapshot('tok', 'acme', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(r.status).toBe(200)
    expect(peak).toBe(4)
  })
})
