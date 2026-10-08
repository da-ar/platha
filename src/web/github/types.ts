export type CiState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
export type Mergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

export interface PullRequest {
  url: string
  number: number
  title: string
  repo: string
  author: string
  isDraft: boolean
  reviewDecision: ReviewDecision
  mergeable: Mergeable
  ci: CiState
  updatedAt: string
  /** The newer of the latest comment and the latest review. */
  lastActivity: { author: string; at: string } | null
}

export interface Mention {
  url: string
  number: number
  title: string
  repo: string
  updatedAt: string
}

export interface GitHubSnapshot {
  reviewRequested: PullRequest[]
  mine: PullRequest[]
  mentions: Mention[]
  byTeammate: Record<string, PullRequest[] | 'error'>
}
