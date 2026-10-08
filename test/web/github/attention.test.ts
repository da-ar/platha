import { describe, expect, test } from 'vitest'
import { computeAttention } from '../../../src/web/github/attention'
import type { SeenState } from '../../../src/web/github/seen'
import type { GitHubSnapshot, Mention, PullRequest } from '../../../src/web/github/types'

const FIRST_RUN = '2026-10-01T00:00:00Z'
const fresh: SeenState = { firstRunAt: FIRST_RUN, seen: {} }

function pr(n: number, over: Partial<PullRequest> = {}): PullRequest {
  return {
    url: `https://github.com/acme/api/pull/${n}`,
    number: n,
    title: `PR ${n}`,
    repo: 'acme/api',
    author: 'alice',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    ci: 'PENDING',
    updatedAt: '2026-10-07T10:00:00Z',
    lastActivity: null,
    ...over,
  }
}

function mention(n: number, updatedAt = '2026-10-07T10:00:00Z'): Mention {
  return { url: `https://github.com/acme/api/issues/${n}`, number: n, title: `Issue ${n}`, repo: 'acme/api', updatedAt }
}

function snap(over: Partial<GitHubSnapshot> = {}): GitHubSnapshot {
  return { reviewRequested: [], mine: [], mentions: [], byTeammate: {}, ...over }
}

const kinds = (s: GitHubSnapshot, seen = fresh) => computeAttention(s, 'alice', seen).map((i) => [i.kind, i.number])

describe('rules', () => {
  test('e: review requested appears', () => {
    expect(kinds(snap({ reviewRequested: [pr(1, { author: 'bob' })] }))).toEqual([['review_requested', 1]])
  })

  test('f: changes requested appears even when seen', () => {
    const p = pr(2, { reviewDecision: 'CHANGES_REQUESTED', lastActivity: { author: 'bob', at: '2026-10-07T09:00:00Z' } })
    const seen = { firstRunAt: FIRST_RUN, seen: { [p.url]: '2026-10-07T09:00:00Z' } }
    expect(kinds(snap({ mine: [p] }), seen)).toEqual([['changes_or_comments', 2]])
  })

  test('f: new comment by someone else appears until seen; own comment never does', () => {
    const p = pr(3, { lastActivity: { author: 'bob', at: '2026-10-07T09:00:00Z' } })
    expect(kinds(snap({ mine: [p] }))).toEqual([['changes_or_comments', 3]])
    const [it] = computeAttention(snap({ mine: [p] }), 'alice', fresh)
    expect(it.activityAt).toBe('2026-10-07T09:00:00Z')
    expect(kinds(snap({ mine: [p] }), { firstRunAt: FIRST_RUN, seen: { [p.url]: '2026-10-07T09:00:00Z' } })).toEqual([])
    const later = pr(3, { lastActivity: { author: 'bob', at: '2026-10-07T11:00:00Z' } })
    expect(kinds(snap({ mine: [later] }), { firstRunAt: FIRST_RUN, seen: { [p.url]: '2026-10-07T09:00:00Z' } })).toEqual([
      ['changes_or_comments', 3],
    ])
    expect(kinds(snap({ mine: [pr(4, { lastActivity: { author: 'Alice', at: '2026-10-07T09:00:00Z' } })] }))).toEqual([])
  })

  test('f: activity before firstRunAt is treated as seen', () => {
    expect(kinds(snap({ mine: [pr(5, { lastActivity: { author: 'bob', at: '2026-09-30T00:00:00Z' } })] }))).toEqual([])
  })

  test('g: approved+green+mergeable appears; draft, conflicting or pending CI do not', () => {
    const ok = { reviewDecision: 'APPROVED' as const, ci: 'SUCCESS' as const }
    expect(kinds(snap({ mine: [pr(6, ok)] }))).toEqual([['ready_to_merge', 6]])
    expect(kinds(snap({ mine: [pr(7, { ...ok, ci: null })] }))).toEqual([['ready_to_merge', 7]])
    expect(kinds(snap({ mine: [pr(8, { ...ok, isDraft: true })] }))).toEqual([])
    expect(kinds(snap({ mine: [pr(9, { ...ok, mergeable: 'CONFLICTING' })] }))).toEqual([])
    expect(kinds(snap({ mine: [pr(10, { ...ok, ci: 'PENDING' })] }))).toEqual([])
    expect(kinds(snap({ mine: [pr(11, { ...ok, mergeable: 'UNKNOWN' })] }))).toEqual([['ready_to_merge', 11]])
  })

  test('h: mention appears until seen, reappears when updated later', () => {
    const m = mention(12)
    expect(kinds(snap({ mentions: [m] }))).toEqual([['mentioned', 12]])
    const seen = { firstRunAt: FIRST_RUN, seen: { [m.url]: m.updatedAt } }
    expect(kinds(snap({ mentions: [m] }), seen)).toEqual([])
    expect(kinds(snap({ mentions: [mention(12, '2026-10-08T10:00:00Z')] }), seen)).toEqual([['mentioned', 12]])
  })

  test('i: failing CI appears', () => {
    expect(kinds(snap({ mine: [pr(13, { ci: 'FAILURE' }), pr(14, { ci: 'ERROR' })] })).map((k) => k[0])).toEqual(['ci_failing', 'ci_failing'])
  })
})

describe('combining', () => {
  test('one item per url, highest-priority rule wins (f beats i)', () => {
    const p = pr(15, { ci: 'FAILURE', reviewDecision: 'CHANGES_REQUESTED' })
    expect(kinds(snap({ mine: [p] }))).toEqual([['changes_or_comments', 15]])
  })

  test('a mention of my failing PR shows once, as mentioned', () => {
    const p = pr(16, { ci: 'FAILURE' })
    const m = { ...mention(16), url: p.url }
    expect(kinds(snap({ mine: [p], mentions: [m] }))).toEqual([['mentioned', 16]])
  })

  test('a newer failing build sorts above an older review request', () => {
    const s = snap({
      reviewRequested: [pr(30, { updatedAt: '2026-10-01T09:00:00Z' })],
      mine: [pr(31, { ci: 'FAILURE', updatedAt: '2026-10-08T09:00:00Z' })],
    })
    expect(kinds(s)).toEqual([
      ['ci_failing', 31],
      ['review_requested', 30],
    ])
  })

  test('sorted newest first regardless of rule', () => {
    const s = snap({
      reviewRequested: [pr(20, { updatedAt: '2026-10-07T01:00:00Z' }), pr(21, { updatedAt: '2026-10-07T05:00:00Z' })],
      mine: [pr(22, { ci: 'FAILURE' })],
      mentions: [mention(23)],
    })
    // 22 and 23 share 10:00, so rule order breaks the tie (mentioned before ci_failing).
    expect(kinds(s).map((k) => k[1])).toEqual([23, 22, 21, 20])
  })
})
