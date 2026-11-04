/**
 * dsh-qq-whale · 叫醒她（收到 QQ 私信 → 投进会话）
 *
 * 2026-11-04 补的最后一块：之前 QQ 收到消息只写日志，人还是哑的 ✗
 * 现在照 B 站那套（plugins/dsh-bili-whale/lib/session-delivery.js）来：
 *
 *   私信来了 → 拼一段「主人（QQ）刚发来：…」 → controller.prompt({ sessionId, mode:'queue' })
 *   → 她那边的对话里就多出一条用户消息 → 她照常去读 dm-reply.txt / 做事 ✓
 *
 * ⚠️ 三个坑，一个个都是真踩过的：
 *   1. **人设要带**：不带人设她就不记得自己是谁（B 站那边专门有 personaBlock）
 *   2. **别重复投递**：同一条消息投两次 = 她说两遍话 ✗ → 有 seen 集合 + 落盘
 *   3. **她正在干活时别打断**：sessionController 那边是 queue 模式，等它跑完接上 ✓
 *
 * 这个文件不 import DSH；controller 是外面传进来的 ✓ 好测。
 */
import fs from 'node:fs'
import path from 'node:path'

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJsonSafe(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

/**
 * @param {object} p
 * @param {object} p.controller   DSH 的 sessionController（有 create/prompt）
 * @param {string} p.dshHome
 * @param {string} p.cwd          她的工作目录
 * @param {string} [p.sessionId]  会话 id（默认沿用 B 站那个池子，别开新的 ✗）
 * @param {Function} p.persona    () => 人设文本
 * @param {Function} [p.config]   () => 配置（读 sessionRotateDays 之类）
 * @param {Function} [p.log]
 * @param {Function} [p.now]
 */
export function createQqWaker({
  controller,
  dshHome,
  cwd,
  sessionId = 'bili-whale',
  persona = () => '',
  config = () => ({}),
  log = () => {},
  now = () => Date.now(),
} = {}) {
  const stateFile = path.join(dshHome, 'whale-channels', 'qq-wake-state.json')
  const saved = readJsonSafe(stateFile) ?? {}
  const state = {
    sessionId: typeof saved.sessionId === 'string' && saved.sessionId ? saved.sessionId : sessionId,
    seen: Array.isArray(saved.seen) ? saved.seen : [],
    lastWakeAt: Number(saved.lastWakeAt) || 0,
  }
  let prepared = false
  let queue = Promise.resolve()

  const persist = () => {
    try { writeJsonSafe(stateFile, { ...state, seen: state.seen.slice(-300) }) } catch (e) { log(`[qq] 唤醒状态没存上：${e?.message ?? e}`) }
  }

  /** 这条消息是不是已经投过了（按 messageId + 用户） */
  function alreadySeen(msg) {
    const key = `${msg.userId}:${msg.messageId ?? msg.text}`
    return state.seen.includes(key)
  }
  function markSeen(msg) {
    const key = `${msg.userId}:${msg.messageId ?? msg.text}`
    if (!state.seen.includes(key)) state.seen.push(key)
    persist()
  }

  /** 把她叫醒：内容就是主人刚说的那句话 */
  function deliver(msg, { signal } = {}) {
    const job = queue.then(async () => {
      if (!controller || typeof controller.prompt !== 'function') {
        throw new Error('没有 sessionController，叫不醒（插件没挂到 DSH 会话上？）')
      }
      if (alreadySeen(msg)) return { ok: true, skipped: 'already-delivered' }

      // 会话还没准备好就 create 一下（跟 B 站那个 delivery 一样）✓
      if (!prepared || typeof controller.create === 'function') {
        try { await controller.create({ sessionId: state.sessionId, cwd }) } catch { /* 已存在就沿用 */ }
        prepared = true
      }

      const personaText = String(persona() ?? '').trim()
      const head = [
        personaText ? `人设依据：${path.join(process.env.USERPROFILE || process.env.HOME || '.', '.bili-ai/persona.md')}；上下文缺失时重读。` : '',
        `【QQ 私信】${msg.nickname || msg.userId}（${msg.userId}）刚给你发私信：`,
        '',
        msg.text,
        '',
        '（回话照旧：一行一句写进 whale-work/dm-reply-qq.txt；想发语音就在行首写 [语音]，想发表情包就写 [表情]）',
      ].filter((x, i) => x !== '' || i < 3).join('\n')

      await controller.prompt({
        sessionId: state.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: head }],
      }, signal)

      markSeen(msg)
      state.lastWakeAt = now()
      persist()
      log(`[qq] 已叫醒（会话 ${state.sessionId}）`)
      return { ok: true }
    })
    queue = job.catch(() => {})
    return job
  }

  return { deliver, alreadySeen, markSeen, state, stateFile }
}

/**
 * 把 B 站通道那边的人设块拿过来 —— 两边共用一份，别各写各的 ✗
 * （B 站的 personaBlock 在 scheduler.js 里是闭包，这里只读文件，简单可靠）
 */
export function loadPersonaText({ dshHome = '', maxChars = 20000 } = {}) {
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  const file = path.join(home, '.bili-ai', 'persona.md')
  try {
    const text = fs.readFileSync(file, 'utf8').trim()
    if (!maxChars || maxChars <= 0) return text
    return text.length > maxChars ? text.slice(0, maxChars) : text
  } catch { return '' }
}
