import type { ReactNode } from 'react'
import type { PullRequest } from '../github/types'

type Tone = 'ok' | 'fail' | 'warn' | 'muted'

/** A 16px stroke icon; the label is its tooltip and accessible name. */
function Icon({ label, tone, children }: { label: string; tone: Tone; children: ReactNode }) {
  return (
    <span className={`status-icon status-icon--${tone}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </span>
  )
}

const circle = <circle cx="8" cy="8" r="6.25" />

function ReviewIcon({ decision }: { decision: PullRequest['reviewDecision'] }) {
  switch (decision) {
    case 'APPROVED':
      return (
        <Icon label="Approved" tone="ok">
          {circle}
          <path d="M5.4 8.2l1.8 1.8 3.4-3.6" />
        </Icon>
      )
    case 'CHANGES_REQUESTED':
      return (
        <Icon label="Changes requested" tone="warn">
          <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          <path d="M8 5.3v2.4M8 9.3v.1" />
        </Icon>
      )
    case 'REVIEW_REQUIRED':
      return (
        <Icon label="Review required" tone="muted">
          <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="1.8" />
        </Icon>
      )
    default:
      return null
  }
}

function CiIcon({ ci }: { ci: PullRequest['ci'] }) {
  switch (ci) {
    case 'SUCCESS':
      return (
        <Icon label="CI passing" tone="ok">
          <path d="M3.5 8.5l3 3 6-7" />
        </Icon>
      )
    case 'FAILURE':
    case 'ERROR':
      return (
        <Icon label={ci === 'FAILURE' ? 'CI failing' : 'CI error'} tone="fail">
          <path d="M4 4l8 8M12 4l-8 8" />
        </Icon>
      )
    case 'PENDING':
      return (
        <Icon label="CI running" tone="warn">
          <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
        </Icon>
      )
    case 'EXPECTED':
      return (
        <Icon label="CI waiting" tone="muted">
          {circle}
          <path d="M8 4.8V8l2.2 1.4" />
        </Icon>
      )
    default:
      return null
  }
}

/** Draft, review, CI and conflict state of a pull request, as icons. */
export function PrStatusIcons({ pr }: { pr: PullRequest }) {
  return (
    <span className="status-icons">
      {pr.isDraft && (
        <Icon label="Draft" tone="muted">
          <path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" />
          <path d="M9 4l3 3" />
        </Icon>
      )}
      <ReviewIcon decision={pr.reviewDecision} />
      <CiIcon ci={pr.ci} />
      {pr.mergeable === 'CONFLICTING' && (
        <Icon label="Merge conflicts" tone="fail">
          <path d="M8 2.2L14.3 13.5H1.7z" />
          <path d="M8 6.5v3M8 11.6v.1" />
        </Icon>
      )}
    </span>
  )
}
