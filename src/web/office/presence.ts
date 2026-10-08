import type { Member } from '../../shared/types'

export type PresenceLabel = 'Online' | 'Focusing' | 'Away' | 'Offline'

export function presenceLabel(m: Member): PresenceLabel {
  if (!m.online) return 'Offline'
  if (m.status === 'focusing') return 'Focusing'
  if (m.status === 'away') return 'Away'
  return 'Online'
}
