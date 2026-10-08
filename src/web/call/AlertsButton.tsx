import { useState } from 'react'
import { notificationPermission, requestNotifications } from './ring'

/** Asks for desktop notifications so knocks are seen when Platha is in the background. */
export function AlertsButton() {
  const [permission, setPermission] = useState(notificationPermission)
  if (permission !== 'default') return null
  return (
    <button
      className="btn"
      type="button"
      title="Get a desktop notification when someone calls you while Platha is in the background"
      onClick={async () => setPermission(await requestNotifications())}
    >
      Turn on call alerts
    </button>
  )
}
