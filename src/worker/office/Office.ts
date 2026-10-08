import { DurableObject } from 'cloudflare:workers'
import { parseClientMessage, type ClientMessage, type ServerMessage } from '../../shared/messages'
import type { Member, Result } from '../../shared/types'
import { normalizeSlackUserId } from '../../shared/validators'
import { randomId, safeEqual } from '../crypto'
import type { Env } from '../env'
import type { GitHubIdentity } from '../github'
import * as store from './store'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const JOIN_FAILURE_WINDOW_MS = 10 * 60 * 1000
const JOIN_FAILURE_LIMIT = 10
const OFFLINE_GRACE_MS = 30_000
// Browsers throttle timers in background tabs to about once a minute, so the
// client's 25 s ping can arrive ~60 s apart. Allow well over that.
const STALE_SOCKET_MS = 150_000
const ALARM_INTERVAL_MS = 30_000
const OPEN = 1

interface SocketAttachment {
  githubId: number
  connectedAt: number
}

export class Office extends DurableObject<Env> {
  /** Overridable clock, for tests. */
  now: () => number = Date.now

  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    void ctx.blockConcurrencyWhile(async () => store.migrate(this.sql))
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  // --- presence ------------------------------------------------------------

  /** Accepts a WebSocket for the member named in `X-Platha-Member` (set by the Worker after checking the session). */
  async fetch(req: Request): Promise<Response> {
    const githubId = Number(req.headers.get('X-Platha-Member'))
    if (!store.getMember(this.sql, githubId)) return new Response('unknown member', { status: 401 })
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server, [String(githubId)])
    server.serializeAttachment({ githubId, connectedAt: this.now() } satisfies SocketAttachment)

    const firstSocket = this.socketsOf(githubId).length === 1
    const wasPending = store.getPendingOffline(this.sql, githubId) !== null
    store.clearPendingOffline(this.sql, githubId)

