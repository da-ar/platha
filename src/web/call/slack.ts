export function slackDmUrl(teamId: string, userId: string): string {
  return `slack://user?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(userId)}`
}
