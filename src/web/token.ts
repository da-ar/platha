const KEY = 'platha.githubToken'

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token.trim())
  } catch {
    // storage unavailable (private mode); GitHub data just won't load
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