    this.send(server, { type: 'snapshot', members: await this.snapshot() })
    if (firstSocket && !wasPending) this.memberChanged(githubId, server)
    await this.scheduleAlarm(ALARM_INTERVAL_MS)
    return new Response(null, { status: 101, webSocket: client })
  }

  async snapshot(): Promise<Member[]> {
    return store.listMembers(this.sql).map((m) => this.withPresence(m))
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message === 'ping') return
    const msg = parseClientMessage(message)
    const from = this.attachment(ws)?.githubId
    if (!msg || from === undefined) return
    this.handleMessage(from, msg)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // already closed
    }
    await this.socketGone(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws)
  }

  async alarm(): Promise<void> {
    const now = this.now()

    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws)
      if (!att || ws.readyState !== OPEN) continue
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? att.connectedAt
      if (now - Math.max(lastPing, att.connectedAt) > STALE_SOCKET_MS) {
        try {
          ws.close(4408, 'no ping')
        } catch {
          // already closed
        }
        await this.socketGone(ws)
      }
    }

    let nextDue = Infinity
    for (const { githubId, dueAt } of store.listPendingOffline(this.sql)) {
      if (this.socketsOf(githubId).length > 0) {
        store.clearPendingOffline(this.sql, githubId)
      } else if (dueAt <= now) {
        store.clearPendingOffline(this.sql, githubId)
        this.memberChanged(githubId)
      } else {
        nextDue = Math.min(nextDue, dueAt - now)
      }
    }

    const delays: number[] = []
    if (nextDue !== Infinity) delays.push(Math.max(1000, nextDue))
    else if (this.ctx.getWebSockets().length > 0) delays.push(ALARM_INTERVAL_MS)

    // Failed joins are only needed for the rate-limit window.
    const oldestFailure = store.pruneJoinFailures(this.sql, now - JOIN_FAILURE_WINDOW_MS)
    if (oldestFailure !== null) delays.push(Math.max(1000, oldestFailure + JOIN_FAILURE_WINDOW_MS - now + 1))

    if (delays.length > 0) await this.scheduleAlarm(Math.min(...delays))
  }

  protected handleMessage(from: number, msg: ClientMessage): void {
    switch (msg.type) {
      case 'set_status':
        store.setStatus(this.sql, from, msg.status, msg.text?.trim() || null)
        this.memberChanged(from)
        return
      case 'knock':
        // Knocks are relayed, never persisted.
        if (msg.to === from || !store.getMember(this.sql, msg.to)) return
        if (this.socketsOf(msg.to).length === 0) {
          this.sendTo(from, { type: 'knock_failed', knockId: msg.knockId, reason: 'offline' })
        } else {
          this.sendTo(msg.to, { type: 'knock', knockId: msg.knockId, from, meetUrl: msg.meetUrl })
          this.sendTo(from, { type: 'knock_ringing', knockId: msg.knockId })
        }
        return
      case 'knock_answer':
        if (msg.to === from || !store.getMember(this.sql, msg.to)) return
        this.sendTo(msg.to, { type: 'knock_answered', knockId: msg.knockId, answer: msg.answer })
        return
    }
  }

  // --- profile and admin ---------------------------------------------------

  async updateProfile(githubId: number, profile: { slackUserId: string | null }): Promise<Result<Member, 'invalid_slack_id'>> {
    let slackUserId: string | null = null
    if (profile.slackUserId !== null && profile.slackUserId.trim() !== '') {
      slackUserId = normalizeSlackUserId(profile.slackUserId)
      if (slackUserId === null) return { ok: false, error: 'invalid_slack_id' }
    }
    store.setSlackUserId(this.sql, githubId, slackUserId)
    this.memberChanged(githubId)
    const member = this.member(githubId)
    if (!member) throw new Error('member vanished')
    return { ok: true, value: member }
  }

  async removeMember(adminId: number, githubId: number): Promise<Result<null, 'forbidden' | 'not_found' | 'cannot_remove_self'>> {
    if (!this.isAdmin(adminId)) return { ok: false, error: 'forbidden' }
    if (adminId === githubId) return { ok: false, error: 'cannot_remove_self' }
    if (!store.getMember(this.sql, githubId)) return { ok: false, error: 'not_found' }
    store.deleteMember(this.sql, githubId)
    for (const ws of this.socketsOf(githubId)) {
      this.send(ws, { type: 'session_revoked' })
      try {
        ws.close(4403, 'removed')
      } catch {
        // already closed
      }
    }
    this.broadcast({ type: 'member_removed', githubId })
    return { ok: true, value: null }
  }

  async rotateInvite(adminId: number): Promise<Result<string, 'forbidden'>> {
    if (!this.isAdmin(adminId)) return { ok: false, error: 'forbidden' }
    const code = randomId(16)
    store.setConfig(this.sql, 'invite_code', code)
    return { ok: true, value: code }
  }

  private async socketGone(ws: WebSocket): Promise<void> {
    const att = this.attachment(ws)
    if (!att) return
    const others = this.socketsOf(att.githubId).filter((w) => w !== ws)
    if (others.length > 0 || !store.getMember(this.sql, att.githubId)) return
    if (store.getPendingOffline(this.sql, att.githubId) !== null) return
    store.setPendingOffline(this.sql, att.githubId, this.now() + OFFLINE_GRACE_MS)
    await this.scheduleAlarm(OFFLINE_GRACE_MS)
  }

  /**
   * Alarms are scheduled on the real clock, as a delay: `now()` may be a test clock,
   * and an alarm set in its past would fire immediately and spin.
   */
  private async scheduleAlarm(delayMs: number): Promise<void> {
    const at = Date.now() + delayMs
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  protected socketsOf(githubId: number): WebSocket[] {
    return this.ctx.getWebSockets(String(githubId)).filter((w) => w.readyState === OPEN)
  }

  protected isOnline(githubId: number): boolean {
    return this.socketsOf(githubId).length > 0 || store.getPendingOffline(this.sql, githubId) !== null
  }

  protected attachment(ws: WebSocket): SocketAttachment | null {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? null
  }

  protected send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // socket is closing; its close handler cleans up
    }
  }

  protected sendTo(githubId: number, msg: ServerMessage): void {
    for (const ws of this.socketsOf(githubId)) this.send(ws, msg)
  }

  protected broadcast(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) if (ws.readyState === OPEN) this.send(ws, msg)
  }

  async isSetUp(): Promise<boolean> {
    return store.hasAdmin(this.sql)
  }

  async setup(identity: GitHubIdentity): Promise<Result<{ sessionId: string; inviteCode: string }, 'already_setup'>> {
    if (store.hasAdmin(this.sql)) return { ok: false, error: 'already_setup' }
    const inviteCode = randomId(16)
    this.ctx.storage.transactionSync(() => {
      store.upsertMember(this.sql, identity, 'admin', this.now())
      store.setConfig(this.sql, 'invite_code', inviteCode)
    })
    return { ok: true, value: { sessionId: this.createSession(identity.id), inviteCode } }
  }

  async checkInvite(code: string, ip: string): Promise<Result<null, 'bad_invite' | 'rate_limited'>> {
    const now = this.now()
    const since = now - JOIN_FAILURE_WINDOW_MS
    if (store.countJoinFailures(this.sql, ip, since) >= JOIN_FAILURE_LIMIT) return { ok: false, error: 'rate_limited' }
    const expected = store.getConfig(this.sql, 'invite_code')
    if (expected !== null && (await safeEqual(code, expected))) return { ok: true, value: null }
    store.recordJoinFailure(this.sql, ip, now)
    // Failed joins store an IP address; the alarm deletes them once they're no longer needed.
    await this.scheduleAlarm(JOIN_FAILURE_WINDOW_MS + 1000)
    return { ok: false, error: 'bad_invite' }
  }

  async addMember(identity: GitHubIdentity): Promise<{ sessionId: string }> {
    store.upsertMember(this.sql, identity, 'member', this.now())
    this.memberChanged(identity.id)
    return { sessionId: this.createSession(identity.id) }
  }

  async login(identity: GitHubIdentity): Promise<Result<{ sessionId: string }, 'not_member'>> {
    if (!store.refreshProfile(this.sql, identity)) return { ok: false, error: 'not_member' }
    this.memberChanged(identity.id)
    return { ok: true, value: { sessionId: this.createSession(identity.id) } }
  }

  async getSession(sessionId: string): Promise<Member | null> {
    const githubId = this.sessionMemberId(sessionId)
    return githubId === null ? null : this.member(githubId)
  }

  async logout(sessionId: string): Promise<void> {
    store.deleteSession(this.sql, sessionId)
  }

  async getInvite(adminId: number): Promise<Result<string, 'forbidden'>> {
    if (!this.isAdmin(adminId)) return { ok: false, error: 'forbidden' }
    return { ok: true, value: store.getConfig(this.sql, 'invite_code') ?? '' }
  }

  // --- internals -----------------------------------------------------------

  protected sessionMemberId(sessionId: string): number | null {
    const row = store.getSessionRow(this.sql, sessionId)
    if (!row) return null
    if (row.expiresAt <= this.now()) {
      store.deleteSession(this.sql, sessionId)
      return null
    }
    return row.githubId
  }

  protected isAdmin(githubId: number): boolean {
    return store.getMember(this.sql, githubId)?.role === 'admin'
  }

  protected member(githubId: number): Member | null {
    const m = store.getMember(this.sql, githubId)
    return m ? this.withPresence(m) : null
  }

  protected withPresence(m: Member): Member {
    return { ...m, online: this.isOnline(m.githubId) }
  }

  /** Broadcasts the member's current state to every socket except `exclude`. */
  protected memberChanged(githubId: number, exclude?: WebSocket): void {
    const member = this.member(githubId)
    if (!member) return
    const msg: ServerMessage = { type: 'member_updated', member }
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude && ws.readyState === OPEN) this.send(ws, msg)
  }

  private createSession(githubId: number): string {
    const id = randomId(32)
    store.insertSession(this.sql, id, githubId, this.now(), SESSION_TTL_MS)
    return id
  }
}
