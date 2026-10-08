import { SELF, runInDurableObject } from 'cloudflare:test'
import { parseServerMessage, type ServerMessage } from '../../src/shared/messages'
import type { Office } from '../../src/worker/office/Office'
import { mainOffice } from './helpers'
import { ORIGIN } from './http'

export interface TestSocket {
  ws: WebSocket
  messages: ServerMessage[]
  closed: { code: number } | null
  /** Waits for the next message matching `type` (and optional predicate) that hasn't been consumed yet. */
  next<T extends ServerMessage['type']>(type: T, pred?: (m: Extract<ServerMessage, { type: T }>) => boolean): Promise<Extract<ServerMessage, { type: T }>>
  /** Returns messages of a type received so far without waiting. */
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[]
  send(msg: unknown): void
  waitClosed(): Promise<{ code: number }>
}

const open: WebSocket[] = []

export async function connect(cookie: string, origin = ORIGIN): Promise<TestSocket> {
  const res = await SELF.fetch(`${ORIGIN}/ws`, { headers: { Upgrade: 'websocket', Origin: origin, Cookie: cookie } })
  const ws = res.webSocket
  if (!ws) throw new Error(`no websocket: ${res.status}`)
  ws.accept()
  open.push(ws)
  const messages: ServerMessage[] = []
  const consumed = new Set<ServerMessage>()
  const waiters: (() => void)[] = []
  const sock: TestSocket = {
    ws,
    messages,
    closed: null,
    async next(type, pred) {
      for (;;) {
        const found = messages.find((m) => m.type === type && !consumed.has(m) && (!pred || pred(m as never)))
        if (found) {
          consumed.add(found)
          return found as never
        }
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2000)
          waiters.push(() => {
            clearTimeout(t)
            resolve()
          })
        })
      }
    },
    all(type) {
      return messages.filter((m) => m.type === type) as never
    },
    send(msg) {
      ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
    async waitClosed() {
      while (!sock.closed) {
        await new Promise<void>((resolve) => waiters.push(resolve))
      }
      return sock.closed
    },
  }
  const wake = () => waiters.splice(0).forEach((w) => w())
  ws.addEventListener('message', (e) => {
    const m = typeof e.data === 'string' ? parseServerMessage(e.data) : null
    if (m) messages.push(m)
    wake()
  })
  ws.addEventListener('close', (e) => {
    sock.closed = { code: e.code }
    wake()
  })
  return sock
}

export function closeAll(): void {
  for (const ws of open.splice(0)) {
    try {
      ws.close()
    } catch {
      // already closed
    }
  }
}

export async function settle(): Promise<void> {
  // Let close events reach the Durable Object.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10))
}

export async function socketCount(githubId?: number): Promise<number> {
  return runInDurableObject(mainOffice(), (_o: Office, state) => state.getWebSockets(githubId === undefined ? undefined : String(githubId)).length)
}

/** Polls until the office has dropped every closed socket of the member. */
export async function waitForSockets(githubId: number, n: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const open = await runInDurableObject(mainOffice(), (_o: Office, state) =>
      state.getWebSockets(String(githubId)).filter((w) => w.readyState === 1).length,
    )
    if (open === n) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`member ${githubId} never reached ${n} sockets`)
}
