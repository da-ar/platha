# Platha Virtual Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Platha: an invite-only virtual office showing teammate presence, their open PRs and what needs your attention, with one-click Slack DMs and Google Meet knocks.

**Architecture:** One Cloudflare Worker serves the React SPA (Workers Static Assets) plus a small Hono API. One SQLite-backed Durable Object, `Office`, holds members, sessions, the invite code, presence and knock relay over hibernatable WebSockets. Each browser queries GitHub GraphQL directly with its own token; the server sees a token only once per join/login/setup, to call GitHub `GET /user`.

**Tech Stack:** TypeScript, React 19 + Vite, Hono, Cloudflare Workers + Durable Objects (SQLite, WebSocket Hibernation), zod, Vitest (`@cloudflare/vitest-pool-workers` for the worker, jsdom + React Testing Library for the web), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-platha-office-design.md`

## Global Constraints

- No GitHub OAuth app, Slack app or Google API. GitHub access only via user-pasted tokens.
- GitHub tokens are never stored server-side and never logged. Worker code must not put a token in a log line, error message or SQL row.
- Single org: every PR/issue search includes `org:<GITHUB_ORG>`.
- Presence: online while ≥1 socket open; offline 30 s after the last socket closes; client ping every 25 s; socket with no ping for 60 s is treated as closed. No idle detection.
- Status values exactly `available | focusing | away`; status text ≤ 80 chars.
- Meet URL must match `^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$` (after normalisation, see Task 1). Slack id must match `^[UW][A-Z0-9]{6,}$`.
- Session: 256-bit random id, 30-day expiry, cookie `platha_session=<id>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`.
- Invite code: 128-bit random, base64url. Failed join attempts rate-limited to 10 per IP per 10 minutes (`CF-Connecting-IP`).
- Knock: unanswered after 45 s (client timer on both sides).
- GitHub polling: every 60 s while `document.visibilityState === 'visible'`; immediate refresh on becoming visible; backoff on 403/429/5xx doubling from 60 s to max 600 s.
- WebSocket reconnect backoff: 1 s doubling to max 30 s.
- All GitHub-sourced text rendered as plain React text. No `dangerouslySetInnerHTML`, no markdown rendering, no third-party scripts.
- Copy strings fixed by the spec (use verbatim): "You need an invite link.", "Your GitHub token stopped working — paste a new one.", "Reconnecting…", "Couldn't load", "No answer — try Slack?", "<Name> just went offline", "<Name> hasn't added their Slack ID", "<Caller> is calling", "Join", "Not now", "You've been removed from this office.", "Updated <n>m ago", "Open Google Meet", "Open Slack in browser".

## Review Focus

1. **Meet link pasted with junk** (`?authuser=0`, trailing `/`, surrounding whitespace) should be accepted and normalised, not rejected. → Task 1 test `normalizeMeetUrl strips query, hash, slash and whitespace`.
2. **Token pasted with trailing newline/space** (common copying from GitHub's page) should work. → Task 3 test `join trims the pasted token`.
3. **A teammate renames their GitHub login** should update their existing member row (keyed by GitHub id), not create a duplicate or lock them out. → Task 2 test `addMember with known id updates login, name and avatar`.
4. **Admin removes someone who has two tabs open** — both tabs must get `session_revoked` and close; neither may keep them shown as online. → Task 5 test `removeMember revokes every socket of that member`.
5. **Clock skew between the browser and GitHub** must not hide or resurrect "new comments"/"mentions". Last-seen stores the item's own GitHub timestamp, never `Date.now()`. → Task 9 test `markSeen stores the item activity timestamp, not local time`.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, wrangler.jsonc
vitest.worker.config.ts, vitest.web.config.ts, playwright.config.ts
public/_headers                       # CSP + security headers for static assets
index.html
src/shared/
  types.ts                            # Member, Status, Role, Result
  validators.ts                       # normalizeMeetUrl, normalizeSlackUserId, STATUS_TEXT_MAX
  messages.ts                         # zod schemas: ClientMessage, ServerMessage + parse helpers
src/worker/
  index.ts                            # Worker entry: Hono app, routes, exports Office
  env.ts                              # Env interface
  github.ts                           # fetchGitHubUser
  cookies.ts                          # sessionCookie, clearSessionCookie, readSessionId
  crypto.ts                           # randomId, safeEqual
  office/Office.ts                    # Durable Object: RPC + WebSocket handlers + alarm
  office/store.ts                     # SQL schema + typed queries
src/web/
  main.tsx, App.tsx, styles.css
  api.ts                              # typed fetch wrappers for /api/*
  token.ts                            # localStorage GitHub token
  pages/Setup.tsx, Join.tsx, Login.tsx, NoInvite.tsx, Settings.tsx
  office/officeReducer.ts, useOffice.ts
  office/OfficeView.tsx, Tile.tsx, prPill.ts, NeedsYou.tsx, Drawer.tsx, StatusPicker.tsx, Banner.tsx
  github/types.ts, query.ts, parse.ts, attention.ts, seen.ts, useGitHub.ts
  call/slack.ts, CallModal.tsx, KnockToast.tsx, useKnocks.ts
test/worker/*.test.ts                 # vitest-pool-workers
test/web/**/*.test.ts(x)              # jsdom
test/fixtures/graphql-*.json
e2e/office.spec.ts, e2e/fake-github.ts
docs/SETUP.md
.github/workflows/deploy.yml
```

---

