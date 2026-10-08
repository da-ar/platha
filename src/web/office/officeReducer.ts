import type { ServerMessage } from '../../shared/messages'
import type { Member } from '../../shared/types'

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'removed'

export interface OfficeState {
  members: Record<number, Member>
  connection: Connection
}

export const initialOfficeState: OfficeState = { members: {}, connection: 'connecting' }

export function officeReducer(state: OfficeState, msg: ServerMessage): OfficeState {
  switch (msg.type) {
    case 'snapshot':
      return { ...state, members: Object.fromEntries(msg.members.map((m) => [m.githubId, m])) }
    case 'member_updated':
      return { ...state, members: { ...state.members, [msg.member.githubId]: msg.member } }
    case 'member_removed': {
      const { [msg.githubId]: _gone, ...members } = state.members
      return { ...state, members }
    }
    case 'session_revoked':
      return { ...state, connection: 'removed' }
    default:
      // Knock messages are handled by useKnocks.
      return state
  }
}
