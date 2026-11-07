import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOneBot, normalizeId, readIncoming, messageText, stripCQ, OneBotError } from '../lib/onebot.js'

function fakeFetch(map) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const key = Object.keys(map).find((k) => url.endsWith(k))
    if (!key) return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: null }) }
    const v = map[key]
    if (typeof v === 'function') return v(url, init)
    return { ok: true, status: 200, json: async () => v }
  }
  fn.calls = calls
  return fn
}

test('send_private_msg：带 token 就带 Authorization，不带就不带', async () => {
  const f = fakeFetch({ send_private_msg: { status: 'ok', retcode: 0, data: { message_id: 42 } } })
  const ob = createOneBot({ baseUrl: 'http://127.0.0.1:3000/', token: 'tk', fetchImpl: f })
  const data = await ob.sendPrivate('20002', '早')
  assert.equal(data.message_id, 42)
  assert.equal(f.calls[0].url, 'http://127.0.0.1:3000/send_private_msg')
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer tk')
  assert.equal(f.calls[0].body.user_id, '20002')
  assert.equal(f.calls[0].body.message, '早')

  const g = fakeFetch({})
  const ob2 = createOneBot({ baseUrl: 'http://127.0.0.1:3000', fetchImpl: g })
  await ob2.sendPrivate('1234567', 'x')
  assert.equal(g.calls[0].init.headers.authorization, undefined)
})

test('retcode 非 0 要抛错，不能当成成功', async () => {
  const f = fakeFetch({ send_private_msg: { status: 'failed', retcode: 100, wording: '号不存在' } })
  const ob = createOneBot({ baseUrl: 'http://127.0.0.1:3000', fetchImpl: f })
  await assert.rejects(() => ob.sendPrivate('1234567', 'x'), (e) => {
    assert.ok(e instanceof OneBotError)
    assert.equal(e.code, 100)
    assert.match(e.message, /号不存在/)
    return true
  })
})

test('连不上时给的是「客户端开了吗」，不是裸 ECONNREFUSED', async () => {
  const f = async () => { throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }) }
  const ob = createOneBot({ baseUrl: 'http://127.0.0.1:3999', fetchImpl: f })
  await assert.rejects(() => ob.getStatus(), /连不上 OneBot.*客户端开了吗/)
})

test('normalizeId 拒绝不像号的东西（不吃 0 开头的号）', () => {
  assert.equal(normalizeId(1234567), '1234567')
  assert.equal(normalizeId('0123456'), '0123456')
  assert.throws(() => normalizeId('abc'), OneBotError)
  assert.throws(() => normalizeId(''), OneBotError)
})

test('只认私信：群消息 / 自己发的 / 撤回都不算', () => {
  assert.equal(readIncoming({ post_type: 'message', message_type: 'group', message: 'hi', user_id: '1' }), null)
  assert.equal(readIncoming({ post_type: 'message_sent', message_type: 'private', message: 'hi', user_id: '1' }), null)
  assert.equal(readIncoming({ post_type: 'notice', notice_type: 'friend_recall' }), null)
  const got = readIncoming({ post_type: 'message', message_type: 'private', user_id: 42, time: 1793748250, message: [{ type: 'text', data: { text: '早啊' } }], sender: { nickname: '主人' }, message_id: 9 })
  assert.equal(got.text, '早啊')
  assert.equal(got.userId, '42')
  assert.equal(got.nickname, '主人')
  assert.equal(got.messageId, 9)
})

test('CQ 码被剥掉，图片/表情不留 []', () => {
  assert.equal(stripCQ('[CQ:face,id=14]哈哈哈'), '哈哈哈')
  assert.equal(messageText({ message: '好的[CQ:image,file=x.jpg]' }), '好的')
  assert.equal(messageText({ message: [{ type: 'image', data: {} }, { type: 'text', data: { text: '看图' } }] }), '看图')
})
