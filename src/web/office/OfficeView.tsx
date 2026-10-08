import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useCallback, useMemo, useState } from 'react'
import { displayName, type Member } from '../../shared/types'
import type { OfficeConfig } from '../api'
import { AlertsButton } from '../call/AlertsButton'
import { CallModal } from '../call/CallModal'
import { KnockToasts } from '../call/KnockToast'
import { openNewMeet } from '../call/meet'
import { useKnocks } from '../call/useKnocks'
import { useRinging } from '../call/ring'
import { computeAttention, type AttentionItem } from '../github/attention'
import { loadSeen, markSeen } from '../github/seen'
import { useGitHub } from '../github/useGitHub'
import { openTab } from '../navigate'
import { setToken } from '../token'
import { TokenBanner } from './Banner'
import { Drawer } from './Drawer'
import { NeedsYou } from './NeedsYou'
import { StatusPicker } from './StatusPicker'
import { Tile } from './Tile'
import { useNow } from './useNow'
import { useOffice } from './useOffice'

export const REMOVED = "You've been removed from this office."

export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => Number(b.online) - Number(a.online) || displayName(a).localeCompare(displayName(b)))
}

export function OfficeView({ me, config, meetUrl = null }: { me: Member; config: OfficeConfig; meetUrl?: string | null }) {
  const office = useOffice()
  const { state, send } = office
  const now = useNow(10_000)
  // Tiles glide to their new place when someone comes online or goes offline.
  const [tilesRef] = useAutoAnimate<HTMLDivElement>()
  const [selected, setSelected] = useState<number | null>(null)
  const [calling, setCalling] = useState<{ member: Member; popupBlocked: boolean; roomUrl?: string } | null>(null)
  const knocks = useKnocks(office, state.members)
  useRinging(knocks.incoming)
  const closeDrawer = useCallback(() => setSelected(null), [])
  const [seen, setSeen] = useState(loadSeen)

  const members = useMemo(() => {
    const list = Object.values(state.members)
    return sortMembers(list.length > 0 ? list : [{ ...me, online: true }])
  }, [state.members, me])
  const self = state.members[me.githubId] ?? me
  const teammates = useMemo(
    () => members.filter((m) => m.githubId !== me.githubId).map((m) => m.login).sort(),
    [members, me.githubId],
  )

  const github = useGitHub({ org: config.org, teammates })
  const items = useMemo(() => (github.snapshot ? computeAttention(github.snapshot, self.login, seen) : []), [github.snapshot, self.login, seen])
  const reviewRequestedUrls = useMemo(() => new Set(github.snapshot?.reviewRequested.map((pr) => pr.url) ?? []), [github.snapshot])

  function openItem(item: AttentionItem) {
    openTab(item.url)
    setSeen((s) => markSeen(s, item))
  }

  function prsFor(m: Member) {
    if (!github.snapshot) return undefined
    return m.githubId === me.githubId ? github.snapshot.mine : github.snapshot.byTeammate[m.login]
  }

  function startCall(m: Member) {
    knocks.dismissOutgoing()
    if (meetUrl) {
      // Saved room: open it for you and ring straight away; nothing to copy.
      openTab(meetUrl)
      knocks.call(m, meetUrl)
      setCalling({ member: m, popupBlocked: false, roomUrl: meetUrl })
    } else {
      setCalling({ member: m, popupBlocked: !openNewMeet() })
    }
  }

  const selectedMember = selected === null ? null : (state.members[selected] ?? null)

  if (state.connection === 'removed') {
    return (
      <main className="auth">
        <div className="auth__card">
          <p className="brand">Platha</p>
          <h1>{REMOVED}</h1>
        </div>
      </main>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="brand">Platha</span>
          {config.org && <span className="topbar__org">{config.org}</span>}
        </div>
        <StatusPicker me={self} send={send} />
        <div className="topbar__end">
          {state.connection === 'reconnecting' && <span className="reconnecting">Reconnecting…</span>}
          <AlertsButton />
          <a className="btn btn--ghost" href="/settings">
            Settings
          </a>
        </div>
      </header>

      {github.status === 'unauthorized' && (
        <TokenBanner
          onSave={(token) => {
            setToken(token)
            github.refresh()
          }}
        />
      )}
      <main className="office">
        <section className="office__team" aria-label="Team">
          <div className="tiles" ref={tilesRef}>
            {members.map((m) => (
              <Tile
                key={m.githubId}
                member={m}
                isMe={m.githubId === me.githubId}
                prs={prsFor(m)}
                reviewRequestedUrls={reviewRequestedUrls}
                onOpen={() => setSelected(m.githubId)}
              />
            ))}
          </div>
        </section>
        <aside className="office__side">
          <NeedsYou
            items={items}
            status={github.status}
            onOpen={openItem}
            updatedAt={github.updatedAt}
            now={now}
            fetching={github.fetching}
            onRefresh={github.refresh}
          />
        </aside>
      </main>

      {selectedMember && (
        <Drawer
          member={selectedMember}
          prs={prsFor(selectedMember)}
          isMe={selectedMember.githubId === me.githubId}
          slackTeamId={config.slackTeamId}
          onClose={closeDrawer}
          onCall={() => startCall(selectedMember)}
        />
      )}
      {calling && (
        <CallModal
          member={calling.member}
          popupBlocked={calling.popupBlocked}
          roomUrl={calling.roomUrl}
          outgoing={knocks.outgoing && knocks.outgoing.to.githubId === calling.member.githubId ? knocks.outgoing : null}
          onSubmit={(url) => knocks.call(calling.member, url)}
          onCancel={() => {
            setCalling(null)
            knocks.dismissOutgoing()
          }}
        />
      )}
      <KnockToasts incoming={knocks.incoming} onAnswer={knocks.answer} />
    </div>
  )
}
