import { vi } from 'vitest'

export const users: Record<string, { id: number; login: string; name: string | null; avatar_url: string }> = {
  'tok-alice': { id: 1, login: 'alice', name: 'Alice', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  'tok-bob': { id: 2, login: 'bob', name: 'Bob', avatar_url: 'https://avatars.githubusercontent.com/u/2' },
  'tok-carol': { id: 3, login: 'carol', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/3' },
}

/** Stubs GitHub `GET /user`. Returns the list of Authorization headers GitHub received. */
export function stubGitHub(opts: { status?: number } = {}): string[] {
  const seen: string[] = []
  const original = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    if (!req.url.startsWith('https://api.github.com/')) return original(input, init)
    const auth = req.headers.get('Authorization') ?? ''
    seen.push(auth)
    if (opts.status) return new Response('{}', { status: opts.status })
    const user = users[auth.replace(/^Bearer /, '')]
    if (!user || req.url !== 'https://api.github.com/user') return Response.json({ message: 'Bad credentials' }, { status: 401 })
    return Response.json(user)
  })
  return seen
}
