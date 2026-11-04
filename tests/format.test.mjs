import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readOverride, decideFormat } from '../lib/compose.js'

test('主人说「发语音」→ 认出来', () => {
  for (const t of ['发语音', '语音', '发个语音', '用语音回我', '语音吧']) {
    assert.deepEqual(readOverride(t), { kind: 'voice' }, t)
  }
})

test('主人说「发个表情包」→ 认出来', () => {
  for (const t of ['发个表情包', '来个表情', '表情包吧', '发表情']) {
    assert.deepEqual(readOverride(t), { kind: 'sticker' }, t)
  }
})

test('主人说「用文字」→ 认出来', () => {
  assert.deepEqual(readOverride('用文字回我'), { kind: 'text' })
})

test('普通聊天不会被误认成指定（很重要，别把每句话都当成指令）', () => {
  for (const t of ['今天好累', '你在干嘛呀', '我刚看到个超好笑的视频哈哈哈哈', '说说你的想法吧']) {
    assert.equal(readOverride(t), null, t)
  }
})

test('太长的不算指令（指令都很短）', () => {
  assert.equal(readOverride('我发语音给你听听这个'), null)
})

test('默认是 auto：按我自己挑的权重掷', () => {
  // 权重 text:8 voice:1 sticker:1 → 第一个 0.8 的区间是 text
  const fmt = { mode: 'auto', weights: { text: 8, voice: 1, sticker: 1 } }
  assert.equal(decideFormat({ format: fmt, rand: () => 0.1 }).kind, 'text')
  assert.equal(decideFormat({ format: fmt, rand: () => 0.85 }).kind, 'voice')
  assert.equal(decideFormat({ format: fmt, rand: () => 0.95 }).kind, 'sticker')
  assert.equal(decideFormat({ format: fmt, rand: () => 0.1 }).reason, 'weight')
})

test('控制台固定成语音 → 一直是语音', () => {
  const fmt = { mode: 'pinned', pinned: 'voice' }
  for (const r of [0, 0.5, 0.99]) {
    const got = decideFormat({ format: fmt, rand: () => r })
    assert.equal(got.kind, 'voice')
    assert.equal(got.reason, 'pinned')
  }
})

test('主人的临时指定优先于控制台的固定设置', () => {
  const fmt = { mode: 'pinned', pinned: 'text' }
  const got = decideFormat({ format: fmt, override: { kind: 'sticker', at: Date.now() } })
  assert.equal(got.kind, 'sticker')
  assert.equal(got.reason, 'override')
})

test('临时指定会过期（过了就回到我自己的选择）', () => {
  const fmt = { mode: 'auto', overrideTtlSec: 300, weights: { text: 1 } }
  const now = Date.now()
  const fresh = decideFormat({ format: fmt, override: { kind: 'voice', at: now - 1000 }, now, rand: () => 0 })
  assert.equal(fresh.kind, 'voice')
  const stale = decideFormat({ format: fmt, override: { kind: 'voice', at: now - 400_000 }, now, rand: () => 0 })
  assert.equal(stale.kind, 'text', '过期了就该回到默认')
})

test('权重全是 0 → 退回文字（别掷出个空）', () => {
  const got = decideFormat({ format: { mode: 'auto', weights: { text: 0, voice: 0 } }, rand: () => 0 })
  assert.equal(got.kind, 'text')
  assert.equal(got.reason, 'fallback')
})

test('配置是空的也能用（默认 auto + 文字为主）', () => {
  const got = decideFormat({ format: {}, rand: () => 0.5 })
  assert.equal(got.kind, 'text')
})
