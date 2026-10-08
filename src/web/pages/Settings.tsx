import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { displayName, type Member } from '../../shared/types'
import { getInvite, logout, removeMember, rotateInvite, updateProfile } from '../api'
import { go } from '../navigate'
import { Avatar } from '../office/Avatar'
import { useOffice } from '../office/useOffice'
import { clearToken, setToken } from '../token'
import { TokenField } from './TokenField'

export function Settings({ me }: { me: Member }) {
  const { state } = useOffice()
  const self = state.members[me.githubId] ?? me
  return (
    <main className="settings">
      <div className="inline-form">
        <a className="btn btn--ghost" href="/">
          ← Back to the office
        </a>
      </div>
      <h1>Settings</h1>
      <SlackSection me={self} />
      <TokenSection />
      {self.role === 'admin' && <AdminSection me={self} members={Object.values(state.members)} />}
      <section className="panel">
        <h2>Sign out</h2>
        <p className="muted">Signs this browser out and forgets your GitHub token here.</p>
        <button
          className="btn"
          type="button"
          onClick={async () => {
            await logout()
            clearToken()
            go('/')
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  )
}

function SlackSection({ me }: { me: Member }) {
  const [value, setValue] = useState(me.slackUserId ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const r = await updateProfile(value.trim() === '' ? null : value)
    if (r.ok) {
      setValue(r.data.member.slackUserId ?? '')
      setMsg({ ok: true, text: 'Saved' })
    } else {
      setMsg({ ok: false, text: r.status === 400 ? "That isn't a Slack member ID — it starts with U or W." : "Couldn't save — try again." })
    }
  }

  return (
    <section className="panel">
      <h2>Slack</h2>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="slack-id">Slack member ID</label>
          <div className="inline-form">
            <input id="slack-id" autoComplete="off" placeholder="U01ABCDEF" value={value} onChange={(e) => setValue(e.target.value)} />
            <button className="btn btn--primary" type="submit">
              Save
            </button>
          </div>
          <span className="hint">Slack → your profile → ⋮ → Copy member ID</span>
        </div>
      </form>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'ok' : 'error'}>
          {msg.text}
        </p>
      )}
    </section>
  )
}

function TokenSection() {
  const [token, setTokenValue] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <section className="panel">
      <h2>GitHub token</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setToken(token)
          setTokenValue('')
          setSaved(true)
        }}
      >
        <TokenField value={token} onChange={setTokenValue} label="Replace GitHub token" />
        <button className="btn btn--primary" type="submit" disabled={!token.trim()}>
          Save token
        </button>
      </form>
      {saved && (
        <p role="status" className="ok">
          Token saved in this browser.
        </p>
      )}
    </section>
  )
}

function AdminSection({ me, members }: { me: Member; members: Member[] }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = useMemo(
    () => members.filter((m) => m.githubId !== me.githubId).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [members, me.githubId],
  )

  useEffect(() => {
    void getInvite().then((r) => r.ok && setInviteUrl(r.data.inviteUrl))
  }, [])

  async function copy() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function rotate() {
    if (!window.confirm('Rotate the invite link? The old link will stop working. Existing members are not affected.')) return
    const r = await rotateInvite()
    if (r.ok) {
      setInviteUrl(r.data.inviteUrl)
      setCopied(false)
    } else setError("Couldn't rotate the link — try again.")
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${displayName(m)} from the office? They'll need a current invite link to come back.`)) return
    const r = await removeMember(m.githubId)
    if (!r.ok) setError(`Couldn't remove ${displayName(m)} — try again.`)
  }

  return (
    <section className="panel">
      <h2>Admin</h2>
      <div className="field">
        <label htmlFor="invite-link">Invite link</label>
        <div className="inline-form">
          <input id="invite-link" readOnly value={inviteUrl ?? ''} onFocus={(e) => e.target.select()} />
          <button className="btn" type="button" onClick={copy} disabled={!inviteUrl}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn btn--danger" type="button" onClick={rotate}>
            Rotate link
          </button>
        </div>
        <span className="hint">Anyone with this link can join.</span>
      </div>
      <h2>Members</h2>
      {others.length === 0 ? (
        <p className="muted">No one else has joined yet.</p>
      ) : (
        <ul className="member-list">
          {others.map((m) => (
            <li key={m.githubId}>
              <Avatar member={m} size={32} />
              <span className="grow">
                {displayName(m)} <span className="muted">@{m.login}</span>
              </span>
              <button className="btn btn--danger" type="button" onClick={() => remove(m)} aria-label={`Remove ${displayName(m)}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}
