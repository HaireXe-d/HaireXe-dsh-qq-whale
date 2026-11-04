import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadPersonaText, personaFingerprint, buildWakePrefix,
  shouldBeProactive, proactiveMessage, proactiveCounter,
} from '../lib/proactive.js'

test('loadPersonaText：读得到就读，读不到返回空串（不能炸）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'))
  assert.equal(loadPersonaText({ homeDir: home }), '', '没有文件 → 空串')
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'persona.md'), '  我是邦邦  \n')
  assert.equal(loadPersonaText({ homeDir: home }), '我是邦邦', '去空白')
})

test('loadPersonaText：超过 maxChars 就截断', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'))
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'persona.md'), 'x'.repeat(100))
  assert.equal(loadPersonaText({ homeDir: home, maxChars: 10 }).length, 10)
  assert.equal(loadPersonaText({ homeDir: home, maxChars: 0 }).length, 100, '0 = 不截断')
})

test('personaFingerprint：同文同指纹，改一个字就变', () => {
  const a = personaFingerprint('我是邦邦')
  assert.equal(a, personaFingerprint('我是邦邦'))
  assert.notEqual(a, personaFingerprint('我是邦邦2'))
  assert.equal(a.length, 16)
})

test('buildWakePrefix：首次投递带完整人设 + 日记指引', () => {
  const s = buildWakePrefix({ persona: '我是邦邦', includePersona: true, includeDiary: true, dshHome: '/dsh' })
  assert.match(s, /我是邦邦/)
  assert.match(s, /whale-diary\.md/)
  assert.match(s, /whale-diary-private\.md/)
  assert.match(s, /whale-rules\.md/)
})

test('buildWakePrefix：非首次只给人设依据，不重复正文', () => {
  const s = buildWakePrefix({ persona: '我是邦邦', includePersona: false, includeDiary: false, dshHome: '/dsh' })
  assert.doesNotMatch(s, /^我是邦邦$/m)
  assert.match(s, /人设依据：.*persona\.md/)
})

test('buildWakePrefix：没有人设也不报错', () => {
  const s = buildWakePrefix({ persona: '', includePersona: true, includeDiary: true, dshHome: '/dsh' })
  assert.ok(typeof s === 'string')
  assert.ok(!s.includes('人设依据'), '没人设就别瞎指路')
})

test('shouldBeProactive：概率 0 → 不主动', () => {
  assert.equal(shouldBeProactive({ chance: 0, dailyMax: 5 }).should, false)
})

test('shouldBeProactive：每天封顶', () => {
  const r = shouldBeProactive({ chance: 1, dailyMax: 2, sentToday: 2, random: () => 0 })
  assert.equal(r.should, false)
  assert.match(r.reason, /上限 2/)
})

test('shouldBeProactive：主人刚说过话就不打扰', () => {
  const now = Date.now()
  const r = shouldBeProactive({ chance: 1, dailyMax: 5, sentToday: 0, lastUserAt: now - 5 * 60000, now, random: () => 0 })
  assert.equal(r.should, false)
  assert.match(r.reason, /刚说过话/)
})

test('shouldBeProactive：隔够久了就可以主动', () => {
  const now = Date.now()
  const r = shouldBeProactive({ chance: 1, dailyMax: 5, sentToday: 0, lastUserAt: now - 60 * 60000, now, random: () => 0 })
  assert.equal(r.should, true)
})

test('shouldBeProactive：随机没抽中就等下次', () => {
  const r = shouldBeProactive({ chance: 0.5, dailyMax: 5, sentToday: 0, random: () => 0.9 })
  assert.equal(r.should, false)
  assert.match(r.reason, /没抽中/)
})

test('proactiveMessage：说清是主动的，并给发消息的办法', () => {
  const m = proactiveMessage({ sentToday: 0 })
  assert.match(m, /主动/)
  assert.match(m, /dm-reply-qq\.txt/)
  assert.match(m, /\[语音\]/)
  assert.match(m, /\[表情\]/)
})

test('proactiveCounter：跨天归零', () => {
  const today = proactiveCounter({}, Date.now())
  assert.equal(today.sentToday, 0)
  const old = proactiveCounter({ dayKey: '2000-01-01', sentToday: 9 }, Date.now())
  assert.equal(old.sentToday, 0, '不是今天 → 归零')
})
