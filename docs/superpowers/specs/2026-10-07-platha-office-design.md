# Platha — Virtual Office Design

**Date:** 2026-10-07
**Status:** Draft for review

## 1. Purpose

A small team of 6 (soon 11) works remotely. Two problems:

1. **Context-switching** — GitHub, Slack and Google Meet are separate; PRs that need review or attention get missed.
2. **Isolation** — it's hard to tell who is actually around and what they're working on.

Platha is a web app that feels like a small office: you see teammates (greyed out when not around), what each has in flight on GitHub, what needs *your* attention, and you can start a Slack chat or a Google Meet call with one click.

### Success criteria

- Opening Platha answers "who's around?" and "what needs me?" at a glance.
- Clicking a teammate shows their open PRs and lets you chat or call them.
- Presence reflects availability, not activity monitoring — no idle tracking.
- Works with **no elevated permissions**: no GitHub org app approval, no Slack app, no Google Workspace API access.
- Costs $0 to run at 11 people and needs no server maintenance.

### Constraints (from the user)

- No elevated permissions in GitHub, Slack or Google.
- Private, invite-only: having the invite link is what gets you in.
- One GitHub organisation.
- Chat stays in Slack; calls stay in Google Meet.

## 2. Scope

### In v1

- Invite link + GitHub identity join flow; admin can remove members and rotate the link.
- Office view: team tiles (avatar, name, status, open PR pills).
- "Needs you" panel (see §6).
- Presence (online while app open, 30 s grace) + manual status.
- Teammate drawer: their open PRs, Chat and Call buttons.
- Slack DM deep links.
- Call via knock + meet.new.
- Responsive layout (usable in a mobile browser).

### Out of scope

In-app chat or calls, end-to-end encryption, idle detection, issues/branches/reviews-in-progress in the teammate view, multiple orgs, notifications when the tab is closed, native mobile apps, GitHub webhooks.

## 3. Architecture

A single Cloudflare Worker serves the static frontend (Workers Static Assets) and a small API. One Durable Object, `Office`, holds all team state. GitHub is queried **directly from each browser** using that person's own token; the server never stores GitHub tokens.

```
 Browser (React SPA)                          Cloudflare Worker                     GitHub
 ┌────────────────────────────┐  WebSocket   ┌──────────────────────────────┐
 │ Office view (tiles)        │◄────────────►│ Office Durable Object        │
 │ Needs-you panel            │  presence,   │  members, sessions, invite   │
 │ Teammate drawer            │  status,     │  presence, status, knocks    │
 │ Knock toast / call modal   │  knocks      │  (SQLite storage)            │
 │                            │  HTTPS       ├──────────────────────────────┤   once at   ┌───────┐
 │ GitHub client ─────────────┼─────────────►│ API routes (/api/*)          ├───join────►│ /user │
 │  (token in localStorage)   │              │  join, me, profile, admin    │            └───────┘
 └─────────────┬──────────────┘              └──────────────────────────────┘
               └──── GraphQL every 60 s while tab visible ─────────────────────────────► api.github.com
```

### Stack

- **Language:** TypeScript throughout.
- **Frontend:** React + Vite.
- **Backend:** Cloudflare Worker (Hono for routing) + one SQLite-backed Durable Object using the WebSocket Hibernation API.
- **Tests:** Vitest, `@cloudflare/vitest-pool-workers`, React Testing Library, Playwright.
- **Hosting:** Cloudflare free plan, deployed with `wrangler deploy`.

### Repository layout

```
src/
  shared/      # types + WebSocket message schema shared by client and server
  worker/      # Worker entry, API routes, Office Durable Object
  web/         # React app
    github/    # GitHub client + attention rules (pure functions)
    office/    # tiles, drawer, needs-you panel
    call/      # knock toast, call modal
docs/
  SETUP.md     # deployment + token guide
```

### Configuration

| Name | Kind | Purpose |
|---|---|---|
| `GITHUB_ORG` | var | The org PR searches are limited to |
| `SLACK_TEAM_ID` | var | Slack workspace ID (`T…`) for deep links |
| `SETUP_SECRET` | secret | One-time admin bootstrap code |

## 4. Identity, invites and admin

### Bootstrap

1. The deployer sets `SETUP_SECRET` (`wrangler secret put SETUP_SECRET`).
2. Visiting `/setup`, they enter the secret and their GitHub token. The server verifies the token via GitHub `GET /user`, creates them as the **admin** member, creates the invite code, and shows the invite link. `/setup` is disabled once an admin exists.

### Joining

1. A teammate opens `/join/<invite-code>`.
2. They paste a GitHub token (guided by an inline how-to).
3. The browser sends the invite code + token to `POST /api/join`. The server:
   - checks the invite code (constant-time compare against the stored code; rate-limited to 10 failed attempts per IP per 10 minutes),
   - calls GitHub `GET /user` once with the token,
   - upserts the member (GitHub id, login, name, avatar URL),
   - creates a session and sets the cookie,
   - **discards the token** (never logged, never stored).
