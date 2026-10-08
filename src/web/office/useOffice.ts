import { useCallback, useEffect, useReducer, useRef } from 'react'
import { parseServerMessage, type ClientMessage, type ServerMessage } from '../../shared/messages'
import { me } from '../api'
import { go } from '../navigate'
import { initialOfficeState, officeReducer, type Connection, type OfficeState } from './officeReducer'

export const PING_INTERVAL_MS = 25_000
const BACKOFF_START_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const CLOSE_REMOVED = 4403

type Action = { type: 'message'; msg: ServerMessage } | { type: 'connection'; connection: Connection }

function reducer(state: OfficeState, action: Action): OfficeState {
  if (action.type === 'message') return officeReducer(state, action.msg)
  if (state.connection === 'removed') return state
  return { ...state, connection: action.connection }
}

export interface Office {
  state: OfficeState
  /** Returns false if the message couldn't be sent because the socket isn't open. */
  send: (m: ClientMessage) => boolean
  subscribe: (fn: (m: ServerMessage) => void) => () => void
}

export function useOffice(): Office {
  const [state, dispatch] = useReducer(reducer, initialOfficeState)
  const socket = useRef<WebSocket | null>(null)
  const listeners = useRef(new Set<(m: ServerMessage) => void>())

  useEffect(() => {
    let stopped = false
    let backoff = BACKOFF_START_MS
    let ping: ReturnType<typeof setInterval> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined

    function connect() {
      const ws = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws`)
      socket.current = ws
      let opened = false

      ws.onopen = () => {
        opened = true
        backoff = BACKOFF_START_MS
        dispatch({ type: 'connection', connection: 'open' })
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_INTERVAL_MS)
      }

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== 'string' || e.data === 'pong') return
        const msg = parseServerMessage(e.data)
        if (!msg) return
        if (msg.type === 'session_revoked') stopped = true
        dispatch({ type: 'message', msg })
        for (const fn of listeners.current) fn(msg)
      }

      ws.onclose = (e: CloseEvent) => {
        clearInterval(ping)
        if (socket.current === ws) socket.current = null
        if (stopped) return
        if (e.code === CLOSE_REMOVED) {
          stopped = true
          dispatch({ type: 'message', msg: { type: 'session_revoked' } })
          return
        }
        dispatch({ type: 'connection', connection: 'reconnecting' })
        const delay = backoff
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
        if (!opened) {
          // Never got in: maybe the session is gone.
          void me().then((r) => {
            if (stopped) return
            if (!r.ok && r.status === 401) {
              stopped = true
              go('/')
            } else {
              retry = setTimeout(connect, delay)
            }
          })
        } else {
          retry = setTimeout(connect, delay)
        }
      }
    }

    connect()
    return () => {
      stopped = true
      clearInterval(ping)
      clearTimeout(retry)
      socket.current?.close()
      socket.current = null
    }
  }, [])

  const send = useCallback((m: ClientMessage) => {
    const ws = socket.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(m))
    return true
  }, [])

  const subscribe = useCallback((fn: (m: ServerMessage) => void) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  return { state, send, subscribe }
}
