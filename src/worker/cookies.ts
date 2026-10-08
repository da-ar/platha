export const SESSION_COOKIE = 'platha_session'
const MAX_AGE = 30 * 24 * 60 * 60

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export function readSessionId(req: Request): string | null {
  const header = req.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) {
      const value = rest.join('=')
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
    }
  }
  return null
}
