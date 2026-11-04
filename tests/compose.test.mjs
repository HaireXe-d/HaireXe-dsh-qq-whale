import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseLine, planReply, materializeMessage } from '../lib/compose.js'
import { createStickerLibrary } from '../lib/sticker.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qq-compose-'))
const fakeGif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(300, 7)])

test('解析：普通一行还是文字', () => {
  assert.deepEqual(parseLine('早啊主人'), { kind: 'text', text: '早啊主人' })
})

test('解析：[语音] 后面是正文', () => {
  assert.deepEqual(parseLine('[语音] 主人早上好'), { kind: 'voice', text: '主人早上好' })
})

test('解析：[表情] 单独一个，没有配文', () => {
  assert.deepEqual(parseLine('[表情]'), { kind: 'sticker', text: '' })
})

test('解析：[表情，配文] 中英逗号都认', () => {
  assert.deepEqual(parseLine('[表情，好可爱]'), { kind: 'sticker', text: '好可爱' })
  assert.deepEqual(parseLine('[表情, 好可爱]'), { kind: 'sticker', text: '好可爱' })
})

test('解析：[表情] 空格后面跟一句话', () => {
  assert.deepEqual(parseLine('[表情] 这谁顶得住'), { kind: 'sticker', text: '这谁顶得住' })
})

test('整个回复文件：一行一条，最多 maxLines 条', () => {
  const plans = planReply('[语音] 早\n好呀\n[表情]\n', { maxLines: 6 })
  assert.deepEqual(plans.map((p) => p.kind), ['voice', 'text', 'sticker'])
  assert.equal(planReply(Array.from({ length: 10 }, (_, i) => `第${i}句`).join('\n'), { maxLines: 6 }).length, 6)
})

test('文字：照常发', async () => {
  const r = await materializeMessage({ plan: { kind: 'text', text: '早' }, stickers: null })
  assert.equal(r.ok, true)
  assert.equal(r.message, '早')
})

test('空行：不发', async () => {
  const r = await materializeMessage({ plan: { kind: 'text', text: '' } })
  assert.equal(r.ok, false)
})

test('语音：转得出来才发 CQ record', async () => {
  const r = await materializeMessage({
    plan: { kind: 'voice', text: '早' },
    voiceDir: tmp(),
    makeVoiceImpl: async () => ({ ok: true, file: 'C:\\x\\v.amr', format: 'amr' }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'voice')
  assert.match(r.message, /^\[CQ:record,file=/)
})

test('语音：转不出来就报错，绝不发个放不出声的文件', async () => {
  const r = await materializeMessage({
    plan: { kind: 'voice', text: '早' },
    voiceDir: tmp(),
    makeVoiceImpl: async () => ({ ok: false, error: '没带 amr 编码器', wav: 'C:\\x\\v.wav' }),
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /amr/)
  assert.equal(r.message, undefined, '失败时不许有 message')
})

test('表情：库空的时候不发（不硬塞）', async () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  const r = await materializeMessage({ plan: { kind: 'sticker', text: '' }, stickers: lib })
  assert.equal(r.ok, false)
  assert.match(r.error, /没有表情包/)
})

test('表情：库里有就发 CQ image，配文拼在前头', async () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  lib.saveSticker({ data: fakeGif() })
  const r = await materializeMessage({ plan: { kind: 'sticker', text: '好可爱' }, stickers: lib })
  assert.equal(r.ok, true)
  assert.equal(r.message.startsWith('好可爱'), true)
  assert.match(r.message, /\[CQ:image,file=/)
})

test('文字掷中表情包：拼在后面', async () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  lib.saveSticker({ data: fakeGif() })
  const r = await materializeMessage({ plan: { kind: 'text', text: '给你看' }, stickers: lib, rand: () => 0 })
  assert.equal(r.kind, 'text+sticker')
  assert.equal(r.message.startsWith('给你看'), true)
  assert.match(r.message, /\[CQ:image,file=/)
})

test('文字没掷中：就是纯文字', async () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  lib.saveSticker({ data: fakeGif() })
  const r = await materializeMessage({ plan: { kind: 'text', text: '给你看' }, stickers: lib, rand: () => 0.99 })
  assert.equal(r.kind, 'text')
  assert.equal(r.message, '给你看')
})

test('表情功能关掉之后，[表情] 不发', async () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  lib.saveSticker({ data: fakeGif() })
  const r = await materializeMessage({ plan: { kind: 'sticker', text: '' }, stickers: lib, opts: { sticker: { enabled: false } } })
  assert.equal(r.ok, false)
})