### Task 1: Project scaffold and shared contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `vitest.worker.config.ts`, `vitest.web.config.ts`, `index.html`, `public/_headers`, `src/shared/types.ts`, `src/shared/validators.ts`, `src/shared/messages.ts`, `src/worker/env.ts`, `src/worker/index.ts` (stub returning 404 for `/api/*`), `src/web/main.tsx` (renders "Platha")
- Modify: `.gitignore` (add `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `test-results/`, `playwright-report/`)
- Test: `test/web/shared/validators.test.ts`, `test/web/shared/messages.test.ts`

**Interfaces:**
- Produces:
  - `type Status = 'available' | 'focusing' | 'away'`; `type Role = 'admin' | 'member'`
  - `interface Member { githubId: number; login: string; name: string | null; avatarUrl: string; slackUserId: string | null; role: Role; status: Status; statusText: string | null; online: boolean }`
  - `type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E }`
  - `const STATUS_TEXT_MAX = 80`
  - `normalizeMeetUrl(input: string): string | null`, which trims, parses as URL, requires `https:` and host `meet.google.com`, drops query, hash and trailing `/`, then tests the regex. It returns the canonical `https://meet.google.com/abc-defg-hij` or null.
  - `normalizeSlackUserId(input: string): string | null`, which trims, uppercases, then tests the regex.
  - `ClientMessage` union: `{type:'set_status', status, text?}`, `{type:'knock', knockId, to, meetUrl}`, `{type:'knock_answer', knockId, to, answer:'join'|'decline'}`. `to` is the caller's githubId for an answer. `knockId` is a uuid.
  - `ServerMessage` union: `snapshot {members}`, `member_updated {member}`, `member_removed {githubId}`, `knock {knockId, from: number, meetUrl}`, `knock_answered {knockId, answer}`, `knock_failed {knockId, reason:'offline'}`, `session_revoked`.
  - `parseClientMessage(raw: string): ClientMessage | null` and `parseServerMessage(raw: string): ServerMessage | null`. Both return null on bad JSON or a schema miss. `parseClientMessage` runs `normalizeMeetUrl` on `knock.meetUrl` and rejects if null.
  - `interface Env { OFFICE: DurableObjectNamespace<Office>; ASSETS: Fetcher; GITHUB_ORG: string; SLACK_TEAM_ID: string; SETUP_SECRET: string; GITHUB_API_BASE: string }`

- [ ] **Step 1: Scaffold.** `npm init`, install `hono zod react react-dom` and dev deps `typescript vite @vitejs/plugin-react wrangler @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers jsdom @testing-library/react @testing-library/user-event @playwright/test`. Use the versions that `@cloudflare/vitest-pool-workers` peers with for `vitest`. Scripts:
  - `dev:web`: `vite`, proxying `/api` and `/ws` (ws: true) to `http://localhost:8787`
  - `dev:worker`: `wrangler dev`
  - `build`: `vite build` → `dist/client`
  - `test:worker`: `vitest run -c vitest.worker.config.ts`
  - `test:web`: `vitest run -c vitest.web.config.ts`
  - `test`: both
  - `e2e`: `playwright test`
  - `deploy`: `npm run build && wrangler deploy`
  - `typecheck`: `tsc --noEmit`

  `wrangler.jsonc`:
  - `main: src/worker/index.ts`, a current `compatibility_date`
  - `assets: { directory: "./dist/client", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/api/*", "/ws"] }`
  - `durable_objects.bindings: [{ name: "OFFICE", class_name: "Office" }]`, `migrations: [{ tag: "v1", new_sqlite_classes: ["Office"] }]`
  - `vars: { GITHUB_ORG: "", SLACK_TEAM_ID: "", GITHUB_API_BASE: "https://api.github.com" }`

  `public/_headers` for `/*`:
  - `Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.github.com; img-src 'self' https://avatars.githubusercontent.com; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`

  (`connect-src 'self'` covers same-origin `wss:` under CSP3.)
- [ ] **Step 2: Write failing tests.**

```ts
// validators.test.ts
expect(normalizeMeetUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
test('normalizeMeetUrl strips query, hash, slash and whitespace', () => {
  expect(normalizeMeetUrl('  https://meet.google.com/abc-defg-hij?authuser=0#x \n')).toBe('https://meet.google.com/abc-defg-hij')
  expect(normalizeMeetUrl('https://meet.google.com/abc-defg-hij/')).toBe('https://meet.google.com/abc-defg-hij')
})
expect(normalizeMeetUrl('http://meet.google.com/abc-defg-hij')).toBeNull()
expect(normalizeMeetUrl('https://meet.google.com.evil.io/abc-defg-hij')).toBeNull()
expect(normalizeMeetUrl('https://meet.google.com/lookup/abc')).toBeNull()
expect(normalizeMeetUrl('javascript:alert(1)')).toBeNull()
expect(normalizeSlackUserId(' u01abcdef ')).toBe('U01ABCDEF')
expect(normalizeSlackUserId('W0123456')).toBe('W0123456')
expect(normalizeSlackUserId('C0123456')).toBeNull()
expect(normalizeSlackUserId('U12')).toBeNull()

// messages.test.ts
expect(parseClientMessage('{"type":"set_status","status":"focusing"}')).toEqual({ type: 'set_status', status: 'focusing' })
expect(parseClientMessage(JSON.stringify({ type: 'set_status', status: 'away', text: 'x'.repeat(81) }))).toBeNull()
expect(parseClientMessage('{"type":"set_status","status":"busy"}')).toBeNull()
expect(parseClientMessage('not json')).toBeNull()
expect(parseClientMessage(JSON.stringify({ type: 'knock', knockId: crypto.randomUUID(), to: 2, meetUrl: 'https://meet.google.com/abc-defg-hij?authuser=1' }))?.meetUrl).toBe('https://meet.google.com/abc-defg-hij')
expect(parseClientMessage(JSON.stringify({ type: 'knock', knockId: 'k', to: 2, meetUrl: 'https://evil.io' }))).toBeNull()
expect(parseServerMessage('{"type":"session_revoked"}')).toEqual({ type: 'session_revoked' })
```

