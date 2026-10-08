import { useCallback, useEffect, useRef, useState } from 'react'
import type { Member } from '../../shared/types'
import { openTab } from '../navigate'
import type { Office } from '../office/useOffice'

export const KNOCK_TIMEOUT_MS = 45_000
/** How long to wait for the server to confirm it rang the callee. */
export const KNOCK_ACK_MS = 8_000

/**
 * `calling`: sent, waiting for the server to confirm delivery.
 * `ringing`: the callee's browser has been sent the knock.
 * `unreachable`: the knock never reached the server.
 */
export type OutgoingState = 'calling' | 'ringing' | 'joined' | 'declined' | 'no_answer' | 'went_offline' | 'unreachable'

const ACTIVE: OutgoingState[] = ['calling', 'ringing']

export interface Outgoing {
  knockId: string
  to: Member
  state: OutgoingState
}

export interface Incoming {
  knockId: string
  from: Member
  meetUrl: string
}

export interface Knocks {
  outgoing: Outgoing | null
  incoming: Incoming[]
  call: (member: Member, meetUrl: string) => void
  answer: (k: Incoming, a: 'join' | 'decline') => void
  dismissOutgoing: () => void
}

export function useKnocks(office: Pick<Office, 'send' | 'subscribe'>, members: Record<number, Member>): Knocks {
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const [incoming, setIncoming] = useState<Incoming[]>([])
  const outgoingRef = useRef<Outgoing | null>(null)
  const membersRef = useRef(members)
  membersRef.current = members
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])

  /** Moves an in-progress knock to `state`; answers and timeouts after that are ignored. */
  const updateOutgoing = useCallback((knockId: string, state: OutgoingState, from: OutgoingState[] = ACTIVE) => {
    const current = outgoingRef.current
    if (!current || current.knockId !== knockId) return
    if (!from.includes(current.state)) return
    const next = { ...current, state }
    outgoingRef.current = next
    setOutgoing(next)
  }, [])

  useEffect(() => {
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [])

  useEffect(
    () =>
      office.subscribe((msg) => {
        switch (msg.type) {
          case 'knock': {
            const from = membersRef.current[msg.from]
            if (!from) return
            setIncoming((list) => [...list.filter((k) => k.knockId !== msg.knockId), { knockId: msg.knockId, from, meetUrl: msg.meetUrl }])
            later(() => setIncoming((list) => list.filter((k) => k.knockId !== msg.knockId)), KNOCK_TIMEOUT_MS)
            return
          }
          case 'knock_ringing':
            updateOutgoing(msg.knockId, 'ringing', ['calling'])
            return
          case 'knock_answered':
            updateOutgoing(msg.knockId, msg.answer === 'join' ? 'joined' : 'declined')
            return
          case 'knock_failed':
            updateOutgoing(msg.knockId, 'went_offline')
            return
          case 'member_updated': {
            const current = outgoingRef.current
            if (current && current.to.githubId === msg.member.githubId && !msg.member.online) {
              updateOutgoing(current.knockId, 'went_offline')
            }
            if (!msg.member.online) setIncoming((list) => list.filter((k) => k.from.githubId !== msg.member.githubId))
            return
          }
          case 'member_removed':
            setIncoming((list) => list.filter((k) => k.from.githubId !== msg.githubId))
            return
        }
      }),
    [office.subscribe, later, updateOutgoing],
  )

  const call = useCallback(
    (member: Member, meetUrl: string) => {
      const knockId = crypto.randomUUID()
      const sent = office.send({ type: 'knock', knockId, to: member.githubId, meetUrl })
      const next: Outgoing = { knockId, to: member, state: sent ? 'calling' : 'unreachable' }
      outgoingRef.current = next
      setOutgoing(next)
      if (!sent) return
      later(() => updateOutgoing(knockId, 'unreachable', ['calling']), KNOCK_ACK_MS)
      later(() => updateOutgoing(knockId, 'no_answer'), KNOCK_TIMEOUT_MS)
    },
    [office.send, later, updateOutgoing],
  )

  const answer = useCallback(
    (k: Incoming, a: 'join' | 'decline') => {
      office.send({ type: 'knock_answer', knockId: k.knockId, to: k.from.githubId, answer: a })
      setIncoming((list) => list.filter((x) => x.knockId !== k.knockId))
      if (a === 'join') openTab(k.meetUrl)
    },
    [office.send],
  )

  const dismissOutgoing = useCallback(() => {
    outgoingRef.current = null
    setOutgoing(null)
  }, [])

  return { outgoing, incoming, call, answer, dismissOutgoing }
}
