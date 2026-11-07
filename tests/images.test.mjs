import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeHistory } from '../lib/poller.js'
import { sniffImageExt, saveIncomingImages } from '../lib/incoming-images.js'

const ME = '2584946746'
const OWNER = '2040367971'

const imgMsg = (id, extra = {}) => ({
  post_type: 'message',
  message_id: id,
  time: Math.floor(Date.now() / 1000),
  sender: { user_id: OWNER, nickname: '祖' },
  message: [{ type: 'image', data: { file: '213E1DD3.jpg', url: 'https://example.invalid/x', summary: '[动画表情]', file_size: '98363', ...extra } }],
})

test('2026-11-04 回归：纯图片消息不能再被丢掉', () => {
  const out = normalizeHistory({ messages: [imgMsg(1)] }, { selfId: ME })
  assert.equal(out.length, 1, '纯图消息必须能进来（18:38 那张就是这么丢的）')
  assert.equal(out[0].text, '')
  assert.equal(out[0].images.length, 1)
  assert.equal(out[0].images[0].summary, '[动画表情]')
  assert.ok(out[0].images[0].url.includes('example.invalid'))
})

test('带文字 + 图：文字和图都要', () => {
  const m = imgMsg(2)
  m.message.unshift({ type: 'text', data: { text: '看这个' } })
  const out = normalizeHistory({ messages: [m] }, { selfId: ME })
  assert.equal(out[0].text, '看这个')
  assert.equal(out[0].images.length, 1)
})

test('没有 url 也没有 file 的图段不算图', () => {
  const out = normalizeHistory({ messages: [imgMsg(3, { url: '', file: '' })] }, { selfId: ME })
  assert.equal(out.length, 0, '连 url/file 都没有的图段，本来就没什么可存的')
})

test('我自己发的图照旧被剔掉（不重复刷屏那条）', () => {
  const m = imgMsg(4)
  m.post_type = 'message_sent'
  const out = normalizeHistory({ messages: [m] }, { selfId: ME })
  assert.equal(out.length, 0)
})

test('normalizeHistory 现在会带 messageId 出来（日志里的 msg=? 就是因为没有它）', () => {
  const out = normalizeHistory({ messages: [imgMsg(5)] }, { selfId: ME })
  assert.equal(out[0].messageId, 5)
})

test('sniffImageExt：按文件头认格式，不信扩展名', () => {
  // 18:38 那张：名字 .jpg，内容其实是 GIF89a
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(20)])
  assert.equal(sniffImageExt(gif), 'gif')
  assert.equal(sniffImageExt(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)])), 'jpg')
  assert.equal(sniffImageExt(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(12)])), 'png')
  assert.equal(sniffImageExt(Buffer.from('not an image at all!!')), null)
})

test('每张图单独算成功/失败，一张坏了不影响另一张', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-img-'))
  const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64)])
  let n = 0
  const fetchImpl = async () => {
    n += 1
    if (n === 1) return { ok: false, status: 404 }
    return { ok: true, arrayBuffer: async () => gif }
  }
  const out = await saveIncomingImages({
    images: [{ url: 'a', summary: 'A' }, { url: 'b', summary: 'B' }],
    outDir: dir,
    fetchImpl,
  })
  assert.equal(out.length, 2)
  assert.equal(out[0].ok, false)
  assert.equal(out[1].ok, true)
  assert.equal(out[1].ext, 'gif')
  assert.ok(fs.existsSync(out[1].path), '成功的那张要真落盘')
})
