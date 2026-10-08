import type { GitHubSnapshot, Mention, PullRequest } from './types'

function samePr(a: PullRequest, b: PullRequest): boolean {
  return (
    a.url === b.url &&
    a.number === b.number &&
    a.title === b.title &&
    a.repo === b.repo &&
    a.author === b.author &&
    a.isDraft === b.isDraft &&
    a.reviewDecision === b.reviewDecision &&
    a.mergeable === b.mergeable &&
    a.ci === b.ci &&
    a.updatedAt === b.updatedAt &&
    a.lastActivity?.author === b.lastActivity?.author &&
    a.lastActivity?.at === b.lastActivity?.at
  )
}

function sameMention(a: Mention, b: Mention): boolean {
  return a.url === b.url && a.number === b.number && a.title === b.title && a.repo === b.repo && a.updatedAt === b.updatedAt
}

/** Reuses unchanged items by URL; returns `prev` itself if nothing in the list changed. */
function stableList<T extends { url: string }>(prev: T[] | undefined, next: T[], same: (a: T, b: T) => boolean): T[] {
  if (!prev) return next
  const byUrl = new Map(prev.map((item) => [item.url, item]))
  const merged = next.map((item) => {
    const old = byUrl.get(item.url)
    return old && same(old, item) ? old : item
  })
  return merged.length === prev.length && merged.every((item, i) => item === prev[i]) ? prev : merged
}

/**
 * Merges a fresh poll into the previous snapshot so that unchanged PRs, lists and
 * (if nothing changed) the snapshot itself keep their identity. React then only
 * re-renders what actually changed.
 */
export function stableSnapshot(prev: GitHubSnapshot | null, next: GitHubSnapshot): GitHubSnapshot {
  if (!prev) return next
  const reviewRequested = stableList(prev.reviewRequested, next.reviewRequested, samePr)
  const mine = stableList(prev.mine, next.mine, samePr)
  const mentions = stableList(prev.mentions, next.mentions, sameMention)

  const byTeammate: GitHubSnapshot['byTeammate'] = {}
  for (const [login, prs] of Object.entries(next.byTeammate)) {
    const old = prev.byTeammate[login]
    byTeammate[login] = prs === 'error' || old === undefined || old === 'error' ? prs : stableList(old, prs, samePr)
  }
  const prevLogins = Object.keys(prev.byTeammate)
  const nextLogins = Object.keys(byTeammate)
  const teammatesSame = prevLogins.length === nextLogins.length && nextLogins.every((l) => byTeammate[l] === prev.byTeammate[l])

  if (reviewRequested === prev.reviewRequested && mine === prev.mine && mentions === prev.mentions && teammatesSame) return prev
  return { reviewRequested, mine, mentions, byTeammate: teammatesSame ? prev.byTeammate : byTeammate }
}
