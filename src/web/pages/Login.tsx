import { useEffect, useRef, useState, type FormEvent } from 'react'
import { login } from '../api'
import { go } from '../navigate'
import { getToken, setToken } from '../token'
import { AuthCard } from './Shell'
import { authError, NEED_INVITE, TokenField } from './TokenField'

const AUTO_LOGIN_KEY = 'platha.autoLoginTried'

function autoLoginTried(): boolean {
  try {
    return sessionStorage.getItem(AUTO_LOGIN_KEY) === '1'
  } catch {
    return false
  }
}

function markAutoLoginTried(): void {
  try {
    sessionStorage.setItem(AUTO_LOGIN_KEY, '1')
  } catch {
    // storage unavailable: the in-memory guard still applies for this page
  }
}

/** Called once the office loads, so a later expiry can sign back in automatically again. */
export function clearAutoLoginAttempt(): void {
  try {
    sessionStorage.removeItem(AUTO_LOGIN_KEY)
  } catch {
    // ignore
  }
}

export function Login() {
  // A saved token signs straight back in, but only once per tab until the office
  // loads: if signing in "works" and we land here again, stop rather than loop.
  const hasToken = getToken() !== null
  const saved = autoLoginTried() ? null : getToken()
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
    markAutoLoginTried()
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
      {!hasToken && error === null && <p className="muted">{NEED_INVITE}</p>}
    </AuthCard>
  )
}
