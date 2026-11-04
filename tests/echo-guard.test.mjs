import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHistory } from '../lib/poller.js'

const ME = '20002'
const OWNER = '10001'

const his = { message_id: 1, time: 1, sender: { user_id: OWNER, nickname: '主人' }, message: [{ type: 'text', data: { text: '在吗' } }] }
const minePostType = { message_id: 2, time: 2, post_type: 'message_sent', message_sent_type: 'self', sender: { user_id: OWNER }, message: [{ type: 'text', data: { text: '我发的' } }] }
const mineSelfId = { message_id: 3, time: 3, sender: { user_id: ME, nickname: 'L' }, message: [{ type: 'text', data: { text: '也是我发的' } }] }

test('2026-11-04 刷屏事故：我自己发出去的消息不算来信', () => {
  const out = normalizeHistory({ messages: [his, minePostType, mineSelfId] }, { selfId: ME })
  assert.equal(out.length, 1, '三条里只该剩他发的那条')
  assert.equal(out[0].userId, OWNER)
})

test('只靠 post_type 也能剔（有些实现不给 selfId）', () => {
  const out = normalizeHistory({ messages: [his, minePostType] })
  assert.equal(out.length, 1)
})

test('只靠 selfId 也能剔（有些实现不给 post_type）', () => {
  const out = normalizeHistory({ messages: [his, mineSelfId] }, { selfId: ME })
  assert.equal(out.length, 1)
})

test('他发的消息照旧能进来', () => {
  const out = normalizeHistory({ messages: [his] }, { selfId: ME })
  assert.equal(out.length, 1)
  assert.equal(out[0].text, '在吗')
})
