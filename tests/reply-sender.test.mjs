import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createReplySender } from '../lib/reply-sender.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qq-reply-sender-'))

function fakeOb({ fail = false } = {}) {
  const sent = []
  return {
    sent,
    async sendPrivate(to, msg) {
      if (fail) return { ok: false }
      sent.push({ to, msg })
      return { ok: true }
    },
  }
}

const writeFile = (dir, text) => fs.writeFileSync(path.join(dir, 'dm-reply-qq.txt'), text)
const readFile = (dir) => fs.readFileSync(path.join(dir, 'dm-reply-qq.txt'), 'utf8')

test('2026-11-04 回归：一行一句，真的发出去（以前压根没人发）', async () => {
  const dir = tmp()
  const ob = fakeOb()
  const s = createReplySender({ ob, ownerId: '10001', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  writeFile(dir, '收到了\n这次真通了\n')
  const r = await s.tick()
  assert.equal(r.sent, 2)
  assert.deepEqual(ob.sent.map((x) => x.msg), ['收到了', '这次真通了'])
  assert.equal(ob.sent[0].to, '10001')
})

test('发成功之后文件清空（不然下一轮又发一遍）', async () => {
  const dir = tmp()
  const ob = fakeOb()
  const s = createReplySender({ ob, ownerId: 'x', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  writeFile(dir, '一句话\n')
  await s.tick()
  assert.equal(readFile(dir).trim(), '')
})

test('发失败 → 文件留着，下一轮还能补发（B 站 11-03 的坑）', async () => {
  const dir = tmp()
  const bad = fakeOb({ fail: true })
  const s = createReplySender({ ob: bad, ownerId: 'x', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  writeFile(dir, '这句得补发\n')
  const r = await s.tick()
  assert.equal(r.sent, 0)
  assert.equal(readFile(dir).trim(), '这句得补发', '失败了不能把话弄丢')

  const good = fakeOb()
  const s2 = createReplySender({ ob: good, ownerId: 'x', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  await s2.tick()
  assert.equal(good.sent.length, 1, '下一轮应该补发成功')
})

test('同一份内容不重发（防重复）', async () => {
  const dir = tmp()
  const ob = fakeOb()
  const s = createReplySender({ ob, ownerId: 'x', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  writeFile(dir, '只发一次\n')
  await s.tick()
  // 故意把同样的内容再写回去
  writeFile(dir, '只发一次\n')
  const r = await s.tick()
  assert.equal(r.sent, 0, '同样内容不该再来一遍')
  assert.equal(ob.sent.length, 1)
})

test('空文件 / 只有空行 → 什么都不发', async () => {
  const dir = tmp()
  const ob = fakeOb()
  const s = createReplySender({ ob, ownerId: 'x', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  writeFile(dir, '\n\n   \n')
  const r = await s.tick()
  assert.equal(r.sent, 0)
  assert.equal(ob.sent.length, 0)
})

test('文件不存在也不炸', async () => {
  const dir = tmp()
  const ob = fakeOb()
  const s = createReplySender({ ob, ownerId: 'x', workDir: dir, readConfig: () => ({ reply: { gapMs: 0 } }) })
  const r = await s.tick()
  assert.equal(r.sent, 0)
  assert.equal(r.skipped, 'empty')
})