4. The browser stores the token in `localStorage` for its own GitHub queries.

### Signing in again

An existing member on a new browser (or after their session expires) opens the app, pastes their token, and `POST /api/login` verifies it via GitHub `GET /user`. If that GitHub id is a current member, a new session is created; no invite link is needed. Unknown ids get "You need an invite link."

Anyone with a valid invite link and any GitHub account can join (org membership is deliberately **not** checked, to avoid needing the `read:org` scope). Someone who joins with a leaked link sees names, avatars and statuses, but no PR data beyond what their own token can already read.

Without a valid session or invite code, every page shows only "You need an invite link."

### Sessions

- Random 256-bit session ID, stored in the Office DO with a 30-day expiry.
- Cookie: `Secure; HttpOnly; SameSite=Strict; Path=/`.
- WebSocket upgrade requires a valid session cookie and an `Origin` matching the app's origin.

### Admin actions

- **Remove member:** deletes their sessions, closes their sockets, removes them from the team. They can rejoin only with a current invite link.
- **Rotate invite link:** replaces the invite code; existing members are unaffected.

## 5. Presence, status and profiles

### Presence

- A member is **online** while they have ≥1 open WebSocket (any tab).
- When their last socket closes, they become **offline** after a **30-second grace period** (so reloads don't flicker). The DO uses an alarm to apply the transition.
- Clients send a ping every 25 s; the DO treats a socket with no ping for 60 s as closed.
- There is **no idle detection** and no activity data of any kind is collected.

### Manual status

`available` (default) | `focusing` | `away`, plus optional free text (≤ 80 chars). Persisted per member and kept across sessions.

### Visual states

| State | Avatar | Indicator |
|---|---|---|
| Online, available | Full colour | Green dot |
| Online, focusing | Full colour | Amber dot + "Focusing" |
| Online, away | Full colour | Grey dot + "Away" |
| Offline | Greyscale, 40 % opacity, tile dimmed | "Offline" |

### Profile

Each member can set their **Slack member ID** (`^[UW][A-Z0-9]{6,}$`) in settings. Name and avatar come from GitHub and refresh on each join/login.

### Data model (Office DO SQLite)

```
members(github_id INTEGER PK, login TEXT, name TEXT, avatar_url TEXT,
        slack_user_id TEXT NULL, role TEXT CHECK(role IN ('admin','member')),
        status TEXT, status_text TEXT, joined_at INTEGER)
sessions(id TEXT PK, github_id INTEGER, created_at INTEGER, expires_at INTEGER)
config(key TEXT PK, value TEXT)   -- invite_code
```

Online/offline state is held in memory (derived from open sockets) and is not persisted.

### WebSocket messages (`src/shared`)

Server → client:
- `snapshot { members: Member[] }`: full team state on connect.
- `member_updated { member: Member }`: presence, status or profile change.
- `member_removed { githubId }`
- `knock { knockId, from, meetUrl }`
- `knock_answered { knockId, answer: 'join' | 'decline' }`
- `knock_failed { knockId, reason: 'offline' }` (the 45 s timeout runs in the caller's client)
- `session_revoked`

Client → server:
- `ping`
- `set_status { status, text? }`
- `knock { knockId, to, meetUrl }` (`knockId` is a client-generated UUID)
- `knock_answer { knockId, to, answer }` (`to` is the caller)

All incoming messages are validated against the schema; invalid messages are dropped.

## 6. GitHub integration

### Token

The setup guide asks for a **fine-grained, read-only** token scoped to the org (Pull requests, Issues, Commit statuses, Metadata — all read). If the org requires admin approval for fine-grained tokens, the fallback is a **classic** token with `repo` scope, which works without approval but **includes write access**. The guide states this trade-off plainly.

### Polling

- One small GraphQL request per `search` (up to 30 results each), at most 4 in flight, each retried once on a gateway error or timeout. A single combined query timed out on GitHub (502) for a real team. The searches are:
  - `is:pr is:open review-requested:@me org:<ORG>`
  - `is:pr is:open author:@me org:<ORG>`
  - `is:open mentions:@me org:<ORG> updated:>=<14 days ago>`
  - for each teammate: `is:pr is:open author:<login> org:<ORG>`
- Each PR fetches: number, title, url, repo, isDraft, reviewDecision, mergeable, updatedAt, latest status-check rollup state, and the latest comment/review author + timestamp.
- Every **60 s** while the tab is visible; paused when hidden; immediate refresh when it becomes visible again. At 11 teammates that's 14 requests a minute, well under the 5,000 points/hour limit. If one teammate's search fails, only their tile shows "Couldn't load".

### Teammate tile and drawer

- **Tile:** up to 3 PR pills (`#412 in review`, `#401 ready`, `#405 ❌`, `#398 draft`), then "+N more".
- **Drawer:** all their open PRs with title, repo, draft/ready, review state and CI state, each linking to GitHub; plus Chat and Call buttons.

### "Needs you" rules

Pure functions in `src/web/github/attention.ts`, one per rule:

| Key | Rule | Clears when |
|---|---|---|
| **e** Review requested | Open PR from the review-requested search | You're no longer a requested reviewer |
| **f** Changes requested / new comments | Your open PR with `reviewDecision = CHANGES_REQUESTED`, **or** whose latest comment/review is by someone else and newer than your last-seen time for that PR | Decision changes, or you open the item (marks seen) |
| **g** Ready to merge | Your open, non-draft PR with `reviewDecision = APPROVED`, CI `SUCCESS` (or no checks), and not `CONFLICTING` | Merged/closed or condition no longer true |
| **h** Mentioned | Open issue/PR from the mentions search, updated after your last-seen time for it | You open the item (marks seen) |
| **i** CI failing | Your open PR with CI rollup `FAILURE` or `ERROR` | CI no longer failing |

"Last seen" timestamps are stored per item in `localStorage`. Items are sorted newest activity first (rule order e → i only breaks ties; it also decides which rule an item shows under when several match). Every search uses `sort:updated-desc`, so each capped page of 30 holds the most recently updated results.

## 7. Chat and calls

### Chat

The Chat button opens `slack://user?team=<SLACK_TEAM_ID>&id=<slack_user_id>`. If the teammate has no Slack ID set, the button is disabled with the tooltip "<Name> hasn't added their Slack ID".

### Call (knock + meet.new)

1. Caller clicks **Call** on an online teammate. A new tab opens `https://meet.new`.
2. A modal in Platha asks the caller to paste the Meet link. It must match `^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$`.
3. The client sends `knock { knockId, to, meetUrl }`. The DO relays it to all of the callee's sockets.
4. The callee sees a ringing toast: "<Caller> is calling. **Join** · **Not now**". Join opens the Meet URL.
5. The caller sees the answer, or after **45 s** "No answer — try Slack?", or "<Name> just went offline" if the callee disconnects.

Knocks are never persisted. The Call button is disabled for offline teammates.

## 8. Security

- **Token theft via XSS is the main risk.** Mitigations:
  - CSP: `default-src 'self'; connect-src 'self' https://api.github.com wss://<host>; img-src 'self' https://avatars.githubusercontent.com; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
  - No third-party scripts or analytics.
  - All GitHub-sourced text rendered as plain text (no `dangerouslySetInnerHTML`, no markdown rendering).
- Tokens are never sent to the server except once during join/setup, and never logged.
- Meet URLs and Slack IDs are validated on both client and server against the patterns above.
- Invite code stored in the Durable Object (readable only by the admin, so they can copy the link again); failed join attempts rate-limited.
- Removing a member revokes their sessions and closes their sockets immediately.

## 9. Error handling

| Situation | Behaviour |
|---|---|
| GitHub 401 (token revoked/expired) | Banner: "Your GitHub token stopped working — paste a new one." Presence keeps working. |
| GitHub rate limit / 5xx | Exponential backoff (max 10 min); keep last data. The Needs-you header turns amber: "Updated 4m ago · retrying". No banner, so nothing shifts. The header always shows "Updated …" plus a Refresh button. |
| WebSocket drops | Reconnect with backoff (1 s → 30 s max); "Reconnecting…" indicator. |
| One teammate's search fails | That tile shows "Couldn't load"; the others are unaffected. |
| Knock unanswered | 45 s timeout → "No answer — try Slack?" |
| Callee goes offline mid-knock | "<Name> just went offline" |
| `meet.new` popup blocked | Modal shows an "Open Google Meet" link. |
| No Slack ID | Chat button disabled with tooltip. |
| Session revoked | `session_revoked` message → client clears state and shows "You've been removed from this office." |

## 10. Testing

- **Attention rules:** unit tests over recorded GitHub GraphQL fixtures, covering each rule's trigger and clear conditions and their combinations. This is where the most testing effort goes.
- **Office DO** (`@cloudflare/vitest-pool-workers`):
  - setup, join with valid and invalid invite, rate limiting
  - multi-tab presence and the 30 s grace period
  - status changes
  - knock relay, answer, timeout and offline failures
  - member removal, link rotation
- **API:** join/setup with GitHub `/user` mocked (valid, 401, removed member reconnecting).
- **UI components:** tile states, drawer, needs-you panel, knock toast, call modal validation.
- **E2E (Playwright):** two browsers join, see each other online, one knocks, the other answers; closing one tab greys out the tile after the grace period.
- CI never calls the real GitHub API.

## 11. Deployment

`docs/SETUP.md` walks through:

1. Create a free Cloudflare account; `npx wrangler login`.
2. Set `GITHUB_ORG` and `SLACK_TEAM_ID` in `wrangler.toml`; `npx wrangler secret put SETUP_SECRET`.
3. `npm run deploy` (builds the frontend and deploys the Worker and its static assets) → `https://platha.<account>.workers.dev`.
4. Visit `/setup` to become admin and copy the invite link.
5. Team token guide: fine-grained read-only first, classic fallback, how to find your Slack member ID.
6. Optional: GitHub Action to deploy on push to `main` (uses a Cloudflare API token stored as a repo secret).
