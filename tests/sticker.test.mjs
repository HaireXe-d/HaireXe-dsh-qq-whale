import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStickerLibrary, toCQImage } from '../lib/sticker.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qq-sticker-'))
// 造一个假 gif（只要 >100 字节，判据看的是大小不是真解码）
const fakeGif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(300, 7)])

test('存一个表情包：文件落盘 + 进库', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  const r = lib.saveSticker({ data: fakeGif(), mime: 'image/gif', source: '主人发的', note: '这个好笑' })
  assert.equal(r.ok, true)
  assert.equal(fs.existsSync(r.item.file), true)
  assert.equal(lib.list().length, 1)
  assert.equal(r.remainingToday, 0)
})

test('一天最多存一个（主人定的）', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  const now = new Date('2026-11-04T10:00:00')
  const a = lib.saveSticker({ data: fakeGif(), now })
  const b = lib.saveSticker({ data: fakeGif(), now })
  assert.equal(a.ok, true)
  assert.equal(b.ok, false)
  assert.match(b.reason, /一天最多 1 个/)
  assert.equal(lib.list().length, 1, '被拦下的不该落盘进库')
})

test('第二天又能存一个', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  lib.saveSticker({ data: fakeGif(), now: new Date('2026-11-04T10:00:00') })
  const r = lib.saveSticker({ data: fakeGif(), now: new Date('2026-11-05T00:10:00') })
  assert.equal(r.ok, true)
  assert.equal(lib.list().length, 2)
})

test('不认识的类型、太小的、太大的都拒（别把坏东西存进库）', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  assert.equal(lib.saveSticker({ data: fakeGif(), mime: 'application/pdf' }).ok, false)
  assert.equal(lib.saveSticker({ data: Buffer.alloc(10) }).ok, false)
  const big = Buffer.alloc(9 * 1024 * 1024, 1)
  assert.match(lib.saveSticker({ data: big }).reason, /太大/)
})

test('关掉功能之后一个都不让存', () => {
  const lib = createStickerLibrary({ dshHome: tmp(), opts: { enabled: false } })
  const r = lib.saveSticker({ data: fakeGif() })
  assert.equal(r.ok, false)
  assert.match(r.reason, /关着/)
})

test('库里空的时候 pickRandom 返回 null（不硬塞）', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  assert.equal(lib.pickRandom(), null)
  assert.equal(lib.shouldSend(() => 0), false, '空库不该掷中')
})

test('有表情包之后能挑出来，并且每次挑到的都在库里', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  const now = new Date('2026-11-04T10:00:00')
  lib.saveSticker({ data: fakeGif(), now })
  const picked = lib.pickRandom(() => 0)
  assert.ok(picked)
  assert.equal(lib.list().some((x) => x.id === picked.id), true)
})

test('文件被删了的不算进挑选（别挑到空路径）', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  const { item } = lib.saveSticker({ data: fakeGif() })
  fs.unlinkSync(item.file)
  assert.equal(lib.pickRandom(() => 0), null)
})

test('shouldSend 按概率掷，0 永远不发', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  lib.saveSticker({ data: fakeGif() })
  assert.equal(lib.shouldSend(() => 0.99), false)
  assert.equal(lib.shouldSend(() => 0), true)
})

test('remove 连文件一起删', () => {
  const lib = createStickerLibrary({ dshHome: tmp() })
  const { item } = lib.saveSticker({ data: fakeGif() })
  lib.remove(item.id)
  assert.equal(fs.existsSync(item.file), false)
  assert.equal(lib.list().length, 0)
})

test('CQ 码里的特殊字符要转义（不然整条消息会拆坏）', () => {
  const cq = toCQImage('C:\\a,b[1]&c.gif')
  // CQ 码本身就用逗号分段（[CQ:image,file=] 那个逗号是格式的一部分），所以只验内容里的逗号被转义了
  assert.equal(cq.includes('a&#44;b'), true)
  assert.match(cq, /&#44;/)
  assert.match(cq, /&#91;/)
})
