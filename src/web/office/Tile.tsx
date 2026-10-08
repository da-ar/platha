import { displayName, type Member } from '../../shared/types'
import type { PullRequest } from '../github/types'
import { Avatar } from './Avatar'
import { presenceLabel } from './presence'
import { GLYPHS } from './PrStatusIcons'
import { openLabel, summarizePrs, summaryLines, type SummaryKind } from './prSummary'

const SUMMARY_ICON: Record<SummaryKind, { glyph: keyof typeof GLYPHS; tone: string }> = {
  waitingOnYou: { glyph: 'eye', tone: 'accent' },
  ready: { glyph: 'approved', tone: 'ok' },
  changesRequested: { glyph: 'changes', tone: 'warn' },
  failing: { glyph: 'cross', tone: 'fail' },
  conflicts: { glyph: 'conflict', tone: 'fail' },
  drafts: { glyph: 'draft', tone: 'muted' },
}

function PrSummaryBlock({ prs, reviewRequestedUrls, isMe }: { prs: PullRequest[]; reviewRequestedUrls: Set<string>; isMe: boolean }) {
  const summary = summarizePrs(prs, reviewRequestedUrls, isMe)
  const lines = summaryLines(summary)
  return (
    <span className="tile__summary">
      <span className={summary.open === 0 ? 'muted' : 'tile__open'}>{openLabel(summary.open)}</span>
      {lines.length > 0 && (
        <span className="tile__counts">
          {lines.map((line) => {
            const icon = SUMMARY_ICON[line.kind]
            return (
              <span key={line.kind} className={`tile__count status-icon--${icon.tone}${line.kind === 'waitingOnYou' ? ' tile__waiting' : ''}`}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {GLYPHS[icon.glyph]}
                </svg>
                {line.label}
              </span>
            )
          })}
        </span>
      )}
    </span>
  )
}

export function Tile({
  member,
  prs,
  reviewRequestedUrls = new Set(),
  isMe = false,
  onOpen,
}: {
  member: Member
  prs: PullRequest[] | 'error' | undefined
  reviewRequestedUrls?: Set<string>
  isMe?: boolean
  onOpen: () => void
}) {
  const name = displayName(member)
  const label = presenceLabel(member)
  const tone = label.toLowerCase()
  return (
    <button type="button" className={`tile${member.online ? '' : ' tile--offline'}`} aria-label={`${name}, ${label}`} onClick={onOpen}>
      <span className="tile__head">
        <span className="tile__avatar">
          <Avatar member={member} />
          <span className={`dot dot--${tone}`} aria-hidden="true" />
        </span>
        <span className="tile__who">
          <span className="tile__name">
            {name}
            {isMe && <span className="tile__you"> (you)</span>}
          </span>
          <span className={`tile__status tile__status--${tone}`}>{label}</span>
          {member.online && member.statusText && <span className="tile__note">{member.statusText}</span>}
        </span>
      </span>
      <span className="tile__prs">
        {prs === 'error' ? (
          <span className="muted">Couldn't load</span>
        ) : prs === undefined ? null : (
          <PrSummaryBlock prs={prs} reviewRequestedUrls={reviewRequestedUrls} isMe={isMe} />
        )}
      </span>
    </button>
  )
}
