import type { Member, Role, Status } from '../../shared/types'
import type { GitHubIdentity } from '../github'

export function migrate(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS members (
      github_id INTEGER PRIMARY KEY,
      login TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT NOT NULL,
      slack_user_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'focusing', 'away')),
      status_text TEXT,
      joined_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      github_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_by_member ON sessions (github_id);
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_offline (github_id INTEGER PRIMARY KEY, due_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS join_failures (ip TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS join_failures_by_ip ON join_failures (ip, at);
  `)
}

type MemberRow = {
  github_id: number
  login: string
  name: string | null
  avatar_url: string
  slack_user_id: string | null
  role: Role
  status: Status
  status_text: string | null
}

/** `online` is not stored; the Office fills it in from its open sockets. */
export function rowToMember(row: MemberRow): Member {
  return {
    githubId: row.github_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
    slackUserId: row.slack_user_id,
    role: row.role,
    status: row.status,
    statusText: row.status_text,
    online: false,
  }
}

export function getMember(sql: SqlStorage, githubId: number): Member | null {
  const row = sql.exec<MemberRow>('SELECT * FROM members WHERE github_id = ?', githubId).toArray()[0]
  return row ? rowToMember(row) : null
}

export function listMembers(sql: SqlStorage): Member[] {
  return sql.exec<MemberRow>('SELECT * FROM members ORDER BY github_id').toArray().map(rowToMember)
}

export function hasAdmin(sql: SqlStorage): boolean {
  return sql.exec("SELECT 1 FROM members WHERE role = 'admin' LIMIT 1").toArray().length > 0
}

/** Inserts the member, or refreshes login/name/avatar if the GitHub id is known. An existing role is kept. */
export function upsertMember(sql: SqlStorage, identity: GitHubIdentity, role: Role, now: number): void {
  sql.exec(
    `INSERT INTO members (github_id, login, name, avatar_url, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
    identity.id,
    identity.login,
    identity.name,
    identity.avatarUrl,
    role,
    now,
  )
}

export function refreshProfile(sql: SqlStorage, identity: GitHubIdentity): boolean {
  const cursor = sql.exec(
    'UPDATE members SET login = ?, name = ?, avatar_url = ? WHERE github_id = ?',
    identity.login,
    identity.name,
    identity.avatarUrl,
    identity.id,
  )
  return cursor.rowsWritten > 0
}

export function setStatus(sql: SqlStorage, githubId: number, status: Status, text: string | null): void {
  sql.exec('UPDATE members SET status = ?, status_text = ? WHERE github_id = ?', status, text, githubId)
}

export function setSlackUserId(sql: SqlStorage, githubId: number, slackUserId: string | null): void {
  sql.exec('UPDATE members SET slack_user_id = ? WHERE github_id = ?', slackUserId, githubId)
}

export function deleteMember(sql: SqlStorage, githubId: number): void {
  sql.exec('DELETE FROM sessions WHERE github_id = ?', githubId)
  sql.exec('DELETE FROM pending_offline WHERE github_id = ?', githubId)
  sql.exec('DELETE FROM members WHERE github_id = ?', githubId)
}

export function insertSession(sql: SqlStorage, id: string, githubId: number, now: number, ttlMs: number): void {
  sql.exec('INSERT INTO sessions (id, github_id, created_at, expires_at) VALUES (?, ?, ?, ?)', id, githubId, now, now + ttlMs)
}

export function getSessionRow(sql: SqlStorage, id: string): { githubId: number; expiresAt: number } | null {
  const row = sql
    .exec<{ github_id: number; expires_at: number }>('SELECT github_id, expires_at FROM sessions WHERE id = ?', id)
    .toArray()[0]
  return row ? { githubId: row.github_id, expiresAt: row.expires_at } : null
}

export function deleteSession(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM sessions WHERE id = ?', id)
}

export function getConfig(sql: SqlStorage, key: string): string | null {
  const row = sql.exec<{ value: string }>('SELECT value FROM config WHERE key = ?', key).toArray()[0]
  return row ? row.value : null
}

export function setConfig(sql: SqlStorage, key: string, value: string): void {
  sql.exec('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
}

export function countJoinFailures(sql: SqlStorage, ip: string, since: number): number {
  return sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM join_failures WHERE ip = ? AND at > ?', ip, since).one().n
}

export function recordJoinFailure(sql: SqlStorage, ip: string, now: number, pruneBefore: number): void {
  sql.exec('DELETE FROM join_failures WHERE at <= ?', pruneBefore)
  sql.exec('INSERT INTO join_failures (ip, at) VALUES (?, ?)', ip, now)
}

export function getPendingOffline(sql: SqlStorage, githubId: number): number | null {
  const row = sql.exec<{ due_at: number }>('SELECT due_at FROM pending_offline WHERE github_id = ?', githubId).toArray()[0]
  return row ? row.due_at : null
}

export function setPendingOffline(sql: SqlStorage, githubId: number, dueAt: number): void {
  sql.exec(
    'INSERT INTO pending_offline (github_id, due_at) VALUES (?, ?) ON CONFLICT (github_id) DO UPDATE SET due_at = excluded.due_at',
    githubId,
    dueAt,
  )
}

export function clearPendingOffline(sql: SqlStorage, githubId: number): void {
  sql.exec('DELETE FROM pending_offline WHERE github_id = ?', githubId)
}

export function listPendingOffline(sql: SqlStorage): { githubId: number; dueAt: number }[] {
  return sql
    .exec<{ github_id: number; due_at: number }>('SELECT github_id, due_at FROM pending_offline')
    .toArray()
    .map((r) => ({ githubId: r.github_id, dueAt: r.due_at }))
}
