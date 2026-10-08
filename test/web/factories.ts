import type { Member } from '../../src/shared/types'
import type { GitHubSnapshot, PullRequest } from '../../src/web/github/types'

export function member(over: Partial<Member> = {}): Member {
  return {
    githubId: 1,
    login: 'alice',
    name: 'Alice',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    slackUserId: null,
    role: 'member',
    status: 'available',
    statusText: null,
    online: true,
    meetingUntil: null,
    ...over,
  }
}

export function pr(n: number, over: Partial<PullRequest> = {}): PullRequest {
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

export function snapshot(over: Partial<GitHubSnapshot> = {}): GitHubSnapshot {
  return { reviewRequested: [], mine: [], mentions: [], byTeammate: {}, ...over }
}
