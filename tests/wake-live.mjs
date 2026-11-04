/**
 * wake-live.mjs —— 叫醒她的端到端验证（假 OneBot + 假 sessionController）
 *
 * 验的是最后那一环：**QQ 收到主人的私信 → 真的投进 DSH 会话** ✓
 *
 * 用法：node tests/wake-live.mjs     退出码 0 = 全过
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS } from '../lib/index.js'

const OWNER = '30003'
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
    if (action === 'send_private_msg') { sent.push(params); return ok({ message_id: 500 + sent.length }) }
    return ok(null)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${server.address().port}`

// ── 假 DSH sessionController ─────────────────────────────────────────
const prompted = []
const controller = {
  async create({ sessionId }) { return { sessionId } },
  async prompt(req) { prompted.push(req) },
}

const DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-wake-live-'))
// 2026-11-04：运行时规则生效后，私聊默认在 B 站 → QQ 收到也不叫醒。
//   这个用例测的是「叫醒」本身，所以先把私聊设给 QQ ✓
fs.mkdirSync(path.join(DSH_HOME, 'whale-channels'), { recursive: true })
fs.writeFileSync(path.join(DSH_HOME, 'whale-channels', 'shared.json'), JSON.stringify({ dm: 'qq', dynamic: 'qq' }))
const cfg = { ...DEFAULTS, onebot: { baseUrl, token: '' }, owner: { uin: OWNER }, listen: { intervalSec: 0.2, backoffMaxSec: 1 } }

const ch = buildChannel({
  dshHome: DSH_HOME,
  ctx: { emit: () => {} },
  readConfig: () => cfg,
  log: () => {},
})
const handle = ch.start({ sessionController: controller })

const stateFile = path.join(DSH_HOME, 'whale-channels', 'qq-state.json')
const wakeFile = path.join(DSH_HOME, 'whale-channels', 'qq-wake-state.json')
const waitFor = async (pred, ms = 10000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 100)) }
  return false
}

console.log(`叫醒端到端（假 OneBot ${baseUrl} + 假 sessionController）`)

const baselined = await waitFor(() => {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).baselineDone === true } catch { return false }
})
if (!baselined) { console.log('  ✗ 基线圈没建起来'); process.exit(1) }
console.log('  · 基线已建立')

await check('主人发来一条 → 真的投进会话了', async () => {
  history = [{ message_id: 21, time: Math.floor(Date.now() / 1000), sender: { user_id: OWNER, nickname: '主人' }, message: [{ type: 'text', data: { text: '在干嘛' } }] }]
  const ok = await waitFor(() => prompted.some((p) => String(p.content[0].text).includes('在干嘛')))
  assert.ok(ok, '没投进会话 —— 人还是哑的')
})

await check('投进去的内容带了「QQ 私信」和回话指引', async () => {
  const hit = prompted.find((p) => String(p.content[0].text).includes('在干嘛'))
  const text = String(hit.content[0].text)
  assert.match(text, /QQ 私信/)
  assert.match(text, /dm-reply-qq\.txt/)
  assert.equal(hit.mode, 'queue')
})

await check('同一条不会投两遍', async () => {
  const before = prompted.length
  await new Promise((r) => setTimeout(r, 1200))   // 让它再轮询几轮
  assert.equal(prompted.length, before, `重复投递了（${before} → ${prompted.length}）`)
})

await check('唤醒状态落盘了（重启也不会重投）', async () => {
  const st = JSON.parse(fs.readFileSync(wakeFile, 'utf8'))
  assert.ok(Array.isArray(st.seen) && st.seen.length > 0)
})

await check('陌生人发来的：不投进会话（走待审）', async () => {
  const before = prompted.length
  history = [
    ...history,
    { message_id: 22, time: Math.floor(Date.now() / 1000), sender: { user_id: STRANGER, nickname: '路人' }, message: [{ type: 'text', data: { text: '你好呀' } }] },
  ]
  await waitFor(() => {
    try { return JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'whale-channels', 'qq-pending-replies.json'), 'utf8')).items.length > 0 } catch { return false }
  })
  assert.equal(prompted.length, before, '陌生人说的不该叫醒她 ✗')
})

await check('主人再说一条 → 又能叫醒（不是只认第一条）', async () => {
  history = [
    ...history,
    { message_id: 23, time: Math.floor(Date.now() / 1000), sender: { user_id: OWNER, nickname: '主人' }, message: [{ type: 'text', data: { text: '第二句' } }] },
  ]
  const ok = await waitFor(() => prompted.some((p) => String(p.content[0].text).includes('第二句')))
  assert.ok(ok, '第二条没叫醒')
})

handle.stop()
server.close()
console.log(`\n通过 ${passed} 项${process.exitCode ? '，有失败 ✗' : '，全过 ✓'}`)
process.exit(process.exitCode ?? 0)
