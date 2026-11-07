/**
 * 2026-11-04 晚 · QQ 私信「收得到但没人回」的回归用例（假 OneBot 端到端，不碰真 QQ）
 *
 * 主人原话：「你QQ回私信也和哔站一样想回就回，叫醒你只影响主动发信息和动态」
 *
 * 那天 17:50 他发了一条，NapCat 收到了、`qq-state.json` 里也记了 seen，
 * 但他一条回复都没等到。真因：
 *
 *   `export default { name, inject: ['webServer'] }`  —— **没 inject sessionController**
 *   → DSH 不给没 inject 的服务 → `hostCtx.sessionController` / `ctx.sessionController` 全是 undefined
 *   → waker 建不起来 → 只写了一行日志
 *   → 消息还照样进 seen（看着像处理完了），人是哑的 ✗
 *
 * 这个用例盯三件事：
 *   ① 插件必须 inject sessionController（缺了就是哑的，别再抄漏）
 *   ② controller 在 → 主人私信**真的投进会话**（能拿到 prompt，内容里有原文）
 *   ③ controller 不在 → 必须留痕（qq-wake-error.txt），不许静默
 *
 * 用法：node tests/reply-path.mjs     退出码 0 = 全过
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS } from '../lib/index.js'

const OWNER = '20002'
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`) } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1 }
}

// ── 假 OneBot ────────────────────────────────────────────────────────
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

/** 造一个「会记账」的 sessionController */
function stubController({ fail = false } = {}) {
  const calls = { create: 0, prompt: [] }
  return {
    calls,
    async create() { calls.create += 1; return { sessionId: 'bili-whale' } },
    async prompt(req) { if (fail) throw new Error('投不进去'); calls.prompt.push(req) },
  }
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-reply-'))
  fs.mkdirSync(path.join(home, 'whale-channels'), { recursive: true })
  // 私聊归 QQ —— 不然运行时规则会直接拦掉
  fs.writeFileSync(path.join(home, 'whale-channels', 'shared.json'), JSON.stringify({ dm: 'qq', dynamic: 'qq' }))
  return home
}

const cfgFor = () => ({ ...DEFAULTS, onebot: { baseUrl, token: '' }, owner: { ...DEFAULTS.owner, uin: OWNER }, listen: { intervalSec: 0.2, backoffMaxSec: 1 } })

const waitFor = async (pred, ms = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 100)) }
  return false
}

/** 起一个通道，等基线建好，然后塞一条主人消息，等投递 */
async function runChannel({ dshHome, controller, ctxController }) {
  history = []
  const ch = buildChannel({
    dshHome,
    ctx: { sessionController: ctxController ?? null },
    readConfig: cfgFor,
    log: () => {},
  })
  const handle = ch.start({ sessionController: controller ?? null })

  const stateFile = path.join(dshHome, 'whale-channels', 'qq-state.json')
  const baselined = await waitFor(() => {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).baselineDone === true } catch { return false }
  })
  if (!baselined) throw new Error('基线圈没建起来')

  history = [{
    message_id: 1307912222,
    time: Math.floor(Date.now() / 1000),
    sender: { user_id: OWNER, nickname: '主人' },
    message: [{ type: 'text', data: { text: '邦邦，测试一下，用这个QQ号能收到我消息吗' } }],
  }]
  return { ch, handle, stateFile }
}

console.log(`QQ 私信回话这条路（假 OneBot 在 ${baseUrl}）`)

await check('① 插件 inject 里有 sessionController', async () => {
  const mod = await import('../lib/index.js')
  const inject = mod.default?.inject ?? []
  assert.ok(
    inject.includes('sessionController'),
    'inject 里必须有 sessionController：DSH 不给没 inject 的服务，' +
    '缺了 controller 就永远建不起 waker —— 消息收得到、人却哑着',
  )
})

let handled = null
await check('② controller 在 → 主人私信真的投进会话（不是只记 seen）', async () => {
  const done = stubController()
  const dshHome = makeHome()
  const { handle } = await runChannel({ dshHome, controller: done })
  handled = handle
  const ok = await waitFor(() => done.calls.prompt.length > 0)
  assert.ok(ok, '收到了消息但没投进会话 ✗（又变回「收得到、叫不醒」了）')
  const text = String(done.calls.prompt[0].content[0].text)
  assert.match(text, /邦邦，测试一下/, '投进去的正文里要有他说的原文')
  assert.match(text, /QQ 私信/, '要标清楚这是 QQ 来的')
  const wake = path.join(dshHome, 'whale-channels', 'qq-wake-state.json')
  assert.ok(fs.existsSync(wake), '投递成功后应该落盘 qq-wake-state.json（不然重启就重投）')
})

await check('③ controller 不在（宿主没 inject）→ 留痕，不许静默', async () => {
  const dshHome = makeHome()
  const { handle } = await runChannel({ dshHome, controller: null, ctxController: null })
  const errFile = path.join(dshHome, 'whale-channels', 'qq-wake-error.txt')
  const ok = await waitFor(() => fs.existsSync(errFile))
  handle.stop()
  assert.ok(ok, '拿不到 controller 时必须写 qq-wake-error.txt —— 以前只打一行 console，谁看得见')
  assert.match(fs.readFileSync(errFile, 'utf8'), /收得到私信|没投出去/, '错误文件里要写清症状')
})

await check('④ 投递失败 → 抛错留痕，而且不算已投（下次还能重来）', async () => {
  const bad = stubController({ fail: true })
  const dshHome = makeHome()
  const { handle } = await runChannel({ dshHome, controller: bad })
  const errFile = path.join(dshHome, 'whale-channels', 'qq-wake-error.txt')
  const ok = await waitFor(() => fs.existsSync(errFile) && /投递失败/.test(fs.readFileSync(errFile, 'utf8')))
  handle.stop()
  assert.ok(ok, '投递抛错必须留痕')
})

handled?.stop()
server.close()
console.log(`\n通过 ${passed} 项${process.exitCode ? '，有失败 ✗' : '，全过 ✓'}`)
process.exit(process.exitCode ?? 0)
