// A stand-in for GitHub's REST `GET /user`, used by the Worker during e2e runs.
import { createServer } from 'node:http'

const users: Record<string, { id: number; login: string; name: null; avatar_url: string; email: string | null }> = {
  'alice-token': { id: 1, login: 'alice', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/1', email: null },
  'bob-token': { id: 2, login: 'bob', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/2', email: null },
}

/** Bob's fake public calendar: a meeting from 10 minutes ago to 50 minutes from now, plus one this afternoon. */
function bobCalendar(): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const now = Date.now()
  const event = (uid: string, start: number, end: number) =>
    ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'SUMMARY:Busy', 'END:VEVENT'].join('\r\n')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', event('now', now - 10 * 60_000, now + 50 * 60_000), event('later', now + 3 * 3_600_000, now + 4 * 3_600_000), 'END:VCALENDAR'].join('\r\n')
}

const port = Number(process.env.FAKE_GITHUB_PORT ?? 8790)

createServer((req, res) => {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const user = users[token]
  if (req.method === 'GET' && req.url === '/user/emails') {
    // Bob's work address is private: only visible here, with the Email addresses permission.
    const emails = token === 'bob-token' ? [{ email: 'bob@acme.dev', primary: true, verified: true, visibility: 'private' }] : null
    if (emails) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(emails))
    else res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"message":"Resource not accessible by personal access token"}')
    return
  }
  if (req.method === 'GET' && req.url === '/user' && user) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(user))
  } else if (req.url === '/calendar/bob%40acme.dev/public/basic.ics') {
    res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(bobCalendar())
  } else if (req.url?.startsWith('/calendar/')) {
    res.writeHead(404).end('Not Found')
  } else if (req.url === '/health') {
    res.writeHead(200).end('ok')
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"message":"Bad credentials"}')
  }
}).listen(port, () => console.log(`fake github on ${port}`))
