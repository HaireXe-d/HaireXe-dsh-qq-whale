import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPendingStore, shouldAutoReply } from '../lib/pending.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qq-pending-'))

test('主人自己说的 → 自动回；别人说的 → 不能自动回', () => {
  const ownerId = '20002'
  assert.deepEqual(shouldAutoReply({ fromUserId: ownerId, ownerId }), { auto: true, reason: 'owner' })
  assert.deepEqual(shouldAutoReply({ fromUserId: '10001', ownerId }), { auto: false, reason: 'other' })
})

test('还没填主人号的时候，谁的都不自动回（宁可不回也别乱回）', () => {
  assert.deepEqual(shouldAutoReply({ fromUserId: '10001', ownerId: '' }), { auto: false, reason: 'no-owner' })
})

test('别人的消息进队列，状态是 pending', () => {
  const store = createPendingStore({ dshHome: tmp() })
  const r = store.add({ userId: '10001', messageId: 7, nickname: '路人甲', text: '在吗', draft: '在的' })
  assert.equal(r.duplicate, false)
  assert.equal(r.item.status, 'pending')
  assert.equal(store.list().length, 1)
})

test('同一条消息重复进队只算一次（轮询重叠也不会刷屏）', () => {
  const dshHome = tmp()
  const a = createPendingStore({ dshHome })
  const b = createPendingStore({ dshHome })   // 模拟重启：新实例读同一个文件
  const first = a.add({ userId: '10001', messageId: 9, text: '你好' })
  const second = b.add({ userId: '10001', messageId: 9, text: '你好' })
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(b.list().length, 1)
})

test('不同的人说一样的话 → 各自一条', () => {
  const store = createPendingStore({ dshHome: tmp() })
  store.add({ userId: '10001', messageId: 1, text: '你好' })
  store.add({ userId: '10002', messageId: 1, text: '你好' })
  assert.equal(store.list().length, 2)
})

test('空消息不进队列', () => {
  const store = createPendingStore({ dshHome: tmp() })
  assert.throws(() => store.add({ userId: '10001', text: '   ' }))
})

test('take 会把这条从队列里删掉（发出去之后才该调）', () => {
  const store = createPendingStore({ dshHome: tmp() })
  const { item } = store.add({ userId: '10001', text: '在吗' })
  const taken = store.take(item.id)
  assert.equal(taken.src, '在吗')
  assert.equal(store.list().length, 0)
  assert.equal(store.take(item.id), null, '取第二次应该没了')
})

test('drop 只是标记掉，记录还留着（能翻「我拒过什么」）', () => {
  const store = createPendingStore({ dshHome: tmp() })
  const { item } = store.add({ userId: '10001', text: '发个广告' })
  const dropped = store.drop(item.id, { reason: '广告' })
  assert.equal(dropped.status, 'dropped')
  assert.equal(store.list({ status: 'pending' }).length, 0)
  assert.equal(store.list({ status: null }).length, 1, '记录不该删')
  assert.equal(store.list({ status: 'pending' }).length, 0)
})

test('revise 改草稿，但还是 pending（改完也得主人点头）', () => {
  const store = createPendingStore({ dshHome: tmp() })
  const { item } = store.add({ userId: '10001', text: '在吗', draft: '在' })
  const hit = store.revise(item.id, '在的，有什么事？')
  assert.equal(hit.draft, '在的，有什么事？')
  assert.equal(hit.status, 'pending')
})

test('队列文件坏掉不炸，当空的读', () => {
  const dshHome = tmp()
  const store = createPendingStore({ dshHome })
  fs.mkdirSync(path.join(dshHome, 'whale-channels'), { recursive: true })
  fs.writeFileSync(store.file, '{ 坏掉的 json')
  assert.deepEqual(store.list(), [])
  // 还能继续往里加
  assert.equal(store.add({ userId: '10001', text: '还能用' }).duplicate, false)
  assert.equal(store.list().length, 1)
})

test('报给主人的那段话里，他说了什么、我打算回什么都写清楚', () => {
  const store = createPendingStore({ dshHome: tmp() })
  const { item } = store.add({ userId: '10001', nickname: '路人甲', text: '你是机器人吗', draft: '算是吧' })
  const text = store.summaryFor(item)
  assert.match(text, /路人甲/)
  assert.match(text, /你是机器人吗/)
  assert.match(text, /算是吧/)
  assert.match(text, /回我「发」/)
})
