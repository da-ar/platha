import type { PullRequest } from '../github/types'

export type PillTone = 'draft' | 'fail' | 'changes' | 'ready' | 'review'

export function prPillTone(pr: PullRequest): PillTone {
  if (pr.isDraft) return 'draft'
  if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') return 'fail'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.reviewDecision === 'APPROVED') return 'ready'
  return 'review'
}

const LABELS: Record<PillTone, string> = {
  draft: 'draft',
  fail: '❌',
  changes: 'changes req',
  ready: 'ready',
  review: 'in review',
}

export function prPill(pr: PullRequest): string {
  return `#${pr.number} ${LABELS[prPillTone(pr)]}`
}
