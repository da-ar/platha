# Setting up Platha

Platha runs as one Cloudflare Worker on the free plan. Setup takes about 15 minutes, and after that there's nothing to maintain.

You'll need:

1. [Node.js](https://nodejs.org) 22 or newer.
2. A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
3. This repository cloned, with `npm install` run.

## 1. Log in to Cloudflare

```sh
npx wrangler login
```

## 2. Point Platha at your GitHub org and Slack workspace

Edit `wrangler.jsonc` and fill in the two `vars`:

```jsonc
"vars": {
  "GITHUB_ORG": "acme",        // your GitHub organisation's login
  "SLACK_TEAM_ID": "T0123456", // your Slack workspace ID
  ...
}
```

**Finding your Slack workspace ID:** open Slack in a browser at <https://app.slack.com>. The address looks like `https://app.slack.com/client/T0123456/C…`. The part starting with `T` is the workspace ID.

## 3. Choose a setup secret

This one-time code lets you become the office admin. Pick something long and random:

```sh
npx wrangler secret put SETUP_SECRET
```

## 4. Deploy

```sh
npm run deploy
```

Wrangler prints your URL, for example `https://platha.<your-account>.workers.dev`.

## 5. Become the admin and invite your team

1. Open `https://platha.<your-account>.workers.dev/setup`.
2. Enter the setup secret and your GitHub token (see [below](#token)).
3. Copy the invite link and share it with your team, for example in a Slack DM.

The `/setup` page stops working once an admin exists. You can copy the invite link again, or rotate it, from **Settings**.

<a id="token"></a>

## 6. Making a GitHub token

Everyone pastes their own GitHub token when they join. It stays in their browser and goes straight to GitHub. Platha's server only sees it once, to check who you are, and never stores it.

### Recommended: fine-grained, read-only

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** your organisation.
3. **Expiration:** up to you. Platha will ask for a new token when this one expires.
4. **Repository access:** All repositories (or the ones your team works in).
5. **Permissions → Repository permissions**, all **Read-only**:
   - Pull requests
   - Issues
   - Commit statuses
   - Metadata (added automatically)
6. Generate, copy, and paste it into Platha.

### If GitHub says the token is "pending approval"

Some organisations require an admin to approve fine-grained tokens. If you can't wait for that, use a **classic** token instead:

1. **Personal access tokens → Tokens (classic) → Generate new token (classic)**.
2. Tick the **`repo`** scope.

> ⚠️ A classic `repo` token can also **write** to every repository you can access. Platha only ever reads with it, but keep it private, and prefer the fine-grained token when you can.

### If your organisation uses SAML single sign-on

After creating the token, click **Configure SSO** next to it on GitHub and **Authorize** it for your organisation. Otherwise your org's PRs won't show up.

## 7. Finding your Slack member ID

Teammates can message you from Platha once you've added your Slack member ID:

1. In Slack, click your profile picture → **Profile**.
2. Click **⋮** (more) → **Copy member ID**. It starts with `U` or `W`.
3. In Platha, open **Settings**, paste it under **Slack member ID**, and click **Save**.

## 8. Local development

```sh
cp .dev.vars.example .dev.vars   # then edit it
npm run dev:worker                # API + Durable Object on http://localhost:8787
npm run dev:web                   # Vite on http://localhost:5173, proxying /api and /ws
```

Visit `http://localhost:5173/setup` to create a local office.

Checks:

```sh
npm run typecheck
npm test        # worker + web unit tests
npm run e2e     # two browsers, a fake GitHub, and a local Worker
```

## 9. Optional: deploy on every push to `main`

`.github/workflows/deploy.yml` runs the tests on every push and pull request. On `main` it also deploys, once you add two repository secrets (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN`: create it at **Cloudflare dashboard → My Profile → API Tokens → Create Token**, using the **Edit Cloudflare Workers** template.
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers & Pages overview page.

Until those secrets exist, the deploy step is skipped.

`SETUP_SECRET` stays in Cloudflare (step 3); CI doesn't need it.
