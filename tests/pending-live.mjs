/**
 * pending-live.mjs —— 待审队列的端到端验证（假 OneBot，不碰真 QQ）
 *
 * 验的是最要紧的那条规矩：
 *   · **别人**发来的话 → 只进队列 + 给主人推一条提醒，**绝不直接回那个人** ✗
 *   · **主人**自己发的话 → 照旧投给会话 ✓
 *   · 主人点头（approve）→ 才真的发出去
 *
 * 用法：node tests/pending-live.mjs     退出码 0 = 全过
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS } from '../lib/index.js'
import { createPendingStore } from '../lib/pending.js'

const OWNER = '20002'
const STRANGER = '10001'
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`) } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1 }
}

// ── 假 OneBot ────────────────────────────────────────────────────────
const sent = []
let history = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const action = req.url.replace(/^\//, '')
    const params = body ? JSON.parse(body) : {}
    const ok = (data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', retcode: 0, data })) }
    if (action === 'get_friend_msg_history') return ok({ messages: history })
    if (action === 'send_private_msg') { sent.push(params); return ok({ message_id: 900 + sent.length }) }
    return ok(null)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${server.address().port}`

const DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-pending-live-'))
// 2026-11-04：运行时规则生效后，私聊默认在 B 站 → QQ 收到也不处理。
//   这个用例测的是「待审队列」，所以先把私聊设给 QQ ✓
fs.mkdirSync(path.join(DSH_HOME, 'whale-channels'), { recursive: true })
fs.writeFileSync(path.join(DSH_HOME, 'whale-channels', 'shared.json'), JSON.stringify({ dm: 'qq', dynamic: 'qq' }))
const cfg = { ...DEFAULTS, onebot: { baseUrl, token: '' }, owner: { uin: OWNER }, listen: { intervalSec: 0.2, backoffMaxSec: 1 } }

// 手工造一个「路由调用的环境」，直接调通道声明的 routes —— 不经过 DSH
function makeRouteCtx() {
  return {
    json: (res, code, payload) => { res.statusCode = code; res._body = payload },
    readBody: (req) => Promise.resolve(req._body ?? '{}'),
  }
}
async function callRoute(ch, key, body) {
  const handler = ch.routes[key]
  if (!handler) throw new Error(`没有路由 ${key}`)
  const res = {}
  await handler({ _body: body === undefined ? '{}' : JSON.stringify(body) }, res, makeRouteCtx())
  return { status: res.statusCode, body: res._body ?? JSON.parse(res._body_raw ?? 'null') }
}

console.log(`待审队列端到端（假 OneBot 在 ${baseUrl}）`)

const messages = []
const ch = buildChannel({
  dshHome: DSH_HOME,
  ctx: { emit: (name, msg) => messages.push({ name, msg }) },
  readConfig: () => cfg,
  log: () => {},
})
const handle = ch.start({})

const waitFor = async (pred, ms = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 100)) }
  return false
}

// 先等它把**基线**跑出来（第一次轮询只建基线，不通知）。
// ⚠️ 2026-11-04 踩的坑：这里原来只 sleep 800ms 就开始改 history，
//   可通道第一次轮询要等 1–3 秒的首次间隔 → 那次轮询读到的是已经改过的 history，
//   于是「旧消息」被当成基线吃掉，后面永远等不到新消息 ✗（测试假失败）
const stateFile = path.join(DSH_HOME, 'whale-channels', 'qq-state.json')
const baselined = await waitFor(() => {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).baselineDone === true } catch { return false }
})
if (!baselined) { console.log('  ✗ 基线圈没建起来，后面的用例没意义'); process.exit(1) }
console.log('  · 基线已建立')

await check('别人发来的话：不进会话，只进待审队列', async () => {
  history = [{ message_id: 11, time: Math.floor(Date.now() / 1000), sender: { user_id: STRANGER, nickname: '路人甲' }, message: [{ type: 'text', data: { text: '你是机器人吗' } }] }]
  const ok = await waitFor(() => {
    try { return JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'whale-channels', 'qq-pending-replies.json'), 'utf8')).items.length > 0 } catch { return false }
  })
  assert.ok(ok, '别人的消息没进待审队列')
  assert.equal(messages.filter((m) => m.msg.userId === STRANGER).length, 0, '别人说的不该进会话 ✗')
})

await check('给主人推了一条「等你审核」的提醒', async () => {
  const ok = await waitFor(() => sent.some((s) => String(s.user_id) === OWNER && String(s.message).includes('等你审核')))
  assert.ok(ok, '没给主人推提醒')
})

await check('没有自动回那个陌生人', async () => {
  const replied = sent.filter((s) => String(s.user_id) === STRANGER)
  assert.equal(replied.length, 0, '居然自动回了陌生人 ✗')
})

await check('主人自己发的话：照旧投给会话', async () => {
  const before = messages.length
  history = [
    ...history,
    { message_id: 12, time: Math.floor(Date.now() / 1000), sender: { user_id: OWNER, nickname: '主人' }, message: [{ type: 'text', data: { text: '在吗' } }] },
  ]
  const ok = await waitFor(() => messages.some((m) => m.msg.userId === OWNER))
  assert.ok(ok, '主人的话没投给会话')
})

await check('主人点头（approve）→ 才真的发出去，并且出队', async () => {
  const store = createPendingStore({ dshHome: DSH_HOME })
  const item = store.list()[0]
  assert.ok(item, '队列里没有待审')
  sent.length = 0
  const r = await callRoute(ch, 'POST /pending/approve', { id: item.id, text: '算是吧' })
  assert.equal(r.body.ok, true, JSON.stringify(r.body))
  const out = sent.find((s) => String(s.user_id) === STRANGER)
  assert.ok(out, '点头了却没发出去')
  assert.equal(out.message, '算是吧')
  assert.equal(store.list().length, 0, '发出去之后该出队')
})

await check('approve 一条不存在的 → 404', async () => {
  const r = await callRoute(ch, 'POST /pending/approve', { id: 'nope' })
  assert.equal(r.status, 404)
})

await check('drop 掉的一条：出待审列表，但记录还在', async () => {
  const store = createPendingStore({ dshHome: DSH_HOME })
  const added = store.add({ userId: STRANGER, messageId: 20, text: '加个群呗' })
  const r = await callRoute(ch, 'POST /pending/drop', { id: added.item.id, reason: '广告' })
  assert.equal(r.body.ok, true)
  assert.equal(store.list().length, 0)
  assert.equal(store.list({ status: 'dropped' }).length, 1)
})

handle.stop()
server.close()
console.log(`\n通过 ${passed} 项${process.exitCode ? '，有失败 ✗' : '，全过 ✓'}`)
process.exit(process.exitCode ?? 0)