- [ ] **Step 3: Run `npm run test:web`.** Expected: FAIL (modules missing).
- [ ] **Step 4: Implement `src/shared/*`** and the stub worker/web entry points.
- [ ] **Step 5: Run `npm run test:web && npm run typecheck && npm run build`.** Expected: tests PASS, no type errors, `dist/client/index.html` exists.
- [ ] **Step 6: Commit** `feat: scaffold project and shared message contracts`.

---

### Task 2: Office store and membership RPC

**Files:**
- Create: `src/worker/crypto.ts`, `src/worker/office/store.ts`, `src/worker/office/Office.ts`
- Modify: `src/worker/index.ts` (add `export { Office }`)
- Test: `test/worker/office-membership.test.ts`

**Interfaces:**
- Consumes: `Member`, `Result`, `Env` (Task 1).
- Produces:
  - `randomId(bytes: number): string` (base64url) and `safeEqual(a: string, b: string): Promise<boolean>`, which is constant-time via `crypto.subtle.timingSafeEqual` and returns false on a length mismatch.
  - `interface GitHubIdentity { id: number; login: string; name: string | null; avatarUrl: string }`
  - `class Office extends DurableObject<Env>` with:
    - `now: () => number = Date.now`, which tests override via `runInDurableObject`
    - `setup(identity): Promise<Result<{ sessionId: string; inviteCode: string }, 'already_setup'>>`, which creates the admin member, invite code and session
    - `checkInvite(code: string, ip: string): Promise<Result<null, 'bad_invite' | 'rate_limited'>>`, which records a failure row on a bad code and returns `rate_limited` if ≥ 10 failures from that ip in the last 10 min (checked before comparing)
    - `addMember(identity): Promise<{ sessionId: string }>`, which upserts by GitHub id (refreshing login, name and avatar), keeps an existing role, defaults to `member`, and creates a session
    - `login(identity): Promise<Result<{ sessionId: string }, 'not_member'>>`, which refreshes the profile fields and creates a session
    - `getSession(sessionId: string): Promise<Member | null>`, which returns null when missing or expired and deletes it if expired
    - `logout(sessionId: string): Promise<void>`
    - `getInvite(adminId: number): Promise<Result<string, 'forbidden'>>`
  - `store.ts` creates the tables from spec §5:
    - `members`
    - `sessions`
    - `config` (`invite_code`)
    - `pending_offline(github_id INTEGER PK, due_at INTEGER)`
    - `join_failures(ip TEXT, at INTEGER)`

    It exposes typed functions taking `SqlStorage`. Columns map snake_case ↔ camelCase in one `rowToMember` function. `online` is not stored: `Office` fills it in (Task 4), so it's `false` here.

- [ ] **Step 1: Write failing tests** using `env.OFFICE.get(env.OFFICE.idFromName(crypto.randomUUID()))` so each test gets a fresh office.

```ts
const alice = { id: 1, login: 'alice', name: 'Alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' }
test('setup creates admin + invite + session, and only once', async () => {
  const r = await office.setup(alice); expect(r.ok).toBe(true)
  expect((await office.getSession(r.value.sessionId))?.role).toBe('admin')
  expect(r.value.inviteCode).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(await office.setup(bob)).toEqual({ ok: false, error: 'already_setup' })
})
test('checkInvite accepts the code and rejects others', ...)          // { ok:true } / { ok:false, error:'bad_invite' }
test('checkInvite rate-limits after 10 failures per ip in 10 minutes', ...) // 11th → 'rate_limited' even with the right code; other ip unaffected; after now()+10min+1 → allowed
test('addMember with known id updates login, name and avatar', ...) // addMember({...alice, login:'alice2'}) → still one admin row, login 'alice2', role 'admin'
test('login rejects unknown ids', ...)                          // { ok:false, error:'not_member' }
test('expired session returns null', ...)                       // now = created + 30d + 1
test('logout deletes the session', ...)
test('getInvite is admin-only', ...)                            // member → 'forbidden'
```

- [ ] **Step 2: Run `npm run test:worker`.** Expected: FAIL.
- [ ] **Step 3: Implement** `crypto.ts`, `store.ts` (schema created in the `Office` constructor inside `ctx.blockConcurrencyWhile`), and the `Office` RPC methods above.
- [ ] **Step 4: Run `npm run test:worker`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: office membership, sessions and invite`.

---

### Task 3: HTTP API routes

**Files:**
- Create: `src/worker/github.ts`, `src/worker/cookies.ts`
- Modify: `src/worker/index.ts`
- Test: `test/worker/api.test.ts`

**Interfaces:**
- Consumes: the Office RPC (Task 2).
- Produces:
  - `fetchGitHubUser(apiBase: string, token: string): Promise<Result<GitHubIdentity, 'bad_token' | 'github_error'>>`. It sends `GET {apiBase}/user` with headers `Authorization: Bearer <token>`, `User-Agent: platha` and `Accept: application/vnd.github+json`. A 401/403 returns `bad_token`, and any other non-2xx or a network error returns `github_error`.
  - `sessionCookie(id)`, `clearSessionCookie()`, `readSessionId(req): string | null` (cookie name `platha_session`).
  - Routes. All JSON. Mutating routes return 403 if the `Origin` header isn't the request origin. Tokens are `.trim()`'d before use.

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /api/setup` | `{secret, token}` | 200 `{inviteUrl}` + cookie | 403 bad secret (`safeEqual`), 401 bad_token, 409 already_setup, 502 github_error |
| `POST /api/join` | `{code, token}` | 200 `{}` + cookie | 404 bad_invite, 429 rate_limited, 401, 502 |
| `POST /api/login` | `{token}` | 200 `{}` + cookie | 403 not_member, 401, 502 |
| `POST /api/logout` | — | 204, clears cookie | — |
| `GET /api/me` | — | 200 `{member, config:{org, slackTeamId}}` | 401 |

  `inviteUrl` = `${origin}/join/${code}`. The office instance is always `idFromName('office')`. Helper `requireMember(c): Promise<Member | Response>` is used by every authenticated route in later tasks.

