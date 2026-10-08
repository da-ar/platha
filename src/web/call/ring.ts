import { useEffect, useRef } from 'react'
import { displayName } from '../../shared/types'
import type { Incoming } from './useKnocks'

/** Whether the browser can show desktop notifications, and what the user has allowed. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

let audio: AudioContext | null = null

/** A short two-tone chime. Silently does nothing if audio isn't allowed yet. */
function chime(): void {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const ctx = audio
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const start = ctx.currentTime + i * 0.25
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.25)
    })
  } catch {
    // no audio available
  }
}

const CHIME_EVERY_MS = 2_500
const FLASH_EVERY_MS = 1_000

/**
 * Makes an incoming knock noticeable when Platha isn't the window in front:
 * a desktop notification (if allowed), a flashing tab title and a chime.
 */
export function useRinging(incoming: Incoming[]): void {
  const notes = useRef(new Map<string, Notification>())

  // One desktop notification per knock, closed when the knock goes away.
  useEffect(() => {
    const live = new Set(incoming.map((k) => k.knockId))
    for (const [id, n] of notes.current) {
      if (!live.has(id)) {
        n.close()
        notes.current.delete(id)
      }
    }
    if (notificationPermission() !== 'granted') return
    for (const k of incoming) {
      if (notes.current.has(k.knockId)) continue
      try {
        const n = new Notification(`${displayName(k.from)} is calling`, {
          body: 'Open Platha to join or decline.',
          tag: k.knockId,
          requireInteraction: true,
        })
        n.onclick = () => {
          window.focus()
          n.close()
        }
        notes.current.set(k.knockId, n)
      } catch {
        // some browsers only allow notifications from a service worker
      }
    }
  }, [incoming])

  useEffect(() => {
    const map = notes.current
    return () => map.forEach((n) => n.close())
  }, [])

  // Title flash and chime while anyone is calling.
  const caller = incoming.length > 0 ? displayName(incoming[incoming.length - 1].from) : null
  useEffect(() => {
    if (!caller) return
    const original = document.title
    const alert = `📞 ${caller} is calling`
    let on = true
    document.title = alert
    chime()
    const flash = setInterval(() => {
      on = !on
      document.title = on ? alert : original
    }, FLASH_EVERY_MS)
    const ring = setInterval(chime, CHIME_EVERY_MS)
    return () => {
      clearInterval(flash)
      clearInterval(ring)
      document.title = original
    }
  }, [caller])
}
