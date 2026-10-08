import type { SeenState } from './seen'
import type { GitHubSnapshot, PullRequest } from './types'

export type AttentionKind = 'review_requested' | 'changes_or_comments' | 'ready_to_merge' | 'mentioned' | 'ci_failing'

export interface AttentionItem {
  kind: AttentionKind
  url: string
  number: number
  title: string
  repo: string
  /** GitHub's timestamp for the activity that raised this item; stored as "seen" when opened. */
  activityAt: string
}

/** Priority order (spec §6: e, f, g, h, i). */
export const ATTENTION_ORDER: AttentionKind[] = ['review_requested', 'changes_or_comments', 'ready_to_merge', 'mentioned', 'ci_failing']

export function isUnseen(seen: SeenState, url: string, at: string): boolean {
  const last = Date.parse(seen.seen[url] ?? seen.firstRunAt)
  return Date.parse(at) > last
}

export function isReadyToMerge(pr: PullRequest): boolean {
  return !pr.isDraft && pr.reviewDecision === 'APPROVED' && (pr.ci === 'SUCCESS' || pr.ci === null) && pr.mergeable !== 'CONFLICTING'
}

export function isCiFailing(pr: PullRequest): boolean {
  return pr.ci === 'FAILURE' || pr.ci === 'ERROR'
}

function item(kind: AttentionKind, x: { url: string; number: number; title: string; repo: string }, activityAt: string): AttentionItem {
  return { kind, url: x.url, number: x.number, title: x.title, repo: x.repo, activityAt }
}

export function computeAttention(s: GitHubSnapshot, me: string, seen: SeenState): AttentionItem[] {
  const self = me.toLowerCase()
  const candidates: AttentionItem[] = []

  for (const pr of s.reviewRequested) candidates.push(item('review_requested', pr, pr.updatedAt))

  for (const pr of s.mine) {
    const other = pr.lastActivity && pr.lastActivity.author.toLowerCase() !== self ? pr.lastActivity : null
    if (pr.reviewDecision === 'CHANGES_REQUESTED' || (other && isUnseen(seen, pr.url, other.at))) {
      candidates.push(item('changes_or_comments', pr, pr.lastActivity?.at ?? pr.updatedAt))
    }
    if (isReadyToMerge(pr)) candidates.push(item('ready_to_merge', pr, pr.updatedAt))
  }

  for (const m of s.mentions) {
    if (isUnseen(seen, m.url, m.updatedAt)) candidates.push(item('mentioned', m, m.updatedAt))
  }

  for (const pr of s.mine) if (isCiFailing(pr)) candidates.push(item('ci_failing', pr, pr.updatedAt))

  const rank = (k: AttentionKind) => ATTENTION_ORDER.indexOf(k)
  const best = new Map<string, AttentionItem>()
  for (const c of candidates) {
    const current = best.get(c.url)
    if (!current || rank(c.kind) < rank(current.kind)) best.set(c.url, c)
  }
  return [...best.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || Date.parse(b.activityAt) - Date.parse(a.activityAt))
}
