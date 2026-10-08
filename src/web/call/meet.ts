export const MEET_NEW = 'https://meet.new'

/** Opens a new Meet in a tab. Must be called from a click handler. Returns false if the popup was blocked. */
export function openNewMeet(): boolean {
  const w = window.open(MEET_NEW, '_blank')
  if (!w) return false
  try {
    w.opener = null
  } catch {
    // cross-origin already; nothing to sever
  }
  return true
}
