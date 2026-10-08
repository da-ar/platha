export const TOKEN_HELP_URL = 'https://github.com/da-ar/platha/blob/main/docs/SETUP.md#token'

export function TokenField({ value, onChange, label = 'GitHub token' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="field">
      <label htmlFor="github-token">{label}</label>
      <input
        id="github-token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="github_pat_…"
      />
      <a className="hint" href={TOKEN_HELP_URL} target="_blank" rel="noreferrer">
        How do I make a token?
      </a>
    </div>
  )
}

export const NEED_INVITE = 'You need an invite link.'

export function authError(status: number, page: 'setup' | 'join' | 'login'): string {
  switch (status) {
    case 404:
      return "That invite link isn't valid any more."
    case 429:
      return 'Too many attempts — try again in 10 minutes.'
    case 401:
      return "GitHub didn't accept that token."
    case 403:
      return page === 'setup' ? "That setup code isn't right." : NEED_INVITE
    case 409:
      return 'This office is already set up.'
    case 502:
      return "Couldn't reach GitHub — try again."
    default:
      return 'Something went wrong — try again.'
  }
}
