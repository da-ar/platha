import type { ReactNode } from 'react'
import type { PullRequest } from '../github/types'

type Tone = 'ok' | 'fail' | 'warn' | 'muted' | 'accent'

/** A 16px stroke icon; the label is its tooltip and accessible name. */
export function Icon({ label, tone, children }: { label: string; tone: Tone; children: ReactNode }) {
  return (
    <span className={`status-icon status-icon--${tone}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </span>
  )
}

const circle = <circle cx="8" cy="8" r="6.25" />

/** SVG contents for each glyph, shared by the drawer and the tile summary. */
export const GLYPHS = {
  draft: (
    <>
      <path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" />
      <path d="M9 4l3 3" />
    </>
  ),
  approved: (
    <>
      {circle}
      <path d="M5.4 8.2l1.8 1.8 3.4-3.6" />
    </>
  ),
  changes: (
    <>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
      <path d="M8 5.3v2.4M8 9.3v.1" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
  tick: <path d="M3.5 8.5l3 3 6-7" />,
  cross: <path d="M4 4l8 8M12 4l-8 8" />,
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  clock: (
    <>
      {circle}
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  conflict: (
    <>
      <path d="M8 2.2L14.3 13.5H1.7z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </>
  ),
}

function ReviewIcon({ decision }: { decision: PullRequest['reviewDecision'] }) {
  switch (decision) {
    case 'APPROVED':
      return <Icon label="Approved" tone="ok">{GLYPHS.approved}</Icon>
    case 'CHANGES_REQUESTED':
      return <Icon label="Changes requested" tone="warn">{GLYPHS.changes}</Icon>
    case 'REVIEW_REQUIRED':
      return <Icon label="Review required" tone="muted">{GLYPHS.eye}</Icon>
    default:
      return null
  }
}

function CiIcon({ ci }: { ci: PullRequest['ci'] }) {
  switch (ci) {
    case 'SUCCESS':
      return <Icon label="CI passing" tone="ok">{GLYPHS.tick}</Icon>
    case 'FAILURE':
    case 'ERROR':
      return <Icon label={ci === 'FAILURE' ? 'CI failing' : 'CI error'} tone="fail">{GLYPHS.cross}</Icon>
    case 'PENDING':
      return <Icon label="CI running" tone="warn">{GLYPHS.dot}</Icon>
    case 'EXPECTED':
      return <Icon label="CI waiting" tone="muted">{GLYPHS.clock}</Icon>
    default:
      return null
  }
}

/** Draft, review, CI and conflict state of a pull request, as icons. */
export function PrStatusIcons({ pr }: { pr: PullRequest }) {
  return (
    <span className="status-icons">
      {pr.isDraft && <Icon label="Draft" tone="muted">{GLYPHS.draft}</Icon>}
      <ReviewIcon decision={pr.reviewDecision} />
      <CiIcon ci={pr.ci} />
      {pr.mergeable === 'CONFLICTING' && <Icon label="Merge conflicts" tone="fail">{GLYPHS.conflict}</Icon>}
    </span>
  )
}
