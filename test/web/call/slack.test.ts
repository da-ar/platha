import { expect, test } from 'vitest'
import { slackDmUrl, slackWebUrl } from '../../../src/web/call/slack'

test('slackDmUrl builds deep link', () => {
  expect(slackDmUrl('T0000000', 'U01ABCDEF')).toBe('slack://user?team=T0000000&id=U01ABCDEF')
  expect(slackWebUrl('T0000000')).toBe('https://app.slack.com/client/T0000000')
})
