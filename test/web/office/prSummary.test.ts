import { describe, expect, test } from 'vitest'
import { openLabel, summarizePrs, summaryLines } from '../../../src/web/office/prSummary'
import { pr } from '../factories'

const none = new Set<string>()

describe('summarizePrs', () => {
  test('counts each state', () => {
    const prs = [
      pr(1, { reviewDecision: 'APPROVED', ci: 'SUCCESS' }),
      pr(2, { reviewDecision: 'CHANGES_REQUESTED', ci: 'FAILURE' }),
      pr(3, { ci: 'ERROR', mergeable: 'CONFLICTING' }),
      pr(4, { isDraft: true }),
    ]
    expect(summarizePrs(prs, none, false)).toEqual({
      open: 4,
      waitingOnYou: 0,
      ready: 1,
      changesRequested: 1,
      failing: 2,
      conflicts: 1,
      drafts: 1,
    })
  })

  test('waiting on you matches review requests by URL, and never on your own tile', () => {
    const prs = [pr(1), pr(2), pr(3)]
    const requested = new Set([prs[0].url, prs[2].url, 'https://github.com/acme/other/pull/9'])
    expect(summarizePrs(prs, requested, false).waitingOnYou).toBe(2)
    expect(summarizePrs(prs, requested, true).waitingOnYou).toBe(0)
  })

  test('ready uses the same rule as Needs you', () => {
    const ok = { reviewDecision: 'APPROVED' as const, ci: 'SUCCESS' as const }
    const prs = [pr(1, ok), pr(2, { ...ok, ci: null }), pr(3, { ...ok, isDraft: true }), pr(4, { ...ok, mergeable: 'CONFLICTING' }), pr(5, { ...ok, ci: 'PENDING' })]
    expect(summarizePrs(prs, none, false).ready).toBe(2)
  })
})

describe('labels', () => {
  test('open count wording', () => {
    expect(openLabel(0)).toBe('No open PRs')
    expect(openLabel(1)).toBe('1 open PR')
    expect(openLabel(5)).toBe('5 open PRs')
  })

  test('lines are most actionable first, omit zeros and pluralise', () => {
    const lines = summaryLines({ open: 9, waitingOnYou: 2, ready: 0, changesRequested: 1, failing: 1, conflicts: 2, drafts: 1 })
    expect(lines.map((l) => l.label)).toEqual(['2 waiting on you', '1 changes requested', '1 failing CI', '2 conflicts', '1 draft'])
    expect(summaryLines({ open: 3, waitingOnYou: 0, ready: 0, changesRequested: 0, failing: 0, conflicts: 1, drafts: 2 }).map((l) => l.label)).toEqual([
      '1 conflict',
      '2 drafts',
    ])
  })
})
