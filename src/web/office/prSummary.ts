import { isCiFailing, isReadyToMerge } from '../github/attention'
import type { PullRequest } from '../github/types'

export interface PrSummary {
  open: number
  waitingOnYou: number
  ready: number
  changesRequested: number
  failing: number
  conflicts: number
  drafts: number
}

/**
 * Counts for a tile. `waitingOnYou` is the member's PRs where you are a requested
 * reviewer (their URL is in your review-requested search); it's always 0 on your own tile.
 */
export function summarizePrs(prs: PullRequest[], reviewRequestedUrls: Set<string>, isMe: boolean): PrSummary {
  const count = (pred: (pr: PullRequest) => boolean) => prs.filter(pred).length
  return {
    open: prs.length,
    waitingOnYou: isMe ? 0 : count((pr) => reviewRequestedUrls.has(pr.url)),
    ready: count(isReadyToMerge),
    changesRequested: count((pr) => pr.reviewDecision === 'CHANGES_REQUESTED'),
    failing: count(isCiFailing),
    conflicts: count((pr) => pr.mergeable === 'CONFLICTING'),
    drafts: count((pr) => pr.isDraft),
  }
}

export type SummaryKind = 'waitingOnYou' | 'ready' | 'changesRequested' | 'failing' | 'conflicts' | 'drafts'

export interface SummaryLine {
  kind: SummaryKind
  count: number
  label: string
}

const ORDER: { kind: SummaryKind; one: string; many: string }[] = [
  { kind: 'waitingOnYou', one: 'waiting on you', many: 'waiting on you' },
  { kind: 'ready', one: 'ready to merge', many: 'ready to merge' },
  { kind: 'changesRequested', one: 'changes requested', many: 'changes requested' },
  { kind: 'failing', one: 'failing CI', many: 'failing CI' },
  { kind: 'conflicts', one: 'conflict', many: 'conflicts' },
  { kind: 'drafts', one: 'draft', many: 'drafts' },
]

export function openLabel(open: number): string {
  if (open === 0) return 'No open PRs'
  return open === 1 ? '1 open PR' : `${open} open PRs`
}

/** Non-zero counts, most actionable first. */
export function summaryLines(s: PrSummary): SummaryLine[] {
  return ORDER.filter((o) => s[o.kind] > 0).map((o) => ({
    kind: o.kind,
    count: s[o.kind],
    label: `${s[o.kind]} ${s[o.kind] === 1 ? o.one : o.many}`,
  }))
}
