import { afterEach, expect, test, vi } from 'vitest'
import { computeAttention, type AttentionItem } from '../../../src/web/github/attention'
import { loadSeen, markSeen } from '../../../src/web/github/seen'

afterEach(() => {
  vi.useRealTimers()
})

const item: AttentionItem = {
  kind: 'mentioned',
  url: 'https://github.com/acme/api/issues/1',
  number: 1,
  title: 'x',
  repo: 'acme/api',
  activityAt: '2026-10-08T10:00:00Z',
}

test('first load records firstRunAt and persists it', () => {
  vi.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z') })
  const s = loadSeen()
  expect(s).toEqual({ firstRunAt: '2026-10-08T12:00:00.000Z', seen: {} })
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  expect(loadSeen().firstRunAt).toBe('2026-10-08T12:00:00.000Z')
})

test('markSeen stores the item activity timestamp, not local time', () => {
  vi.useFakeTimers({ now: new Date('2020-01-01T00:00:00Z') })
  const s0 = loadSeen()
  const s1 = markSeen(s0, item)
  expect(s1.seen[item.url]).toBe('2026-10-08T10:00:00Z')
  const snapshot = {
    reviewRequested: [],
    mine: [],
    mentions: [{ url: item.url, number: 1, title: 'x', repo: 'acme/api', updatedAt: item.activityAt }],
    byTeammate: {},
  }
  expect(computeAttention(snapshot, 'alice', s1)).toEqual([])
  expect(loadSeen().seen[item.url]).toBe('2026-10-08T10:00:00Z')
})

test('markSeen never moves a timestamp backwards', () => {
  const s = markSeen(loadSeen(), item)
  expect(markSeen(s, { ...item, activityAt: '2026-10-01T00:00:00Z' }).seen[item.url]).toBe('2026-10-08T10:00:00Z')
})

test('entries older than 60 days are pruned but stay seen', () => {
  localStorage.setItem(
    'platha.seen',
    JSON.stringify({ firstRunAt: '2026-01-01T00:00:00Z', seen: { old: '2026-02-01T00:00:00Z', recent: '2026-10-01T00:00:00Z' } }),
  )
  vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') })
  const s = loadSeen()
  expect(Object.keys(s.seen)).toEqual(['recent'])
  expect(s.firstRunAt).toBe('2026-08-09T00:00:00.000Z')
  const snapshot = {
    reviewRequested: [],
    mine: [],
    mentions: [{ url: 'old', number: 1, title: 'x', repo: 'r', updatedAt: '2026-02-01T00:00:00Z' }],
    byTeammate: {},
  }
  expect(computeAttention(snapshot, 'alice', s)).toEqual([])
})

test('corrupt storage starts fresh', () => {
  localStorage.setItem('platha.seen', '{nope')
  expect(loadSeen().seen).toEqual({})
})
