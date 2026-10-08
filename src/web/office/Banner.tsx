import { useState, type FormEvent, type ReactNode } from 'react'

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role="status">
      {children}
    </div>
  )
}

export const TOKEN_BROKEN = 'Your GitHub token stopped working — paste a new one.'

export function TokenBanner({ onSave }: { onSave: (token: string) => void }) {
  const [token, setToken] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (token.trim()) onSave(token.trim())
  }
  return (
    <Banner tone="warn">
      <form className="banner__form" onSubmit={submit}>
        <label htmlFor="banner-token">{TOKEN_BROKEN}</label>
        <input id="banner-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn btn--primary" type="submit" disabled={!token.trim()}>
          Save
        </button>
      </form>
    </Banner>
  )
}

/** "Updated just now", "Updated 40s ago" (to the nearest 10 s) or "Updated 3m ago". */
export function updatedAgo(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (seconds < 10) return 'Updated just now'
  if (seconds < 60) return `Updated ${Math.floor(seconds / 10) * 10}s ago`
  return `Updated ${Math.floor(seconds / 60)}m ago`
}
