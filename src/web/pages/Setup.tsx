import { useEffect, useState, type FormEvent } from 'react'
import { setup, setupStatus } from '../api'
import { go } from '../navigate'
import { setToken } from '../token'
import { NoInvite } from './NoInvite'
import { AuthCard } from './Shell'
import { authError, TokenField } from './TokenField'

export function Setup() {
  const [setUp, setSetUp] = useState<boolean | null>(null)
  const [secret, setSecret] = useState('')
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  useEffect(() => {
    void setupStatus().then((r) => setSetUp(r.ok ? r.data.setUp : false))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await setup(secret, token)
    setBusy(false)
    if (!r.ok) return setError(authError(r.status, 'setup'))
    setToken(token)
    setInviteUrl(r.data.inviteUrl)
  }

  if (setUp === null) return null
  if (setUp && inviteUrl === null) return <NoInvite />

  if (inviteUrl !== null) {
    return (
      <AuthCard title="Your office is ready">
        <p>Share this invite link with your team. You can find it again in Settings.</p>
        <input className="copy-field" readOnly value={inviteUrl} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button className="btn btn--primary" onClick={() => go('/')}>
          Go to the office
        </button>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Set up your office">
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="setup-secret">Setup code</label>
          <input id="setup-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <span className="hint">The SETUP_SECRET you set when deploying.</span>
        </div>
        <TokenField value={token} onChange={setTokenValue} />
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn btn--primary" type="submit" disabled={busy || !secret || !token.trim()}>
          Create office
        </button>
      </form>
    </AuthCard>
  )
}
