import { useEffect, useState, type FormEvent } from 'react'
import type { ClientMessage } from '../../shared/messages'
import type { Member, Status } from '../../shared/types'
import { STATUS_TEXT_MAX } from '../../shared/validators'

const OPTIONS: { value: Status; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'focusing', label: 'Focusing' },
  { value: 'away', label: 'Away' },
]

export function StatusPicker({ me, send }: { me: Member; send: (m: ClientMessage) => void }) {
  const [text, setText] = useState(me.statusText ?? '')
  useEffect(() => setText(me.statusText ?? ''), [me.statusText])

  function update(status: Status, note: string) {
    const trimmed = note.trim()
    send(trimmed ? { type: 'set_status', status, text: trimmed } : { type: 'set_status', status })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    update(me.status, text)
  }

  return (
    <form className="status-picker" onSubmit={submit}>
      <span className={`dot dot--${me.status === 'available' ? 'online' : me.status}`} aria-hidden="true" />
      <select aria-label="Your status" value={me.status} onChange={(e) => update(e.target.value as Status, text)}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        aria-label="Status note"
        placeholder="What are you up to?"
        maxLength={STATUS_TEXT_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== (me.statusText ?? '') && update(me.status, text)}
      />
    </form>
  )
}
