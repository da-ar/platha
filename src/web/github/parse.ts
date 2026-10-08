import type { CiState, GitHubSnapshot, Mention, Mergeable, PullRequest, ReviewDecision } from './types'

type Json = Record<string, any>

const LOGIN = /^[A-Za-z0-9-]{1,39}$/

export function isValidLogin(login: string): boolean {
  return LOGIN.test(login)
}

const CI_STATES = new Set(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED'])
const DECISIONS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
const MERGEABLE = new Set(['MERGEABLE', 'CONFLICTING', 'UNKNOWN'])

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function nodes(conn: unknown): Json[] {
  const list = (conn as Json | null)?.nodes
  return Array.isArray(list) ? list.filter((n): n is Json => !!n && typeof n === 'object' && typeof n.url === 'string') : []
}

function lastActivity(n: Json): PullRequest['lastActivity'] {
  const c = n.comments?.nodes?.[0]
  const r = n.reviews?.nodes?.[0]
  const candidates = [
    c && typeof c.createdAt === 'string' ? { author: str(c.author?.login), at: c.createdAt } : null,
    r && typeof r.submittedAt === 'string' ? { author: str(r.author?.login), at: r.submittedAt } : null,
  ].filter((x): x is { author: string; at: string } => x !== null)
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a))
}

export function parsePullRequest(n: Json): PullRequest {
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state
  return {
    url: n.url,
    number: Number(n.number),
    title: str(n.title),
    repo: str(n.repository?.nameWithOwner),
    author: str(n.author?.login),
    isDraft: n.isDraft === true,
    reviewDecision: DECISIONS.has(n.reviewDecision) ? (n.reviewDecision as ReviewDecision) : null,
    mergeable: MERGEABLE.has(n.mergeable) ? (n.mergeable as Mergeable) : 'UNKNOWN',
    ci: CI_STATES.has(rollup) ? (rollup as CiState) : null,
    updatedAt: str(n.updatedAt),
    lastActivity: lastActivity(n),
  }
}

function parseMention(n: Json): Mention {
  return { url: n.url, number: Number(n.number), title: str(n.title), repo: str(n.repository?.nameWithOwner), updatedAt: str(n.updatedAt) }
}

export function parseSnapshot(json: unknown, teammates: string[]): GitHubSnapshot {
  const root = (json ?? {}) as Json
  const data = (root.data ?? {}) as Json
  const failed = new Set<string>(
    Array.isArray(root.errors) ? root.errors.map((e: Json) => e?.path?.[0]).filter((p: unknown) => typeof p === 'string') : [],
  )
  const byTeammate: GitHubSnapshot['byTeammate'] = {}
  teammates.forEach((login, i) => {
    const alias = `t${i}`
    const conn = data[alias]
    byTeammate[login] = !isValidLogin(login) || failed.has(alias) || !conn ? 'error' : nodes(conn).map(parsePullRequest)
  })
  return {
    reviewRequested: nodes(data.reviewRequested).map(parsePullRequest),
    mine: nodes(data.mine).map(parsePullRequest),
    mentions: nodes(data.mentions).map(parseMention),
    byTeammate,
  }
}
