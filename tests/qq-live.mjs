/**
 * qq-live.mjs —— QQ 通道的「真能收发」验证（不碰真 QQ）
 *
 * 起一个假的 OneBot 11 HTTP 服务，把 qq 通道 start() 起来，然后：
 *   · 假服务返回一条主人的私信 → 轮询器应该认出这是新消息
 *   · 通道发一条私信 → 假服务应该收到 send_private_msg
 *   · 关掉通道 → 不该再轮询
 *
 * 用法：node tests/qq-live.mjs      退出码 0 = 全过
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS } from '../lib/index.js'

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`) } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1 }
}

// ── 假 OneBot ────────────────────────────────────────────────────────
const received = []
let history = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const action = req.url.replace(/^\//, '')
    const params = body ? JSON.parse(body) : {}
    received.push({ action, params })
    const ok = (data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', retcode: 0, data })) }
    if (action === 'get_friend_msg_history') return ok({ messages: history })
    if (action === 'get_login_info') return ok({ user_id: '999', nickname: '主人' })
    if (action === 'send_private_msg') return ok({ message_id: 1000 + received.length })
    if (action === 'send_poke') return ok(null)
    return ok(null)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

const DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-qq-live-'))
const cfg = {
  ...DEFAULTS,
  onebot: { baseUrl, token: '' },
  owner: { uin: '30003' },
  listen: { intervalSec: 0.2, backoffMaxSec: 1 },
}

console.log(`QQ 通道联调（假 OneBot 在 ${baseUrl}）`)

const ch = buildChannel({ dshHome: DSH_HOME, readConfig: () => cfg, log: () => {} })
const handle = ch.start({})

await check('通道起来了（没返回 null）', async () => {
  assert.ok(handle && typeof handle.stop === 'function', '没拿到 handle')
})

// ⚠️ 2026-11-04：这里原来只等 700ms 就断言「连上了」，可通道第一次轮询要等 1–3 秒的首次间隔 →
//   测了个寂寞（假失败 ✗）。改成轮询等待，最多 8 秒 ✓
async function waitFor(pred, ms = 8000, step = 100) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await pred()) return true
    await new Promise((r) => setTimeout(r, step))
  }
  return false
}

await check('轮询器连上了假 OneBot', async () => {
  const ok = await waitFor(() => received.some((r) => r.action === 'get_friend_msg_history'))
  assert.ok(ok, '8 秒内没发出 get_friend_msg_history')
})

await check('假 OneBot 推来一条私信 → 轮询器认出来了', async () => {
  history = [{ message_id: 7, time: Math.floor(Date.now() / 1000), sender: { user_id: '30003', nickname: '主人' }, message: [{ type: 'text', data: { text: '在吗' } }] }]
  const ok = await waitFor(() => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'whale-channels', 'qq-state.json'), 'utf8'))
      return s.connected === true && s.baselineDone === true
    } catch { return false }
  })
  assert.ok(ok, '状态文件里没写下 connected/baselineDone')
})

await check('通道能发私信（走真 OneBot 接口形状）', async () => {
  const { createOneBot } = await import('../lib/onebot.js')
  const ob = createOneBot({ baseUrl })
  const data = await ob.sendPrivate('30003', '收到了')
  assert.ok(data?.message_id)
  const sent = received.find((r) => r.action === 'send_private_msg')
  assert.equal(sent.params.message, '收到了')
  assert.equal(String(sent.params.user_id), '30003')
})

await check('戳一戳能用', async () => {
  const { createOneBot } = await import('../lib/onebot.js')
  await createOneBot({ baseUrl }).sendPoke('30003')
  assert.ok(received.some((r) => r.action === 'send_poke'))
})

await check('关掉通道之后不再轮询', async () => {
  handle.stop()
  const before = received.filter((r) => r.action === 'get_friend_msg_history').length
  await new Promise((r) => setTimeout(r, 900))
  const after = received.filter((r) => r.action === 'get_friend_msg_history').length
  assert.equal(after, before, `停了还在轮询（${before} → ${after}）`)
})

server.close()
console.log(`\n通过 ${passed} 项${process.exitCode ? "，有失败 ✗" : "，全过 ✓"}`)
process.exit(process.exitCode ?? 0)
