import { useEffect, useMemo, useState } from 'react'
import { displayName, type Member } from '../../shared/types'
import type { OfficeConfig } from '../api'
import { computeAttention, type AttentionItem } from '../github/attention'
import { loadSeen, markSeen } from '../github/seen'
import { useGitHub } from '../github/useGitHub'
import { openTab } from '../navigate'
import { setToken } from '../token'
import { Banner, TokenBanner, updatedAgo } from './Banner'
import { NeedsYou } from './NeedsYou'
import { StatusPicker } from './StatusPicker'
import { Tile } from './Tile'
import { useOffice } from './useOffice'

export const REMOVED = "You've been removed from this office."

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => Number(b.online) - Number(a.online) || displayName(a).localeCompare(displayName(b)))
}

export function OfficeView({ me, config }: { me: Member; config: OfficeConfig }) {
  const office = useOffice()
  const { state, send } = office
  const now = useNow(30_000)
  const [, setSelected] = useState<number | null>(null)
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

  function openItem(item: AttentionItem) {
    openTab(item.url)
    setSeen((s) => markSeen(s, item))
  }

  function prsFor(m: Member) {
    if (!github.snapshot) return undefined
    return m.githubId === me.githubId ? github.snapshot.mine : github.snapshot.byTeammate[m.login]
  }

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
      {github.status === 'error' && (
        <Banner tone="info">{github.updatedAt ? updatedAgo(github.updatedAt, now) : "Couldn't reach GitHub — retrying."}</Banner>
      )}

      <main className="office">
        <section className="office__team" aria-label="Team">
          <div className="tiles">
            {members.map((m) => (
              <Tile key={m.githubId} member={m} isMe={m.githubId === me.githubId} prs={prsFor(m)} onOpen={() => setSelected(m.githubId)} />
            ))}
          </div>
        </section>
        <aside className="office__side">
          <NeedsYou items={items} status={github.status} onOpen={openItem} />
        </aside>
      </main>
    </div>
  )
}
