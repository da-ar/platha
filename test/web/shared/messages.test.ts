import { expect, test } from 'vitest'
import { parseClientMessage, parseServerMessage } from '../../../src/shared/messages'

test('parses a valid set_status', () => {
  expect(parseClientMessage('{"type":"set_status","status":"focusing"}')).toEqual({ type: 'set_status', status: 'focusing' })
})

test('rejects status text over 80 chars', () => {
  expect(parseClientMessage(JSON.stringify({ type: 'set_status', status: 'away', text: 'x'.repeat(81) }))).toBeNull()
})

test('rejects unknown status and bad json', () => {
  expect(parseClientMessage('{"type":"set_status","status":"busy"}')).toBeNull()
  expect(parseClientMessage('not json')).toBeNull()
})

test('knock meet url is normalised', () => {
  const msg = parseClientMessage(
    JSON.stringify({ type: 'knock', knockId: crypto.randomUUID(), to: 2, meetUrl: 'https://meet.google.com/abc-defg-hij?authuser=1' }),
  )
  expect(msg?.type === 'knock' && msg.meetUrl).toBe('https://meet.google.com/abc-defg-hij')
})

test('knock with a non-meet url or bad id is rejected', () => {
  expect(parseClientMessage(JSON.stringify({ type: 'knock', knockId: 'k', to: 2, meetUrl: 'https://evil.io' }))).toBeNull()
  expect(
    parseClientMessage(JSON.stringify({ type: 'knock', knockId: 'k', to: 2, meetUrl: 'https://meet.google.com/abc-defg-hij' })),
  ).toBeNull()
})

test('parses knock_answer', () => {
  const knockId = crypto.randomUUID()
  expect(parseClientMessage(JSON.stringify({ type: 'knock_answer', knockId, to: 1, answer: 'join' }))).toEqual({
    type: 'knock_answer',
    knockId,
    to: 1,
    answer: 'join',
  })
})

test('parses server messages', () => {
  expect(parseServerMessage('{"type":"session_revoked"}')).toEqual({ type: 'session_revoked' })
  expect(parseServerMessage('{"type":"nope"}')).toBeNull()
})
