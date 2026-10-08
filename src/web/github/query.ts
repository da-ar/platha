import { isValidLogin, parseSnapshot } from './parse'
import type { GitHubSnapshot } from './types'

export const GRAPHQL_URL = 'https://api.github.com/graphql'
const MENTION_WINDOW_DAYS = 14

const PR_FRAGMENT = `fragment PR on PullRequest {
  url number title isDraft reviewDecision mergeable updatedAt
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  comments(last: 1) { nodes { author { login } createdAt } }
  reviews(last: 1) { nodes { author { login } submittedAt } }
}`

function search(alias: string, query: string, selection: string): string {
  return `  ${alias}: search(type: ISSUE, first: 50, query: ${JSON.stringify(query)}) { nodes { ${selection} } }`
}

/** Teammate `i` is aliased `t<i>` by its position in `teammates`; invalid logins are skipped. */
export function buildQuery(org: string, teammates: string[], now: Date): string {
  const since = new Date(now.getTime() - MENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const scope = `org:${org}`
  const lines = [
    search('reviewRequested', `is:pr is:open review-requested:@me ${scope}`, '...PR'),
    search('mine', `is:pr is:open author:@me ${scope}`, '...PR'),
    search(
      'mentions',
      `is:open mentions:@me ${scope} updated:>=${since}`,
      '... on Issue { url number title updatedAt repository { nameWithOwner } } ... on PullRequest { url number title updatedAt repository { nameWithOwner } }',
    ),
  ]
  teammates.forEach((login, i) => {
    if (isValidLogin(login)) lines.push(search(`t${i}`, `is:pr is:open author:${login} ${scope}`, '...PR'))
  })
  return `query Platha {\n${lines.join('\n')}\n}\n${PR_FRAGMENT}`
}

export async function fetchSnapshot(token: string, org: string, teammates: string[]): Promise<{ status: number; snapshot?: GitHubSnapshot }> {
  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: buildQuery(org, teammates, new Date()) }),
    })
  } catch {
    return { status: 0 }
  }
  if (!res.ok) return { status: res.status }
  const json = (await res.json().catch(() => null)) as { data?: unknown; errors?: { type?: string }[] } | null
  if (!json || !json.data) {
    const limited = json?.errors?.some((e) => e.type === 'RATE_LIMITED')
    return { status: limited ? 429 : 502 }
  }
  return { status: 200, snapshot: parseSnapshot(json, teammates) }
}
