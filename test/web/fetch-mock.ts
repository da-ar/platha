import { vi } from 'vitest'

type Handler = (req: { method: string; path: string; body: unknown }) => { status: number; body?: unknown } | undefined

/** Mocks `fetch` for same-origin API calls. Returns the list of requests made. */
export function mockApi(handler: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const req = { method: init?.method ?? 'GET', path: url.pathname, body }
    calls.push(req)
    const res = handler(req) ?? { status: 404 }
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return calls
}
