export const STATUS_TEXT_MAX = 80

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/
const SLACK_USER_ID = /^[UW][A-Z0-9]{6,}$/

/** Returns the canonical `https://meet.google.com/abc-defg-hij` form, or null if not a Meet room link. */
export function normalizeMeetUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com' || url.port !== '') return null
  if (url.username !== '' || url.password !== '') return null
  const path = url.pathname.replace(/\/+$/, '')
  const canonical = `https://meet.google.com${path}`
  return MEET_URL.test(canonical) ? canonical : null
}

export function normalizeSlackUserId(input: string): string | null {
  const id = input.trim().toUpperCase()
  return SLACK_USER_ID.test(id) ? id : null
}