- [ ] **Step 1: Write failing tests** with `SELF.fetch`. Stub GitHub with `vi.spyOn(globalThis, 'fetch')`, passing non-GitHub URLs through to the original. Use `Origin: http://example.com` with request URL `http://example.com/...`.

```ts
test('setup with right secret creates admin and returns invite url', ...) // 200, body.inviteUrl matches /^http:\/\/example\.com\/join\/[\w-]{22}$/, Set-Cookie contains 'platha_session=' 'HttpOnly' 'Secure' 'SameSite=Strict'
test('setup with wrong secret is 403 and never calls GitHub', ...)
test('join trims the pasted token', ...)  // token 'tok-bob\n ' → GitHub called with 'Bearer tok-bob'
test('join with bad invite is 404', ...)
test('join with revoked GitHub token is 401', ...)
test('login works for existing member without invite', ...)
test('me returns member and config; 401 without cookie', ...)
test('mutating route with foreign Origin is 403', ...)
test('token never appears in responses or stored rows', ...) // after join, runInDurableObject: SELECT * from every table, JSON.stringify contains no 'tok-'
```

- [ ] **Step 2: Run `npm run test:worker`.** Expected: FAIL.
- [ ] **Step 3: Implement** `github.ts`, `cookies.ts` and the routes in `index.ts` with Hono. Non-`/api` and non-`/ws` paths fall through to `env.ASSETS.fetch(req)`.
- [ ] **Step 4: Run `npm run test:worker`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: setup, join, login and session API`.

---

### Task 4: Presence over WebSockets

**Files:**
- Modify: `src/worker/office/Office.ts`, `src/worker/index.ts`
- Test: `test/worker/presence.test.ts`

**Interfaces:**
- Consumes: `parseClientMessage`, `ServerMessage` (Task 1); `requireMember` (Task 3).
- Produces:
  - `GET /ws`: rejects with 403 for a bad Origin and 401 with no valid session. Otherwise it forwards to `office.fetch()` with the header `X-Platha-Member: <githubId>`, and the Worker strips any client-sent copy of that header.
  - `Office.fetch` accepts the socket with `ctx.acceptWebSocket(ws, [String(githubId)])`, `serializeAttachment({ githubId, connectedAt })` and `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`. It then sends `snapshot`. If this is the member's first socket and there's no `pending_offline` row, it broadcasts `member_updated` with online true. If there is a row, it deletes it without broadcasting.
  - `webSocketMessage` handles `set_status`, which persists and broadcasts `member_updated`. Invalid messages are ignored.
  - `webSocketClose` / `webSocketError`: if the member has no other open sockets, it inserts `pending_offline(due_at = now()+30_000)` and ensures an alarm.
  - `alarm()`:
    - For due `pending_offline` rows whose member still has no sockets, it deletes the row and broadcasts `member_updated` with online false.
    - It closes sockets (code 4408) whose `getWebSocketAutoResponseTimestamp(ws) ?? connectedAt` is more than 60 s old, then handles them as closes.
    - It reschedules for `now()+30_000` while any socket or pending row exists.
  - `isOnline(githubId) = sockets exist || pending_offline row exists`, used to fill `Member.online` everywhere, including `getSession`.

- [ ] **Step 1: Write failing tests.** Open sockets via `SELF.fetch('http://example.com/ws', { headers: { Upgrade: 'websocket', Origin, Cookie } })` then `res.webSocket.accept()`. Collect messages with a small `nextMessage(ws)` helper. Drive alarms with `runDurableObjectAlarm(stub)` and override `now` via `runInDurableObject`.

```ts
test('ws without session is 401; foreign origin is 403', ...)
test('connect sends snapshot including self online', ...)
test('second member sees first come online', ...)
test('closing one of two tabs keeps member online', ...) // no member_updated(online:false) after alarm at +31s
test('closing last tab: still online during grace, offline after 30s alarm', ...) // alarm at +29s → no change; +31s → member_updated online:false
test('reconnect within grace does not broadcast offline', ...)
test('stale socket with no ping for 60s is closed and goes offline after grace', ...)
test('set_status persists and broadcasts; survives reconnect', ...)
test('invalid client message is ignored and socket stays open', ...)
```

- [ ] **Step 2: Run `npm run test:worker`.** Expected: FAIL.
- [ ] **Step 3: Implement** the methods above with the hibernation API (`ctx.getWebSockets(tag)`). Keep no presence state in instance fields, because hibernation drops them.
- [ ] **Step 4: Run `npm run test:worker`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: websocket presence and status`.

---

### Task 5: Knocks, profile and admin actions

