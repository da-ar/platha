import { afterEach, expect, test, vi } from 'vitest'
import { buildQuery, fetchSnapshot } from '../../../src/web/github/query'
import full from '../../fixtures/graphql-full.json'

const NOW = new Date('2026-10-08T12:00:00Z')

afterEach(() => {
  vi.unstubAllGlobals()
})

test('query scopes every search to the org and aliases teammates in order', () => {
  const q = buildQuery('acme', ['bob', 'carol'], NOW)
  expect(q.match(/org:acme/g)).toHaveLength(5)
  expect(q).toMatch(/t0: search\(type: ISSUE, first: 50, query: "is:pr is:open author:bob org:acme"\)/)
  expect(q).toMatch(/t1: search\(type: ISSUE, first: 50, query: "is:pr is:open author:carol org:acme"\)/)
  expect(q).toContain('"is:pr is:open review-requested:@me org:acme"')
  expect(q).toContain('"is:pr is:open author:@me org:acme"')
  expect(q).toContain('fragment PR on PullRequest')
})

test('mentions limited to last 14 days', () => {
  expect(buildQuery('acme', [], NOW)).toContain('"is:open mentions:@me org:acme updated:>=2026-09-24"')
})

test('invalid login is skipped', () => {
  const q = buildQuery('acme', ['bob', 'evil" org:other', 'carol'], NOW)
  expect(q).toContain('t0: search')
  expect(q).not.toContain('t1: search')
  expect(q).toContain('t2: search')
  expect(q).not.toContain('org:other')
})

test('fetchSnapshot posts with the bearer token and parses', async () => {
  const fetchMock = vi.fn(async () => Response.json(full))
  vi.stubGlobal('fetch', fetchMock)
  const r = await fetchSnapshot('tok', 'acme', ['bob', 'carol'])
  expect(r.status).toBe(200)
  expect(r.snapshot?.mine).toHaveLength(3)
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.github.com/graphql')
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
})

test('fetchSnapshot reports http errors and graphql rate limits', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
  expect(await fetchSnapshot('tok', 'acme', [])).toEqual({ status: 401 })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ errors: [{ type: 'RATE_LIMITED' }] })))
  expect(await fetchSnapshot('tok', 'acme', [])).toEqual({ status: 429 })
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
  expect(await fetchSnapshot('tok', 'acme', [])).toEqual({ status: 0 })
})
