import { useEffect, useRef, useState, type FormEvent } from 'react'
import { login } from '../api'
import { go } from '../navigate'
import { getToken, setToken } from '../token'
import { AuthCard } from './Shell'
import { authError, NEED_INVITE, TokenField } from './TokenField'

export function Login() {
  const saved = getToken()
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(saved !== null)
  const tried = useRef(false)

  async function attempt(t: string): Promise<boolean> {
    const r = await login(t)
    if (r.ok) {
      setToken(t)
      go('/')
      return true
    }
    setError(authError(r.status, 'login'))
    return false
  }

  // A saved token means the session expired: try signing straight back in.
  useEffect(() => {
    if (saved === null || tried.current) return
    tried.current = true
    void attempt(saved).then((ok) => !ok && setBusy(false))
  }, [saved])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    if (!(await attempt(token))) setBusy(false)
  }

  return (
    <AuthCard title="Sign in">
      <p>Already a member? Paste your GitHub token to sign in on this browser.</p>
      <form onSubmit={submit}>
        <TokenField value={token} onChange={setTokenValue} />
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn btn--primary" type="submit" disabled={busy || token.trim() === ''}>
          Sign in
        </button>
      </form>
      {saved === null && error === null && <p className="muted">{NEED_INVITE}</p>}
    </AuthCard>
  )
}
