import { useState, type FormEvent } from 'react'
import { join } from '../api'
import { go } from '../navigate'
import { setToken } from '../token'
import { AuthCard } from './Shell'
import { authError, TokenField } from './TokenField'

export function Join({ code }: { code: string }) {
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await join(code, token)
    setBusy(false)
    if (!r.ok) return setError(authError(r.status, 'join'))
    setToken(token)
    go('/')
  }

  return (
    <AuthCard title="Join the office">
      <p>Paste a GitHub token so Platha can show your pull requests. It stays in this browser.</p>
      <form onSubmit={submit}>
        <TokenField value={token} onChange={setTokenValue} />
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn btn--primary" type="submit" disabled={busy || token.trim() === ''}>
          Join
        </button>
      </form>
    </AuthCard>
  )
}
