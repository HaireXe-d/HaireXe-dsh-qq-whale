import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPoller, normalizeHistory, inQuietHours } from '../lib/poller.js'

function stubOb(pages) {
  let i = 0
  return {
    getPrivateHistory: async () => {
      const p = pages[Math.min(i, pages.length - 1)]
      i += 1
      if (p instanceof Error) throw p
      return p
    },
    calls: () => i,
  }
}

const msg = (id, text, time = 1793748250) => ({ message_id: id, time, sender: { user_id: '999', nickname: '主人' }, message: [{ type: 'text', data: { text } }] })

test('第一轮只建基线，不把老消息当成新消息灌进来', async () => {
  const got = []
  const ob = stubOb([{ messages: [msg(1, '旧消息')] }])
  const p = createPoller({ ob, ownerId: '999', state: {}, onMessage: (m) => got.push(m) })
  await p.pollOnce()
  assert.deepEqual(got, [])
  assert.equal(p.state.baselineDone, true)
})

test('基线之后来了新消息会通知，重复的只通知一次', async () => {
  const got = []
  const ob = stubOb([
    { messages: [] },
    { messages: [msg(1, '早')] },
    { messages: [msg(1, '早')] },
    { messages: [msg(1, '早'), msg(2, '醒了没')] },
  ])
  const p = createPoller({ ob, ownerId: '999', state: {}, onMessage: (m) => got.push(m.text) })
  await p.pollOnce()
  await p.pollOnce()
  await p.pollOnce()
  await p.pollOnce()
  assert.deepEqual(got, ['早', '醒了没'])
})

test('失败后退避，成功后回到正常间隔', async () => {
  const ob = stubOb([new Error('挂了'), new Error('又挂'), { messages: [] }])
  const p = createPoller({ ob, ownerId: '999', state: {}, opts: { intervalSec: 8, backoffMaxSec: 180 } })
  assert.equal(p.nextDelayMs(), 8000)
  await p.pollOnce()
  assert.equal(p.state.failures, 1)
  assert.equal(p.nextDelayMs(), 16000)
  await p.pollOnce()
  assert.equal(p.state.failures, 2)
  assert.equal(p.nextDelayMs(), 32000)
  await p.pollOnce()
  assert.equal(p.state.failures, 0)
  assert.equal(p.nextDelayMs(), 8000)
})

test('退避有上限，别无限翻倍', async () => {
  const ob = stubOb([new Error('挂')])
  const p = createPoller({ ob, ownerId: '999', state: {}, opts: { intervalSec: 8, backoffMaxSec: 180 } })
  for (let i = 0; i < 10; i += 1) await p.pollOnce()
  assert.equal(p.nextDelayMs(), 180000)
})

test('历史格式兼容：数组 / messages / message_list 都认', () => {
  assert.equal(normalizeHistory([msg(1, 'a')]).length, 1)
  assert.equal(normalizeHistory({ messages: [msg(2, 'b')] }).length, 1)
  assert.equal(normalizeHistory({ message_list: [msg(3, 'c')] }).length, 1)
  assert.deepEqual(normalizeHistory(null), [])
  assert.deepEqual(normalizeHistory({ messages: [msg(4, '')] }), [])   // 空文本丢掉
})

test('安静时段：跨零点也算', () => {
  const at = (h, m) => new Date(2026, 10, 4, h, m)
  const w = [{ from: '23:30', to: '07:00' }]
  assert.equal(inQuietHours(w, at(23, 45)), true)
  assert.equal(inQuietHours(w, at(2, 0)), true)
  assert.equal(inQuietHours(w, at(6, 59)), true)
  assert.equal(inQuietHours(w, at(7, 0)), false)
  assert.equal(inQuietHours(w, at(12, 0)), false)
  assert.equal(inQuietHours([], at(2, 0)), false)
  assert.equal(inQuietHours([{ from: '09:00', to: '12:00' }], at(10, 0)), true)
})
