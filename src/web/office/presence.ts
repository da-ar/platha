import type { Member } from '../../shared/types'

export type PresenceLabel = 'Online' | 'Focusing' | 'Away' | 'In a meeting' | 'Offline'
export type PresenceTone = 'online' | 'focusing' | 'away' | 'meeting' | 'offline'

/** Whether the member's calendar says they're in a meeting right now. */
export function inMeeting(m: Member, now: number = Date.now()): boolean {
  return m.meetingUntil !== null && m.meetingUntil > now
}

/** Offline > Away > In a meeting > Focusing > Online. */
export function presenceLabel(m: Member, now: number = Date.now()): PresenceLabel {
  if (!m.online) return 'Offline'
  if (m.status === 'away') return 'Away'
  if (inMeeting(m, now)) return 'In a meeting'
  if (m.status === 'focusing') return 'Focusing'
  return 'Online'
}

export function presenceTone(label: PresenceLabel): PresenceTone {
  return label === 'In a meeting' ? 'meeting' : (label.toLowerCase() as PresenceTone)
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "In a meeting · until 11:00", or just the label. */
export function presenceText(m: Member, now: number = Date.now()): string {
  const label = presenceLabel(m, now)
  return label === 'In a meeting' && m.meetingUntil ? `${label} · until ${clockTime(m.meetingUntil)}` : label
}