**Files:**
- Modify: `src/worker/office/Office.ts`, `src/worker/index.ts`
- Test: `test/worker/knock-admin.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `knock` from A to B: rejects silently if `to` is self or not a member. If B has no sockets, it sends `knock_failed {knockId, reason:'offline'}` to A's sockets. Otherwise it sends `knock {knockId, from: A, meetUrl}` to all of B's sockets. Nothing is persisted.
  - `knock_answer` from B: sends `knock_answered {knockId, answer}` to all sockets of `to`.
  - `Office.updateProfile(githubId, { slackUserId: string | null }): Promise<Result<Member, 'invalid_slack_id'>>`, which normalises with `normalizeSlackUserId` (null clears) and broadcasts `member_updated`.
  - `Office.removeMember(adminId, githubId): Promise<Result<null, 'forbidden' | 'not_found' | 'cannot_remove_self'>>`, which sends `session_revoked` to and closes (code 4403) every socket of that member, deletes their sessions, pending_offline row and member row, and broadcasts `member_removed`.
  - `Office.rotateInvite(adminId): Promise<Result<string, 'forbidden'>>`
  - Routes:
    - `PATCH /api/profile {slackUserId: string|null}` returns 200 `{member}` or 400.
    - `GET /api/admin/invite` returns `{inviteUrl}`.
    - `POST /api/admin/invite/rotate` returns `{inviteUrl}`.
    - `DELETE /api/admin/members/:githubId` returns 204, or 403/404/400.

- [ ] **Step 1: Write failing tests.**

```ts
test('knock relays to every socket of the callee with normalised meet url', ...)
test('knock to offline member returns knock_failed offline to caller', ...)
test('knock_answer reaches caller', ...)
test('knock to self or non-member is ignored', ...)
test('updateProfile normalises slack id and rejects channel ids', ...) // ' u01abcdef' → 'U01ABCDEF'; 'C123456' → 400
test('removeMember revokes every socket of that member', ...)  // two tabs: both receive session_revoked then close 4403; others receive member_removed; old cookie → 401
test('rotateInvite invalidates old code, existing members unaffected', ...)
test('admin routes are 403 for members', ...)
```

- [ ] **Step 2: Run `npm run test:worker`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:worker`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: knock relay, profile and admin actions`.

---

### Task 6: Web shell, auth pages and API client

**Files:**
- Create: `src/web/App.tsx`, `src/web/api.ts`, `src/web/token.ts`, `src/web/styles.css`, `src/web/pages/Setup.tsx`, `Join.tsx`, `Login.tsx`, `NoInvite.tsx`
- Modify: `src/web/main.tsx`
- Test: `test/web/pages/auth.test.tsx`

**Interfaces:**
- Consumes: the routes from Task 3.
- Produces:
  - `token.ts`: `getToken(): string | null`, `setToken(t: string)` (trims before storing), `clearToken()`. Storage key `platha.githubToken`. Every access is wrapped in try/catch.
  - `api.ts` returns `ApiResult<T> = { ok: true; data: T } | { ok: false; status: number }` from: `me()`, `setup(secret, token)`, `join(code, token)`, `login(token)`, `logout()`, `updateProfile(slackUserId)`, `getInvite()`, `rotateInvite()`, `removeMember(githubId)`.
  - `App` routing with no router library: a `location.pathname` switch.
    - `/setup` → Setup
    - `/join/:code` → Join
    - otherwise call `me()`. A 200 shows `<OfficeView>` (placeholder until Task 11). A 401 with a stored token shows Login. With no token, it shows Login with the text "You need an invite link." underneath.
  - Each page has a token field (`type=password`, label "GitHub token") and a "How do I make a token?" link to `docs/SETUP.md#token` on GitHub. On success it calls `setToken`, then `location.assign('/')`.
  - Error copy:
    - 404 → "That invite link isn't valid any more."
    - 429 → "Too many attempts — try again in 10 minutes."
    - 401 → "GitHub didn't accept that token."
    - 403 on login → "You need an invite link."
    - 502 → "Couldn't reach GitHub — try again."

- [ ] **Step 1: Write failing tests** (mock `fetch`):

```ts
test('join posts code and trimmed token, stores token, redirects', ...)
test('join shows invite error on 404', ...)
test('login shows "You need an invite link." on 403', ...)
test('app shows Login when /api/me is 401', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: web shell and auth pages`.

---

### Task 7: Live office state client

