// A stand-in for GitHub's REST `GET /user`, used by the Worker during e2e runs.
import { createServer } from 'node:http'

const users: Record<string, { id: number; login: string; name: null; avatar_url: string }> = {
  'alice-token': { id: 1, login: 'alice', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  'bob-token': { id: 2, login: 'bob', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/2' },
}

const port = Number(process.env.FAKE_GITHUB_PORT ?? 8790)

createServer((req, res) => {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const user = users[token]
  if (req.method === 'GET' && req.url === '/user' && user) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(user))
  } else if (req.url === '/health') {
    res.writeHead(200).end('ok')
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"message":"Bad credentials"}')
  }
}).listen(port, () => console.log(`fake github on ${port}`))
