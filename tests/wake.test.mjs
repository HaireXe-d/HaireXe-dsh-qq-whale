import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createQqWaker } from '../lib/wake.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qq-wake-'))

function stubController({ fail = false } = {}) {
  const calls = { create: 0, prompt: [] }
  return {
    calls,
    async create() { calls.create += 1; return { sessionId: 'bili-whale' } },
    async prompt(req) { if (fail) throw new Error('投不进去'); calls.prompt.push(req) },
  }
}

const msg = (id, text) => ({ userId: '3546626108951012', messageId: id, nickname: '主人', text })

test('收到一条私信 → 投进会话，内容是「谁说了什么」', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), persona: () => '我是邦邦', log: () => {} })
  const r = await w.deliver(msg(1, '在吗'))
  assert.equal(r.ok, true)
  assert.equal(c.calls.prompt.length, 1)
  const text = c.calls.prompt[0].content[0].text
  assert.match(text, /在吗/)
  assert.match(text, /QQ 私信/)
  assert.match(text, /人设依据/)
})

test('同一条消息投两次：第二次跳过（别让她说两遍）', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), log: () => {} })
  await w.deliver(msg(7, '在吗'))
  const second = await w.deliver(msg(7, '在吗'))
  assert.equal(c.calls.prompt.length, 1, '不该投第二遍')
  assert.equal(second.skipped, 'already-delivered')
})

test('重启之后也记得投过（落盘）', async () => {
  const home = tmp()
  const c1 = stubController()
  const w1 = createQqWaker({ controller: c1, dshHome: home, cwd: tmp(), log: () => {} })
  await w1.deliver(msg(9, '你好'))
  const c2 = stubController()
  const w2 = createQqWaker({ controller: c2, dshHome: home, cwd: tmp(), log: () => {} })
  await w2.deliver(msg(9, '你好'))
  assert.equal(c2.calls.prompt.length, 0, '重启后不该重复投递')
})

test('没有 controller 时明确报错，不是安静不干活', async () => {
  const w = createQqWaker({ controller: null, dshHome: tmp(), cwd: tmp(), log: () => {} })
  await assert.rejects(() => w.deliver(msg(1, '在吗')), /sessionController/)
})

test('投递失败：不标记已投（下次还能重来）', async () => {
  const home = tmp()
  const bad = stubController({ fail: true })
  const w = createQqWaker({ controller: bad, dshHome: home, cwd: tmp(), log: () => {} })
  await assert.rejects(() => w.deliver(msg(3, '试试')))
  assert.equal(w.alreadySeen(msg(3, '试试')), false, '失败了不该记成已投')

  const good = stubController()
  const w2 = createQqWaker({ controller: good, dshHome: home, cwd: tmp(), log: () => {} })
  await w2.deliver(msg(3, '试试'))
  assert.equal(good.calls.prompt.length, 1, '重试应该成功投出去')
})

test('多条消息按顺序投（不会乱序）', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), log: () => {} })
  await Promise.all([w.deliver(msg(1, '第一')), w.deliver(msg(2, '第二')), w.deliver(msg(3, '第三'))])
  const texts = c.calls.prompt.map((p) => String(p.content[0].text).split('刚给你发私信：')[1]?.split('（回话照旧')[0]?.trim())
  assert.deepEqual(texts, ['第一', '第二', '第三'])
})

test('内容里带上回话提示（去 dm-reply-qq.txt 写，[语音]/[表情] 标记）', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), log: () => {} })
  await w.deliver(msg(1, '早'))
  const text = c.calls.prompt[0].content[0].text
  assert.match(text, /dm-reply-qq\.txt/)
  assert.match(text, /\[语音\]/)
  assert.match(text, /\[表情\]/)
})

test('投递用的是 queue 模式（她正忙就排队，别打断）', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), log: () => {} })
  await w.deliver(msg(1, '早'))
  assert.equal(c.calls.prompt[0].mode, 'queue')
})

test('没配人设也不炸，只是不带头', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), persona: () => '', log: () => {} })
  const r = await w.deliver(msg(1, '早'))
  assert.equal(r.ok, true)
  assert.equal(c.calls.prompt[0].content[0].text.includes('人设依据'), false)
})
