import { expect, test } from 'vitest'
import { slackDmUrl } from '../../../src/web/call/slack'

test('slackDmUrl builds deep link', () => {
  expect(slackDmUrl('T0000000', 'U01ABCDEF')).toBe('slack://user?team=T0000000&id=U01ABCDEF')
})
