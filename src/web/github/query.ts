import { isValidLogin, parseSnapshot } from './parse'
import type { GitHubSnapshot } from './types'

export const GRAPHQL_URL = 'https://api.github.com/graphql'
const MENTION_WINDOW_DAYS = 14
/** Results per search. Smaller pages keep each request well inside GitHub's ~10 s query limit. */
export const PAGE_SIZE = 30
/** How many searches run at once. */
const CONCURRENCY = 4

const PR_FIELDS = `url number title isDraft reviewDecision mergeable updatedAt
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  comments(last: 1) { nodes { author { login } createdAt } }
  reviews(last: 1) { nodes { author { login } submittedAt } }`

const PR = `... on PullRequest { ${PR_FIELDS} }`
const MENTION =
  '... on Issue { url number title updatedAt repository { nameWithOwner } } ... on PullRequest { url number title updatedAt repository { nameWithOwner } }'

export interface SearchRequest {
  /** The key this search's results are stored under: reviewRequested, mine, mentions, or t<i> for teammate i. */
  alias: string
  query: string
}

function request(alias: string, search: string, selection: string): SearchRequest {
  return { alias, query: `query { ${alias}: search(type: ISSUE, first: ${PAGE_SIZE}, query: ${JSON.stringify(search)}) { nodes { ${selection} } } }` }
}

/**
 * One small GraphQL request per search. A single combined query timed out on
 * GitHub (502) for real teams. Teammate `i` is aliased `t<i>` by its position in
 * `teammates`; invalid logins are skipped.
 */
export function buildRequests(org: string, teammates: string[], now: Date): SearchRequest[] {
  const since = new Date(now.getTime() - MENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const scope = `org:${org}`
  const requests = [
    request('reviewRequested', `is:pr is:open review-requested:@me ${scope}`, PR),
    request('mine', `is:pr is:open author:@me ${scope}`, PR),
    request('mentions', `is:open mentions:@me ${scope} updated:>=${since}`, MENTION),
  ]
  teammates.forEach((login, i) => {
    if (isValidLogin(login)) requests.push(request(`t${i}`, `is:pr is:open author:${login} ${scope}`, PR))
  })
  return requests
}

type GraphQLBody = { data?: Record<string, unknown> | null; errors?: { type?: string; path?: unknown[] }[] }

/** status 0 means the request never got a readable answer (offline, or a gateway error without CORS headers). */
async function post(token: string, query: string): Promise<{ status: number; body?: GraphQLBody }> {
  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
  } catch {
    return { status: 0 }
  }
  if (!res.ok) return { status: res.status }
  const body = (await res.json().catch(() => null)) as GraphQLBody | null
  if (!body || !body.data) return { status: body?.errors?.some((e) => e.type === 'RATE_LIMITED') ? 429 : 502 }
  return { status: 200, body }
}

const TRANSIENT = new Set([0, 502, 503, 504])

/** Retries once on a timeout or gateway error. */
async function postWithRetry(token: string, query: string): Promise<{ status: number; body?: GraphQLBody }> {
  const first = await post(token, query)
  return TRANSIENT.has(first.status) ? post(token, query) : first
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Status for a whole poll: auth and rate limits win, then any other failure. */
function worstStatus(statuses: number[]): number {
  for (const s of [401, 403, 429]) if (statuses.includes(s)) return s
  return statuses.find((s) => s !== 200) ?? 200
}

export async function fetchSnapshot(token: string, org: string, teammates: string[]): Promise<{ status: number; snapshot?: GitHubSnapshot }> {
  const requests = buildRequests(org, teammates, new Date())
  const responses = await mapLimit(requests, CONCURRENCY, (r) => postWithRetry(token, r.query))

  const statuses = responses.map((r) => r.status)
  if (statuses.includes(401)) return { status: 401 }

  // Your own searches must all succeed; a teammate's failure only affects their tile.
  const own = responses.slice(0, 3).map((r) => r.status)
  if (own.some((s) => s !== 200)) return { status: worstStatus(statuses) }

  const data: Record<string, unknown> = {}
  const errors: { path: string[] }[] = []
  requests.forEach((req, i) => {
    const body = responses[i].body
    const value = body?.data?.[req.alias]
    const failed = responses[i].status !== 200 || !value || body?.errors?.some((e) => e.path?.[0] === req.alias)
    if (failed) errors.push({ path: [req.alias] })
    else data[req.alias] = value
  })
  return { status: 200, snapshot: parseSnapshot({ data, errors }, teammates) }
}
