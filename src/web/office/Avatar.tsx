import { useState } from 'react'
import { displayName, type Member } from '../../shared/types'

export function Avatar({ member, size = 48 }: { member: Member; size?: number }) {
  const [failed, setFailed] = useState(false)
  const name = displayName(member)
  if (failed || !member.avatarUrl.startsWith('https://avatars.githubusercontent.com/')) {
    return (
      <span className="avatar avatar--initial" style={{ width: size, height: size }} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return <img className="avatar" src={member.avatarUrl} alt="" width={size} height={size} onError={() => setFailed(true)} />
}
