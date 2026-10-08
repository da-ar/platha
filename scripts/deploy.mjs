// Builds and deploys Platha, passing the org and Slack workspace to Wrangler
// as deploy-time vars so they never need to be committed to wrangler.jsonc.
//
// Reads PLATHA_GITHUB_ORG and PLATHA_SLACK_TEAM_ID from the environment
// (GitHub Actions secrets in CI, or a git-ignored .deploy.env locally).
import { spawnSync } from 'node:child_process'

const settings = [
  { env: 'PLATHA_GITHUB_ORG', binding: 'GITHUB_ORG', pattern: /^[A-Za-z0-9-]{1,39}$/, hint: 'your GitHub organisation login, e.g. acme' },
  { env: 'PLATHA_SLACK_TEAM_ID', binding: 'SLACK_TEAM_ID', pattern: /^[TE][A-Z0-9]{6,}$/, hint: 'your Slack workspace ID, e.g. T0123456' },
]

const vars = []
const problems = []
for (const s of settings) {
  const value = (process.env[s.env] ?? '').trim()
  if (!value) problems.push(`${s.env} is not set (${s.hint})`)
  else if (!s.pattern.test(value)) problems.push(`${s.env} doesn't look right (${s.hint})`)
  else vars.push('--var', `${s.binding}:${value}`)
}
// Optional: the company email domain, to pick the work address for calendars.
const domain = (process.env.PLATHA_CALENDAR_DOMAIN ?? '').trim().toLowerCase().replace(/^@/, '')
if (domain) {
  if (/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) vars.push('--var', `CALENDAR_EMAIL_DOMAIN:${domain}`)
  else problems.push(`PLATHA_CALENDAR_DOMAIN doesn't look like a domain (e.g. rapid7.com)`)
}

if (problems.length > 0) {
  console.error(`Not deploying:\n  - ${problems.join('\n  - ')}\nSee docs/SETUP.md, step 2.`)
  process.exit(1)
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(npm, ['run', 'build'])
run(npx, ['wrangler', 'deploy', ...vars, ...process.argv.slice(2)])
