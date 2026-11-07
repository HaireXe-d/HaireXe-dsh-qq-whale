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

const msg = (id, text) => ({ userId: '20002', messageId: id, nickname: '主人', text })

test('收到一条私信 → 投进会话，内容是「谁说了什么」，并带上完整人设和日记指引', async () => {
  const c = stubController()
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), persona: () => '我是邦邦', log: () => {} })
  const r = await w.deliver(msg(1, '在吗'))
  assert.equal(r.ok, true)
  assert.equal(c.calls.prompt.length, 1)
  const text = c.calls.prompt[0].content[0].text
  assert.match(text, /在吗/)
  assert.match(text, /QQ 私信/)
  // ⚠️ 2026-11-04：改成和 B 站 session-delivery 一样的语义 ——
  //   首次投递带**完整人设正文**（不再是只指路），并追加日记恢复指引 ✓
  assert.match(text, /我是邦邦/, '首次投递要带完整人设正文')
  assert.match(text, /whale-diary\.md/, '要带日记恢复指引')
  assert.match(text, /whale-diary-private\.md/)
})

test('第二次投递：人设正文不再重复（省上下文），但人设依据还在', async () => {
  const c = stubController()
  // ⚠️ 要显式打开 personaOncePerSession —— 只有「每会话只注入一次」时才省略正文。
  //   关着的话每条都带完整人设（和 B 站原来的默认一致）✓
  const w = createQqWaker({
    controller: c, dshHome: tmp(), cwd: tmp(),
    persona: () => '我是邦邦',
    config: () => ({ personaOncePerSession: true }),
    log: () => {},
  })
  await w.deliver(msg(1, '在吗'))
  await w.deliver(msg(2, '还在吗'))
  const second = c.calls.prompt[1].content[0].text
  assert.doesNotMatch(second, /^我是邦邦$/m, '第二次不该再重复整段人设')
  assert.match(second, /人设依据/, '但要告诉她人设在哪，缺了自己重读')
  assert.match(second, /还在吗/)
})

test('人设改了 → 下一次投递重新注入完整人设', async () => {
  const c = stubController()
  let persona = '我是邦邦'
  const w = createQqWaker({ controller: c, dshHome: tmp(), cwd: tmp(), persona: () => persona, log: () => {} })
  await w.deliver(msg(1, '一'))
  persona = '我现在叫阿鱼'                 // 人设改了
  await w.deliver(msg(2, '二'))
  assert.match(c.calls.prompt[1].content[0].text, /我现在叫阿鱼/, '人设变了必须重新注入')
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
