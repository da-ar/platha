import { AuthCard } from './Shell'
import { NEED_INVITE } from './TokenField'

export function NoInvite() {
  return (
    <AuthCard title={NEED_INVITE}>
      <p className="muted">Ask whoever runs your office for the link.</p>
    </AuthCard>
  )
}
