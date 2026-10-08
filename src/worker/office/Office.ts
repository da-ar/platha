import { DurableObject } from 'cloudflare:workers'
import type { Member, Result } from '../../shared/types'
import { randomId, safeEqual } from '../crypto'
import type { Env } from '../env'
import type { GitHubIdentity } from '../github'
import * as store from './store'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const JOIN_FAILURE_WINDOW_MS = 10 * 60 * 1000
const JOIN_FAILURE_LIMIT = 10

export class Office extends DurableObject<Env> {
  /** Overridable clock, for tests. */
  now: () => number = Date.now

  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    void ctx.blockConcurrencyWhile(async () => store.migrate(this.sql))
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
    store.recordJoinFailure(this.sql, ip, now, since)
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
    return m
  }

  /** Hook for broadcasting profile changes; presence is added in a later step. */
  protected memberChanged(_githubId: number): void {}

  private createSession(githubId: number): string {
    const id = randomId(32)
    store.insertSession(this.sql, id, githubId, this.now(), SESSION_TTL_MS)
    return id
  }
}
