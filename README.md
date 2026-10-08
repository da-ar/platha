# Platha

A small virtual office for a remote dev team. Open it and you see:

- **Who's around:** teammates are lit up while they have Platha open and greyed out when they don't. You can also set yourself to *Focusing* or *Away*.
- **What they're working on:** each person's open pull requests.
- **What needs you:** reviews requested, changes or new comments on your PRs, PRs ready to merge, @mentions, and failing CI.
- **One-click chat and calls:** open a Slack DM, or "knock" to invite someone into a Google Meet.

It needs **no elevated permissions**: no GitHub app, no Slack app, no Google API. Each person pastes their own read-only GitHub token, which stays in their browser.

It runs as a single Cloudflare Worker with one Durable Object, on the free plan.

- **Set it up:** [docs/SETUP.md](docs/SETUP.md)
- **Design:** [docs/superpowers/specs/2026-10-07-platha-office-design.md](docs/superpowers/specs/2026-10-07-platha-office-design.md)
