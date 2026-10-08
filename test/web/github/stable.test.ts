import { expect, test } from 'vitest'
import { stableSnapshot } from '../../../src/web/github/stable'
import { pr, snapshot } from '../factories'

const mention = (n: number, updatedAt = '2026-10-07T10:00:00Z') => ({ url: `https://github.com/acme/api/issues/${n}`, number: n, title: `I${n}`, repo: 'acme/api', updatedAt })

function fresh() {
  return snapshot({
    reviewRequested: [pr(1), pr(2)],
    mine: [pr(3, { lastActivity: { author: 'bob', at: '2026-10-07T09:00:00Z' } })],
    mentions: [mention(7)],
    byTeammate: { bob: [pr(4)], carol: 'error' },
  })
}

test('first poll is used as is', () => {
  const next = fresh()
  expect(stableSnapshot(null, next)).toBe(next)
})

test('identical data returns the previous snapshot', () => {
  const prev = fresh()
  expect(stableSnapshot(prev, fresh())).toBe(prev)
})

test('one changed PR gives a new snapshot but reuses everything else', () => {
  const prev = fresh()
  const next = fresh()
  next.reviewRequested[1] = pr(2, { ci: 'FAILURE' })
  const merged = stableSnapshot(prev, next)
  expect(merged).not.toBe(prev)
  expect(merged.reviewRequested[0]).toBe(prev.reviewRequested[0])
  expect(merged.reviewRequested[1]).toBe(next.reviewRequested[1])
  expect(merged.mine).toBe(prev.mine)
  expect(merged.mentions).toBe(prev.mentions)
  expect(merged.byTeammate).toBe(prev.byTeammate)
})

test('added, removed and reordered items', () => {
  const prev = fresh()
  const next = fresh()
  next.reviewRequested = [pr(9), next.reviewRequested[1]]
  const merged = stableSnapshot(prev, next)
  expect(merged.reviewRequested[0]).toBe(next.reviewRequested[0])
  expect(merged.reviewRequested[1]).toBe(prev.reviewRequested[1])
  const reordered = stableSnapshot(prev, { ...fresh(), reviewRequested: [pr(2), pr(1)] })
  expect(reordered.reviewRequested).not.toBe(prev.reviewRequested)
  expect(reordered.reviewRequested[0]).toBe(prev.reviewRequested[1])
})

test('teammate changes, including errors and new teammates', () => {
  const prev = fresh()
  const next = fresh()
  next.byTeammate = { bob: 'error', carol: [pr(5)], dan: [] }
  const merged = stableSnapshot(prev, next)
  expect(merged.byTeammate).toEqual({ bob: 'error', carol: [next.byTeammate.carol[0]], dan: [] })
  expect(merged.mine).toBe(prev.mine)
  expect(stableSnapshot(prev, { ...fresh(), mentions: [mention(7, '2026-10-08T00:00:00Z')] }).mentions).not.toBe(prev.mentions)
})
