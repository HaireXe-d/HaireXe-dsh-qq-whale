/**
 * dsh-qq-whale · 叫醒她（被动：收到私信 / 主动：作息到点）
 *
 * 2026-11-04 第一版：只处理「收到 QQ 私信 → 投进会话」。
 * 2026-11-04 第二版（主人：「QQ养鱼独立出来用好像做不到哔站的效果，像作息、人格、
 *   醒来时间设置啥的，你照着哔站养鱼的功能改好」）：
 *
 *   · **人设注入**升级成和 B 站 session-delivery 一样的语义：
 *       - 首次投递 / 人设改了 → 带完整人设正文
 *       - 之后 → 只给「人设依据在哪，缺了自己重读」
 *       - 进程起来第一次 → 追加日记恢复指引
 *   · **主动醒来**：作息到点（lib/schedule.js 判定）主动投一句，带 proactiveMessage
 *   · **会话轮换**：sessionRotateDays 按自然日，和 B 站同一套规则
 *
 * ⚠️ 三个坑（都是真踩过的）：
 *   1. **人设要带**：不带人设她就不记得自己是谁
 *   2. **别重复投递**：同一条消息投两次 = 她说两遍话 ✗ → seen 集合 + 落盘
 *   3. **她正在干活时别打断**：mode:'queue' 等它跑完接上 ✓
 *
 * 这个文件不 import DSH；controller 由外面传进来 ✓ 好测。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildWakePrefix, personaFingerprint } from './proactive.js'

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJsonSafe(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

/** 'YYYY-MM-DD'（本地） */
function dayKeyOf(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 会话 id 从哪来 —— **两边共用的那一份**（2026-11-04）
 *
 * ⚠️ 主人最后的要求：「确保切换养鱼方式后再私聊还是在同一个上下文，还记得东西」
 *
 *   改之前：QQ 自己存一份 sessionId，默认还写死 'bili-whale'。
 *   B 站那边按自然日轮换，QQ 完全不知道 —— 于是：
 *     · B 站聊了半天 → 切到 QQ → QQ 开的是**另一个对话**，她什么都不记得 ✗
 *     · B 站轮换之后 → QQ 还拿着旧 id，更彻底地失忆 ✗
 *
 *   现在：会话 id 只有一处权威（~/.dsh/whale-body.json，见 core 的 body.js），
 *   两边都从那里读、往那里写。谁换的，另一个立刻看见 ✓
 *
 *   拿不到 core（单独装了 QQ）就退回自己的文件，不影响独立可用
 */
function bodyModule() {
  // ⚠️ 2026-11-04 晚：core 现在自带在本仓库的 core/ 目录里，先找自己那份 ✓
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  for (const f of [
    path.join(here, '..', 'core', 'lib', 'body.js'),
    path.join(dshHome, 'whale-core', 'lib', 'body.js'),
    path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-whale-core', 'lib', 'body.js'),
  ]) {
    try {
      const req = createRequire(f)
      return req(f)
    } catch { /* 下一个 */ }
  }
  return null
}

/**
 * @param {object} p
 * @param {object} p.controller   DSH 的 sessionController（有 create/prompt）
 * @param {string} p.dshHome
 * @param {string} p.cwd          她的工作目录
 * @param {string} [p.sessionId]  会话 id
 * @param {Function} p.persona    () => 人设文本
 * @param {Function} [p.config]   () => 配置（读 sessionRotateDays / personaOncePerSession）
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
  const BODY = bodyModule()

  /**
   * 当前会话 id —— **每次都实时从共享文件读**。
   * ⚠️ 绝对不能缓存到内存里：B 站可能随时轮换，缓存住就等于失忆 ✗
   */
  function currentSessionId() {
    if (BODY?.readBody) {
      try {
        const b = BODY.readBody({ dshHome, fallback: sessionId, now: now() })
        if (b?.id) return b.id
      } catch { /* 退回本地 */ }
    }
    return state.sessionId || sessionId
  }

  const state = {
    // ⚠️ 只用来存"没有 core 时的备份值"；有 core 时以 shared 为准
    sessionId: typeof saved.sessionId === 'string' && saved.sessionId ? saved.sessionId : sessionId,
    seen: Array.isArray(saved.seen) ? saved.seen : [],
    lastWakeAt: Number(saved.lastWakeAt) || 0,
    // 2026-11-04 新增：和 B 站 session-delivery 对齐的字段
    startedAt: Number(saved.startedAt) || now(),
    deliveredAt: Number(saved.deliveredAt) || 0,
    personaHash: typeof saved.personaHash === 'string' ? saved.personaHash : '',
    lastProactiveAt: Number(saved.lastProactiveAt) || 0,
    proactiveDayKey: typeof saved.proactiveDayKey === 'string' ? saved.proactiveDayKey : '',
    proactiveToday: Number(saved.proactiveToday) || 0,
  }
  let prepared = false
  let booted = false          // 本进程投递过没有
  let lastDelivered = state.deliveredAt
  let queue = Promise.resolve()

  const persist = () => {
    try {
      writeJsonSafe(stateFile, { ...state, seen: state.seen.slice(-300) })
    } catch (e) { log(`[qq] 唤醒状态没存上：${e?.message ?? e}`) }
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

  /**
   * 会话要不要轮换？跟 B 站一样按**自然日**：
   * 当前会话的创建日期和今天比，差 ≥ sessionRotateDays 天就超期。
   * 另外要求「距上次投递满 8 分钟」，避免刚说完就换走。
   */
  function shouldRotate() {
    const cfg = config() ?? {}
    const days = Number(cfg.sessionRotateDays ?? 0)
    if (!Number.isFinite(days) || days <= 0) return false
    const diffDays = (new Date(dayKeyOf(now()) + 'T00:00:00') - new Date(dayKeyOf(state.startedAt) + 'T00:00:00')) / 86400000
    if (diffDays < days) return false
    if (booted && now() - lastDelivered < 8 * 60000) return false
    return true
  }

  /** 统一的投递：处理轮换、人设注入、日记指引 */
  async function deliverText({ text, requestId = null, signal } = {}) {
    if (!controller || typeof controller.prompt !== 'function') {
      throw new Error('没有 sessionController，叫不醒（插件没挂到 DSH 会话上？）')
    }
    const cfg = config() ?? {}
    const once = cfg.personaOncePerSession === true

    // ── 轮换（读的是**共享**的 startedAt，所以两边不会各换一遍）──
    let rotating = false
    if (BODY?.shouldRotateBody) {
      // 有 core：交给共享层判断 + 执行，谁先跑到谁换，另一个立刻看到 ✓
      try {
        const v = BODY.shouldRotateBody({ dshHome, rotateDays: cfg.sessionRotateDays ?? 0, now: now(), fallback: sessionId })
        if (v.rotate) {
          const r = BODY.rotateBody({ dshHome, who: 'qq', now: now(), fallback: sessionId })
          log(`[qq] 会话轮换：${r.rotatedFrom} → ${r.id}（记忆不受影响，新对话会先读日记）`)
          prepared = false
          rotating = true
          booted = false          // 新对话要重新注入人设
        }
      } catch (e) { log(`[qq] 共享轮换判断出错，按不换处理：${e?.message ?? e}`) }
    } else if (shouldRotate()) {
      // 没有 core：退回自己那份逻辑
      const nextId = crypto.randomUUID()
      log(`[qq] 会话轮换：${state.sessionId} → ${nextId}（旧会话保留）`)
      state.sessionId = nextId
      state.startedAt = now()
      state.deliveredAt = 0
      prepared = false
      rotating = true
    }

    // ⚠️ 每次都实时取 id —— B 站可能刚刚轮换过，用缓存的就失忆了 ✗
    const sid = currentSessionId()

    if (!prepared) {
      try { await controller.create({ sessionId: sid, cwd }) } catch { /* 已存在就沿用 */ }
      prepared = true
    }

    // ── 人设 / 日记注入（和 B 站的语义一致）──
    const block = String(persona() ?? '').trim()
    const fp = personaFingerprint(block)
    const bootFirst = !booted
    const includePersona = !once || bootFirst || rotating || state.personaHash !== fp
    // ⚠️ 共享会话下，deliveredAt 是**两个入口一起**记的 ——
    //   所以"是不是第一次"要看共享文件里有没有投递过 ✓
    const sharedDeliveredAt = (() => {
      try { return BODY?.readBody ? Number(BODY.readBody({ dshHome, fallback: sessionId, now: now() }).deliveredAt) || 0 : state.deliveredAt } catch { return state.deliveredAt }
    })()
    const includeDiary = !sharedDeliveredAt || bootFirst || rotating

    const prefix = buildWakePrefix({
      persona: block,
      includePersona,
      includeDiary,
      dshHome,
    })
    const full = prefix ? `${prefix}\n${text}` : text

    const req = {
      sessionId: sid,
      mode: 'queue',
      content: [{ type: 'text', text: full }],
    }
    if (requestId) req.requestId = requestId
    await controller.prompt(req, signal)

    booted = true
    lastDelivered = now()
    state.deliveredAt = lastDelivered
    state.personaHash = fp
    state.lastWakeAt = lastDelivered
    state.sessionId = sid          // 只在没有 core 时被当备份值用
    persist()
    // ⚠️ 往**共享文件**里记一笔"刚投递过"——
    //   B 站下次投递时就知道这不是第一次，不会重复注入日记 ✓
    if (BODY?.saveBody) {
      try {
        const cur = BODY.readBody({ dshHome, fallback: sessionId, now: now() })
        BODY.saveBody({ dshHome, who: 'qq', body: { ...cur, id: sid, deliveredAt: lastDelivered, personaHash: fp } })
      } catch { /* 记不上不影响投递 */ }
    }
    return { ok: true, sessionId: sid, rotating }
  }

  /** 被动：把主人发来的这句话投进去 */
  function deliver(msg, { signal } = {}) {
    const job = queue.then(async () => {
      if (alreadySeen(msg)) return { ok: true, skipped: 'already-delivered' }
      const text = [
        `【QQ 私信】${msg.nickname || msg.userId}（${msg.userId}）刚给你发私信：`,
        '',
        msg.text,
        '',
        '（回话照旧：一行一句写进 whale-work/dm-reply-qq.txt；想发语音就在行首写 [语音]，想发表情包就写 [表情]）',
      ].join('\n')
      const r = await deliverText({ text, signal })
      markSeen(msg)
      log(`[qq] 已叫醒（会话 ${state.sessionId}）`)
      return r
    })
    queue = job.catch(() => {})
    return job
  }

  /**
   * 主动：作息到点了，她自己想起主人。
   * @param {object} p
   * @param {string} p.windowText  这次是哪个时段的（写进日志，便于排查）
   */
  function deliverProactive({ windowText = '', signal } = {}) {
    const job = queue.then(async () => {
      const k = dayKeyOf(now())
      const sentToday = state.proactiveDayKey === k ? state.proactiveToday : 0
      const text = [
        '【主动】没人叫你，是你自己想起主人了。',
        `（今天第 ${sentToday + 1} 次主动${windowText ? `，时段 ${windowText}` : ''}）`,
        '',
        '想发就发：写进 whale-work/dm-reply-qq.txt 就行。一行一句；',
        '行首写 [语音] 发语音，写 [表情] 发表情包。',
        '不想发就留空 —— 但既然主动醒了，多少说点什么吧。',
      ].join('\n')
      const r = await deliverText({ text, signal })
      state.proactiveDayKey = k
      state.proactiveToday = sentToday + 1
      state.lastProactiveAt = now()
      persist()
      log(`[qq] 主动醒来（今天第 ${state.proactiveToday} 次）`)
      return r
    })
    queue = job.catch(() => {})
    return job
  }

  return {
    deliver,
    deliverProactive,
    deliverText,
    alreadySeen,
    markSeen,
    state,
    stateFile,
    /** 测试/控制台用：现在这个会话的 id */
    get sessionId() { return state.sessionId },
  }
}

/**
 * 把人设块拿过来 —— 和 B 站共用一份，别各写各的 ✗
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