**Files:**
- Create: `src/web/office/officeReducer.ts`, `src/web/office/useOffice.ts`
- Test: `test/web/office/officeReducer.test.ts`, `test/web/office/useOffice.test.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `ClientMessage`, `Member` (Task 1).
- Produces:
  - `interface OfficeState { members: Record<number, Member>; connection: 'connecting' | 'open' | 'reconnecting' | 'removed' }`
  - `officeReducer(state: OfficeState, msg: ServerMessage): OfficeState`, which handles snapshot, member_updated, member_removed and session_revoked (→ `connection:'removed'`). Knock messages pass through unchanged, and Task 12 handles them.
  - `useOffice(): { state: OfficeState; send: (m: ClientMessage) => void; subscribe: (fn: (m: ServerMessage) => void) => () => void }`
    - It connects to `${location.origin.replace('http','ws')}/ws` and sends the string `ping` every 25 s.
    - It reconnects at 1 s doubling to 30 s, resetting after a successful `open`.
    - It stops reconnecting on `session_revoked` or close code 4403. If a socket closes without ever reaching `open`, it calls `me()`. A 401 routes to Login, and anything else keeps the backoff.
    - It ignores `pong`.

- [ ] **Step 1: Write failing tests.** Reducer tests cover each message. Hook tests use a fake `WebSocket` class on `globalThis` and `vi.useFakeTimers()`:

```ts
test('pings every 25s', ...)
test('reconnects with 1s,2s,4s… capped at 30s backoff', ...)
test('session_revoked sets removed and stops reconnecting', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: live office state over websocket`.

---

### Task 8: GitHub query and parsing

**Files:**
- Create: `src/web/github/types.ts`, `src/web/github/query.ts`, `src/web/github/parse.ts`, `test/fixtures/graphql-full.json`, `test/fixtures/graphql-partial-error.json`
- Test: `test/web/github/query.test.ts`, `test/web/github/parse.test.ts`

**Interfaces:**
- Produces:
  - `type CiState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null`
  - `interface PullRequest { url: string; number: number; title: string; repo: string; author: string; isDraft: boolean; reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null; mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'; ci: CiState; updatedAt: string; lastActivity: { author: string; at: string } | null }`
    - `lastActivity` is the newer of `comments(last:1)` and `reviews(last:1)`.
  - `interface Mention { url: string; number: number; title: string; repo: string; updatedAt: string }`
  - `interface GitHubSnapshot { reviewRequested: PullRequest[]; mine: PullRequest[]; mentions: Mention[]; byTeammate: Record<string, PullRequest[] | 'error'> }`
  - `buildQuery(org: string, teammates: string[], now: Date): string`, a single GraphQL document with aliased `search(type: ISSUE, first: 50, query: …)`:
    - `reviewRequested`: `is:pr is:open review-requested:@me org:ORG`
    - `mine`: `is:pr is:open author:@me org:ORG`
    - `mentions`: `is:open mentions:@me org:ORG updated:>=YYYY-MM-DD` (now − 14 days)
    - `t0…tN`: `is:pr is:open author:<login> org:ORG` in teammate order

    It uses one shared `fragment PR on PullRequest`. Logins are validated against `^[A-Za-z0-9-]{1,39}$` and invalid ones are skipped.
  - `parseSnapshot(json: unknown, teammates: string[]): GitHubSnapshot`, which maps the `tN` alias back to the login. A teammate whose alias is null or appears in `errors[].path[0]` becomes `'error'`.
  - `fetchSnapshot(token: string, org: string, teammates: string[]): Promise<{ status: number; snapshot?: GitHubSnapshot }>` posts to `https://api.github.com/graphql`.

- [ ] **Step 1: Write failing tests.**

```ts
test('query scopes every search to the org and aliases teammates in order', ...) // contains 'org:acme' 5 times for 2 teammates; 't1: search' with 'author:bob'
test('mentions limited to last 14 days', ...)        // now 2026-10-08 → 'updated:>=2026-09-24'
test('invalid login is skipped', ...)
test('parse maps fields and lastActivity picks newer of comment/review', ...)
test('parse marks a teammate with a path error as "error" and keeps the others', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: github graphql query and parsing`.

---

### Task 9: Attention rules and last-seen

**Files:**
- Create: `src/web/github/attention.ts`, `src/web/github/seen.ts`
- Test: `test/web/github/attention.test.ts`, `test/web/github/seen.test.ts`

**Interfaces:**
- Consumes: `GitHubSnapshot`, `PullRequest`, `Mention` (Task 8).
- Produces:
  - `type AttentionKind = 'review_requested' | 'changes_or_comments' | 'ready_to_merge' | 'mentioned' | 'ci_failing'`
  - `interface AttentionItem { kind: AttentionKind; url: string; number: number; title: string; repo: string; activityAt: string }`
  - `interface SeenState { firstRunAt: string; seen: Record<string, string> }`
  - `computeAttention(s: GitHubSnapshot, me: string, seen: SeenState): AttentionItem[]`. It produces **one item per URL**, taking the first matching rule in the order e, f, g, h, i from spec §6. Items are sorted by that order, then by `activityAt` descending. "Unseen" means the activity timestamp is later than `seen[url] ?? firstRunAt`.
    - `changes_or_comments`: `reviewDecision==='CHANGES_REQUESTED'`, or `lastActivity.author !== me` and unseen. `activityAt` is `lastActivity.at`, falling back to `updatedAt`.
    - `ready_to_merge`: `!isDraft && reviewDecision==='APPROVED' && (ci==='SUCCESS' || ci===null) && mergeable!=='CONFLICTING'`
    - `mentioned`: `updatedAt` unseen
    - `ci_failing`: `ci==='FAILURE' || ci==='ERROR'`
  - `seen.ts`:
    - `loadSeen(): SeenState`, which sets `firstRunAt` to the current ISO time on first run and persists it
    - `markSeen(state, item: AttentionItem): SeenState`, which stores `item.activityAt` and persists to the `platha.seen` key
    - entries older than 60 days are pruned on load

- [ ] **Step 1: Write failing tests.**

```ts
test('e: review requested appears', ...)
test('f: changes requested appears even when seen', ...)
test('f: new comment by someone else appears until seen; own comment never does', ...)
test('f: activity before firstRunAt is treated as seen', ...)
test('g: approved+green+mergeable appears; draft, conflicting or pending CI do not', ...)
test('h: mention appears until seen, reappears when updated later', ...)
test('i: failing CI appears', ...)
test('one item per url, highest-priority rule wins (f beats i)', ...)
test('markSeen stores the item activity timestamp, not local time', ...) // vi.setSystemTime(2020-01-01); markSeen(item with activityAt '2026-10-08T10:00:00Z') → seen[url]==='2026-10-08T10:00:00Z' and item no longer unseen
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: needs-you attention rules`.

---

### Task 10: GitHub polling hook

**Files:**
- Create: `src/web/github/useGitHub.ts`
- Test: `test/web/github/useGitHub.test.ts`

**Interfaces:**
- Consumes: `fetchSnapshot` (Task 8), `getToken` (Task 6).
- Produces: `useGitHub(args: { org: string; teammates: string[] }): { snapshot: GitHubSnapshot | null; status: 'loading' | 'ok' | 'unauthorized' | 'error'; updatedAt: number | null; refresh: () => void }`
  - It polls every 60 s while visible, pauses when hidden, and fetches immediately on `visibilitychange` to visible.
  - A 401 sets `unauthorized` and stops polling until `refresh()` is called after a new token.
  - A 403/429/5xx/network error keeps the previous snapshot, sets `error`, and backs off at 120, 240, 480 then 600 s max. The backoff resets on success.
  - A change to `teammates` (joined by comma) triggers an immediate refetch.

- [ ] **Step 1: Write failing tests** (fake timers, mocked `fetchSnapshot`, stubbed `document.visibilityState`):

```ts
test('polls every 60s while visible and not while hidden', ...)
test('refreshes immediately when tab becomes visible', ...)
test('401 → unauthorized and polling stops', ...)
test('429 keeps last snapshot and backs off 120s then 240s', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: github polling with visibility and backoff`.

---

### Task 11: Office view: tiles, needs-you panel, status, banners

**Files:**
- Create: `src/web/office/OfficeView.tsx`, `Tile.tsx`, `prPill.ts`, `NeedsYou.tsx`, `StatusPicker.tsx`, `Banner.tsx`
- Modify: `src/web/App.tsx`, `src/web/styles.css`
- Test: `test/web/office/prPill.test.ts`, `test/web/office/Tile.test.tsx`, `test/web/office/OfficeView.test.tsx`

**Interfaces:**
- Consumes: `useOffice` (Task 7), `useGitHub` (Task 10), `computeAttention`/`loadSeen`/`markSeen` (Task 9), `me()` (Task 6).
- Produces:
  - `prPill(pr: PullRequest): string`. Labels in priority order: draft → `#n draft`; ci FAILURE/ERROR → `#n ❌`; CHANGES_REQUESTED → `#n changes req`; APPROVED → `#n ready`; else `#n in review`.
  - `<Tile member prs={PullRequest[] | 'error' | undefined} onOpen={() => void} />`
    - It shows the avatar, name (or login), status per the spec §5 visual-state table, and up to 3 pills then `+N more`.
    - With `'error'` it shows "Couldn't load".
    - It has class `tile--offline` when `!online`, and the CSS greyscales the avatar to 40 % opacity.
    - It's a `<button>` with accessible name `"<name>, <Online|Focusing|Away|Offline>"`.
  - `<OfficeView me config />`:
    - It renders a header with `StatusPicker` (sends `set_status`), a settings link and "Reconnecting…" when `connection==='reconnecting'`.
    - It renders a tile grid ordered with online members first, then by display name. My own tile uses `snapshot.mine`.
    - It renders the `NeedsYou` panel ("Needs you · N" plus a row per item with an icon and kind label). Clicking a row opens the URL in a new tab and calls `markSeen`.
    - It renders "Updated <n>m ago" when `status==='error'`, and the 401 banner "Your GitHub token stopped working — paste a new one." with an inline token field that calls `setToken` then `refresh()`.
    - It renders "You've been removed from this office." when `connection==='removed'`.
    - The layout is two columns at ≥ 900 px and stacks below that.

- [ ] **Step 1: Write failing tests.**

```ts
test('prPill priority', ...)  // draft+failing → '#5 draft'; failing+approved → '#5 ❌'
test('tile shows 3 pills then +2 more', ...)
test('offline tile is greyed and labelled Offline; focusing shows Focusing', ...)
test('tile with error shows Couldn\'t load', ...)
test('office orders online before offline', ...)
test('clicking a needs-you row marks it seen and removes it on next render', ...)
test('unauthorized shows token banner', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the option-B mockup in `.superpowers/brainstorm/*/content/office-layout.html`: tile grid on the left, Needs-you panel on the right.
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: office tiles and needs-you panel`.

---

### Task 12: Teammate drawer, Slack chat and Meet knocks

**Files:**
- Create: `src/web/office/Drawer.tsx`, `src/web/call/slack.ts`, `src/web/call/CallModal.tsx`, `src/web/call/KnockToast.tsx`, `src/web/call/useKnocks.ts`
- Modify: `src/web/office/OfficeView.tsx`
- Test: `test/web/call/slack.test.ts`, `test/web/call/useKnocks.test.ts`, `test/web/call/CallModal.test.tsx`, `test/web/office/Drawer.test.tsx`

**Interfaces:**
- Consumes: `useOffice().send/subscribe` (Task 7), `normalizeMeetUrl` (Task 1), `config.slackTeamId` from `/api/me`.
- Produces:
  - `slackDmUrl(teamId: string, userId: string): string` → `slack://user?team=<teamId>&id=<userId>`, and `slackWebUrl(teamId)` → `https://app.slack.com/client/<teamId>`.
  - `<Drawer member prs onClose />` lists every open PR (title, repo, draft/ready, review state, CI state, link) and has two buttons:
    - **Chat**, disabled with the title "<Name> hasn't added their Slack ID" when `slackUserId` is null, plus an "Open Slack in browser" link.
    - **Call**, disabled when offline.
  - `useKnocks(office)` returns `{ outgoing: Outgoing | null; incoming: Incoming[]; call(member: Member, meetUrl: string): void; answer(k: Incoming, a: 'join'|'decline'): void; dismissOutgoing(): void }`, where `Outgoing = { knockId; to: Member; state: 'ringing' | 'joined' | 'declined' | 'no_answer' | 'went_offline' }`.
    - The knock id is `crypto.randomUUID()`.
    - After 45 s ringing the state becomes `no_answer`.
    - If `member_updated` sets the callee offline while ringing, the state becomes `went_offline`, and `knock_failed` does the same.
    - An incoming knock auto-dismisses after 45 s.
    - `answer('join')` calls `window.open(meetUrl, '_blank', 'noopener')`.
  - `<CallModal member onSubmit onCancel />`:
    - On open it runs `const w = window.open('https://meet.new', '_blank')`. If that's null it shows an "Open Google Meet" link; otherwise it sets `w.opener = null`.
    - It has a paste field validated with `normalizeMeetUrl`, showing "That doesn't look like a Meet link" when invalid.
    - Outgoing status copy:
      - ringing: "Calling <Name>…"
      - declined: "<Name> can't talk right now"
      - no_answer: "No answer — try Slack?"
      - went_offline: "<Name> just went offline"
  - `<KnockToast>` reads "<Caller> is calling" and has **Join** and **Not now** buttons.

- [ ] **Step 1: Write failing tests.**

```ts
test('slackDmUrl builds deep link', ...)
test('chat disabled with tooltip when no slack id', ...)
test('call modal shows fallback link when popup blocked', ...)
test('call modal rejects non-meet links and accepts ?authuser=0', ...)
test('outgoing knock times out after 45s → no_answer', ...)
test('callee going offline while ringing → went_offline', ...)
test('incoming join sends knock_answer and opens meet url', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: teammate drawer, slack chat and meet knocks`.

---

### Task 13: Settings and admin UI

**Files:**
- Create: `src/web/pages/Settings.tsx`
- Modify: `src/web/App.tsx` (route `/settings`)
- Test: `test/web/pages/Settings.test.tsx`

**Interfaces:**
- Consumes: `updateProfile`, `getInvite`, `rotateInvite`, `removeMember`, `logout`, `clearToken` (Task 6); `useOffice().state.members` (Task 7).
- Produces: the Settings page.
  - Slack member ID field with the help text "Slack → your profile → ⋮ → Copy member ID", a Save button and inline validation from the 400 response.
  - "Replace GitHub token" field.
  - "Sign out" (calls `logout` + `clearToken`).
  - Admin only:
    - the invite link with a Copy button
    - "Rotate link", which shows a `confirm()` warning that the old link stops working
    - a members list with a Remove button per member except self, behind a `confirm()`

- [ ] **Step 1: Write failing tests.**

```ts
test('saving a slack id calls updateProfile and shows saved', ...)
test('invalid slack id shows error from 400', ...)
test('admin section hidden for members', ...)
test('rotate asks for confirmation and shows the new link', ...)
test('remove asks for confirmation and calls removeMember', ...)
```

- [ ] **Step 2: Run `npm run test:web`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run test:web`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: settings and admin page`.

---

### Task 14: End-to-end test, setup guide and deploy

**Files:**
- Create: `e2e/fake-github.ts`, `e2e/office.spec.ts`, `playwright.config.ts`, `docs/SETUP.md`, `.github/workflows/deploy.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything.
- Produces:
  - `e2e/fake-github.ts`: a Node `http` server on port 8790 serving `GET /user`. It maps the bearer token `alice-token` → `{id:1, login:'alice'}` and `bob-token` → `{id:2, login:'bob'}`, and anything else → 401.
  - `playwright.config.ts` runs two `webServer` entries:
    - `node --experimental-strip-types e2e/fake-github.ts`
    - `npm run build && wrangler dev --port 8787 --var GITHUB_API_BASE:http://localhost:8790 --var SETUP_SECRET:e2e-secret --var GITHUB_ORG:acme --var SLACK_TEAM_ID:T0000000`

    The base URL is `http://localhost:8787`. Each page routes `https://api.github.com/graphql` to `test/fixtures/graphql-full.json`.
  - `docs/SETUP.md` has these sections:
    1. Prerequisites (Node 20+, a free Cloudflare account)
    2. `npx wrangler login`
    3. Set `GITHUB_ORG` / `SLACK_TEAM_ID` in `wrangler.jsonc`, and how to find the Slack team id
    4. `npx wrangler secret put SETUP_SECRET`
    5. `npm run deploy`
    6. Visit `/setup`, then share the invite link
    7. `#token`: create a fine-grained read-only token (resource owner = org; Pull requests, Issues, Commit statuses, Metadata: read). If it shows "pending approval", use a classic token with `repo` scope instead, and **this grants write access, so keep it private**. For SAML orgs, authorise the token for SSO.
    8. Finding your Slack member ID
    9. Local development (`npm run dev:worker` + `npm run dev:web`, `.dev.vars` with `SETUP_SECRET`)
    10. Optional auto-deploy
  - `.github/workflows/deploy.yml`: on push to `main`, it runs `npm ci`, `npm test`, then `npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. The deploy step is skipped when `CLOUDFLARE_API_TOKEN` is empty, by exposing it as a job `env` and gating with `if: env.CLOUDFLARE_API_TOKEN != ''`.

- [ ] **Step 1: Write the failing e2e test** `two teammates see each other and can knock`:
  1. Alice runs setup with `e2e-secret` / `alice-token` and reads the invite URL.
  2. Bob, in a second context, joins with that URL and `bob-token`.
  3. Each sees the other's tile as Online.
  4. Alice clicks Bob → Call. Popups are blocked in the test, so she pastes `https://meet.google.com/abc-defg-hij`.
  5. Bob sees "alice is calling" and clicks Not now.
  6. Alice sees "bob can't talk right now".
  7. Bob closes his page, and after at most 40 s Alice sees Bob's tile labelled Offline.
- [ ] **Step 2: Run `npx playwright install chromium && npm run e2e`.** Expected: FAIL until wiring issues are fixed. Fix any integration bugs it reveals, in the task that owns the code.
- [ ] **Step 3: Write `docs/SETUP.md`, the workflow and README links.**
- [ ] **Step 4: Run the full verification:** `npm run typecheck && npm test && npm run e2e`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: e2e test, setup guide and deploy workflow`.
