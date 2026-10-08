export function slackDmUrl(teamId: string, userId: string): string {
  return `slack://user?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(userId)}`
}

export function slackWebUrl(teamId: string): string {
  return `https://app.slack.com/client/${encodeURIComponent(teamId)}`
}
