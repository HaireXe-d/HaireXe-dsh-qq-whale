/**
 * rules-live.mjs —— 「私聊只能一个」在**运行时**真的生效（以前只有控制台生效）
 *
 * 2026-11-04 发现的真问题：
 *   shared.json 里写着「私聊给 QQ」，可 QQ 通道的收信循环根本不看它 →
 *   两个通道都开着的时候两边会同时叫醒她，说的话互相打架 ✗
 *
 * 这个用例证明修好了：私聊在 B 站时，QQ 收到主人消息**不叫醒**。
 *
 * 用法：node tests/rules-live.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS } from '../lib/index.js'

const OWNER = '30003'
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`) } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1 }
}

let history = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const action = req.url.replace(/^\//, '')
    const ok = (data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', retcode: 0, data })) }
    if (action === 'get_friend_msg_history') return ok({ messages: history })
    return ok(null)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${server.address().port}`

const DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-rules-live-'))
fs.mkdirSync(path.join(DSH_HOME, 'whale-channels'), { recursive: true })

const prompted = []
const controller = { async create() {}, async prompt(r) { prompted.push(r) } }
const cfg = { ...DEFAULTS, onebot: { baseUrl, token: '' }, owner: { uin: OWNER }, listen: { intervalSec: 0.2, backoffMaxSec: 1 } }

const stateFile = path.join(DSH_HOME, 'whale-channels', 'qq-state.json')
const waitFor = async (pred, ms = 10000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 100)) }
  return false
}

const ch = buildChannel({ dshHome: DSH_HOME, ctx: {}, readConfig: () => cfg, log: () => {} })
const handle = ch.start({ sessionController: controller })

console.log('「私聊只能一个」运行时生效验证')

const baselined = await waitFor(() => {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).baselineDone === true } catch { return false }
})
if (!baselined) { console.log('  ✗ 基线圈没建起来'); process.exit(1) }
console.log('  · 基线已建立')

let mid = 30
const say = async (text) => {
  mid += 1
  history = [...history, { message_id: mid, time: Math.floor(Date.now() / 1000), sender: { user_id: OWNER, nickname: '主人' }, message: [{ type: 'text', data: { text } }] }]
  // 等它轮询一次
  await new Promise((r) => setTimeout(r, 700))
}

await check('私聊在 B 站（默认）→ QQ 收到也不叫醒她', async () => {
  fs.writeFileSync(path.join(DSH_HOME, 'whale-channels', 'shared.json'), JSON.stringify({ dm: 'bili', dynamic: 'bili' }))
  const before = prompted.length
  await say('这条应该不会被投递')
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(prompted.length, before, '私聊归 B 站时 QQ 不该叫醒 ✗')
})

await check('把私聊改给 QQ → 立刻生效（不用重启）', async () => {
  fs.writeFileSync(path.join(DSH_HOME, 'whale-channels', 'shared.json'), JSON.stringify({ dm: 'qq', dynamic: 'qq' }))
  const before = prompted.length
  await say('这条应该被投递')
  const ok = await waitFor(() => prompted.length > before, 6000)
  assert.ok(ok, '改给 QQ 之后还是没叫醒')
})

await check('再改回 B 站 → 又不叫醒了', async () => {
  fs.writeFileSync(path.join(DSH_HOME, 'whale-channels', 'shared.json'), JSON.stringify({ dm: 'bili', dynamic: 'bili' }))
  const before = prompted.length
  await say('这条又不该被投递')
  await new Promise((r) => setTimeout(r, 900))
  assert.equal(prompted.length, before)
})

handle.stop()
server.close()
console.log(`\n通过 ${passed} 项${process.exitCode ? '，有失败 ✗' : '，全过 ✓'}`)
process.exit(process.exitCode ?? 0)
