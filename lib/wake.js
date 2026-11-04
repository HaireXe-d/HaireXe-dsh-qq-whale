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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildWakePrefix, personaFingerprint } from './proactive.js'
// 2026-11-04 18:42：收到的图先下到本地，我才看得见（以前纯图消息根本进不来）
import { saveIncomingImages } from './incoming-images.js'

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
/**
 * ⚠️⚠️ 2026-11-04 18:28 今晚最深的那个坑：
 *
 *   `body.js` 是**纯 ESM**（`import fs from 'node:fs'`），
 *   而这里原来用 `createRequire(f)(f)` 去 require 它 —— **CommonJS require 加载不了 ESM** ✗
 *   直接抛 `ERR_REQUIRE_ESM`，被 `catch` 一口吞掉 → 返回 null → `BODY = null`
 *   → `currentSessionId()` 退回写死的 `'bili-whale'`
 *   → 投递报 `session "bili-whale" not found`
 *   → 而偶尔 BODY 侥幸可用的那几次，就变成 `agent-busy`（那才是真的在忙）
 *
 *   两种错误码，一个根因：**会话 id 来源不可靠**。
 *
 *   现在两条腿走路：
 *     ① 异步 `import()`（ESM 专用），拿到模块后缓存
 *     ② **兜底直读 `whale-body.json`** —— 不依赖 core、不依赖模块格式，永远可用 ✓
 *        （文件里的 `id` 就是当前会话，这是 core 那边写下的权威值）
 */
function bodyModule() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  for (const f of [
    path.join(here, '..', 'core', 'lib', 'body.js'),
    path.join(dshHome, 'whale-core', 'lib', 'body.js'),
    path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-whale-core', 'lib', 'body.js'),
  ]) {
    if (!fs.existsSync(f)) continue
    // ESM 只能用动态 import —— 这里返回一个「异步就绪」的句柄，
    // 调用方优先用同步的直读兜底，拿到模块之后再叠上来 ✓
    return { file: f, ready: import(pathToFileURL(f).href).catch(() => null) }
  }
  return null
}

/**
 * 兜底：直接读 `whale-body.json` 拿当前会话 id。
 * 不依赖 core 有没有装、也不依赖它是什么模块格式 —— 只要文件在就一定能拿到 ✓
 */
function readSessionIdFromBodyFile(dshHome) {
  try {
    const f = path.join(dshHome, 'whale-body.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    const id = typeof j?.id === 'string' ? j.id.trim() : ''
    if (id) return id
  } catch { /* 没有就用别的 */ }
  return ''
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
  // ⚠️ 2026-11-04 18:28：模块是异步 import 的，先存着；等它就绪后再叠到 BODY 上
  let BODY_MOD = null
  void (BODY?.ready ?? Promise.resolve(null)).then((m) => {
    if (m) {
      BODY_MOD = m
      log('[qq] 共享的会话身份（body.js）已就绪')
    } else if (BODY) {
      log('[qq] 共享的会话身份加载失败 → 用 whale-body.json 直读兜底')
    }
  })

  /**
   * 当前会话 id —— **每次都实时读**，绝不缓存（B 站随时可能轮换）✓
   *
   * 取值的优先级（2026-11-04 18:28 定的，这是今晚"not found"的正解）：
   *   ① 直接读 `whale-body.json` —— 最简单、最可靠，只要文件在就成
   *   ② `body.js` 模块（就绪之后才有）
   *   ③ 自己的状态文件 / 传进来的默认值
   * ⚠️ 最后那个 `'bili-whale'` 只是个古老的名字，DSH 里**根本没有这个会话** ——
   *    以前 BODY 加载失败就会退到它，投递必然 `not found` ✗
   */
  function currentSessionId() {
    const fromFile = readSessionIdFromBodyFile(dshHome)
    if (fromFile) return fromFile
    if (BODY_MOD?.readBody) {
      try {
        const b = BODY_MOD.readBody({ dshHome, fallback: sessionId, now: now() })
        if (b?.id) return b.id
      } catch { /* 往下退 */ }
    }
    const own = state?.sessionId
    if (own && own !== 'bili-whale') return own
    return sessionId
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
    if (BODY_MOD?.shouldRotateBody) {
      // 有 core：交给共享层判断 + 执行，谁先跑到谁换，另一个立刻看到 ✓
      try {
        const v = BODY_MOD.shouldRotateBody({ dshHome, rotateDays: cfg.sessionRotateDays ?? 0, now: now(), fallback: sessionId })
        if (v.rotate) {
          const r = BODY_MOD.rotateBody({ dshHome, who: 'qq', now: now(), fallback: sessionId })
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
      try { return BODY_MOD?.readBody ? Number(BODY_MOD.readBody({ dshHome, fallback: sessionId, now: now() }).deliveredAt) || 0 : state.deliveredAt } catch { return state.deliveredAt }
    })()
    const includeDiary = !sharedDeliveredAt || bootFirst || rotating

    const prefix = buildWakePrefix({
      persona: block,
      includePersona,
      includeDiary,
      dshHome,
    })
    const full = prefix ? `${prefix}\n${text}` : text

    // ⚠️⚠️ 2026-11-04 18:30 第五层真因（`raw` 里挖出来的）：
    //
    //   Error: session event "agent/inbox/spliced" carries non-JSON-serializable data
    //
    //   DSH 往会话日志里写 `agent/inbox/spliced` 事件时要求数据能 JSON 序列化。
    //   问题出在这次请求**没带 requestId**：
    //
    //     const source = { kind: "user", rpcId: request.requestId, ... }   // rpcId: undefined
    //
    //   `rpcId: undefined` 一路传下去，到序列化那一步就炸（DSH 用严格序列化，
    //   不是 JSON.stringify 那种会默默吞掉 undefined 的实现）。
    //
    //   改法：**永远给一个真实的 requestId**（字符串）。B 站那边可靠交付也是这么干的
    //   （`if(!request.requestId) throw Error('可靠交付需要 requestId')`）。
    const effectiveRequestId = String(requestId ?? `qq-${sid}-${now()}-${Math.random().toString(36).slice(2, 8)}`)
    const req = {
      sessionId: sid,
      mode: 'queue',
      requestId: effectiveRequestId,
      content: [{ type: 'text', text: full }],
    }
    void requestId
    // ⚠️⚠️ 2026-11-04 晚 第三层真因（`Cannot read properties of undefined (reading 'throwIfAborted')`）
    //
    //   查的是 DSH 自己的实现（app.asar → @deepseek-ai/dsh-api-session-controller/lib/index.js:3096）：
    //
    //     prompt(request, signal) {
    //       signal.throwIfAborted();          // ← 无条件，而且没有 ?.
    //       return this.commands.prompt(request);
    //     }
    //
    //   **signal 是必填的**。不传就是 TypeError —— 我上一版改成「没 signal 就不传」，
    //   方向反了：从一个 undefined 变成参数都不见，一样炸 ✗
    //   （18:06:37 那条报错就是这么来的，改完照样 `throwIfAborted`）
    //
    //   改法：**永远传一个真的 AbortSignal**。调用方给了就用调用方的；
    //   没给就自己造一个「几乎永不中止」的（24 小时上限）。
    //   这样 DSH 的 throwIfAborted() 有东西可调，也不会误杀正常投递 ✓
    const SIGNAL = signal ?? AbortSignal.timeout(24 * 60 * 60 * 1000)
    // ⚠️ 2026-11-04 18:13「prompt rejected」—— RemoteError 里 reason 被吃了，看不到真相。
    //   DSH 的 prompt 会把内部错误包成 `session/agent-busy` + reason: String(error)，
    //   而我们这边只打了 e.message（= "prompt rejected"）✗
    //   现在把 e.code / e.data / e.reason / cause 全挖出来，写进 qq-wake-error.txt
    //
    // ⚠️⚠️ 2026-11-04 18:17 真相：`code=session/agent-busy`，而那个 sessionId 就是
    //   **我自己正在跑的这个会话**（cwd=whale-work）。也就是说：
    //     她在忙 → 往里塞 followup 被 DSH 拒 → 这条消息作废
    //   而 B 站那边有 `sheIsBusy()` 会等；QQ 这边**没有这道判断**，撞上就死 ✗
    //
    //   改法：**busy 就等一下再重试**（总共等到 ~90 秒），别一次撞死就扔。
    //   注意 deliver() 那边只有真投成功才 markSeen，所以重试不会让她说两遍 ✓
    const delays = [2000, 5000, 10000, 20000, 30000, 25000]   // ≈92 秒
    let lastErr = null
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        await controller.prompt(req, SIGNAL)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        const busy = String(e?.code ?? '') === 'session/agent-busy' || /agent-busy/.test(String(e?.message ?? ''))
        if (!busy || attempt === delays.length) break
        log(`[qq] 会话正忙，${Math.round(delays[attempt] / 1000)} 秒后重试（第 ${attempt + 1} 次）`)
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
    if (lastErr) {
      // ⚠️ 2026-11-04 18:21：`session/agent-busy` 重试 92 秒、每次都挂 —— 不是忙，是被永久拒。
      //   DSH 那个 RemoteError 的 data.reason 里才是真话，这里**一字不截**地全写出去。
      let raw = ''
      try { raw = JSON.stringify(lastErr) } catch { raw = String(lastErr) }
      const detail = [
        lastErr?.message ?? String(lastErr),
        lastErr?.code ? `code=${lastErr.code}` : '',
        lastErr?.data ? `data=${JSON.stringify(lastErr.data)}` : '',
        lastErr?.reason ? `reason=${lastErr.reason}` : '',
        lastErr?.cause ? `cause=${lastErr.cause?.message ?? lastErr.cause}` : '',
        `sessionId=${sid}`,
        `raw=${String(raw).slice(0, 800)}`,
      ].filter(Boolean).join(' | ')
      throw new Error(detail)
    }

    booted = true
    lastDelivered = now()
    state.deliveredAt = lastDelivered
    state.personaHash = fp
    state.lastWakeAt = lastDelivered
    state.sessionId = sid          // 只在没有 core 时被当备份值用
    persist()
    // ⚠️ 往**共享文件**里记一笔"刚投递过"——
    //   B 站下次投递时就知道这不是第一次，不会重复注入日记 ✓
    if (BODY_MOD?.saveBody) {
      try {
        const cur = BODY_MOD.readBody({ dshHome, fallback: sessionId, now: now() })
        BODY_MOD.saveBody({ dshHome, who: 'qq', body: { ...cur, id: sid, deliveredAt: lastDelivered, personaHash: fp } })
      } catch { /* 记不上不影响投递 */ }
    }
    return { ok: true, sessionId: sid, rotating }
  }

  /** 被动：把主人发来的这句话投进去 */
  function deliver(msg, { signal } = {}) {
    const job = queue.then(async () => {
      if (alreadySeen(msg)) return { ok: true, skipped: 'already-delivered' }
      // ⚠️⚠️ 2026-11-04 18:42：**图片**。
      //   以前这里只有 `msg.text`，纯图片消息的 text 是空串 ——
      //   就算 poller 放它进来，投进去的也是一段没有内容的说明 ✗
      //   现在：把图先下到 `whale-work/qq-inbox/`，再把路径写进投递正文，
      //   我就能用 read_image 看见 ✓ 下载失败也不丢消息，只注明失败原因。
      const imageLines = []
      if (Array.isArray(msg.images) && msg.images.length > 0) {
        try {
          const saved = await saveIncomingImages({
            images: msg.images,
            outDir: path.join(dshHome, 'whale-work', 'qq-inbox'),
            log,
          })
          saved.forEach((s, i) => {
            if (s.ok) imageLines.push(`［图 ${i + 1}］${s.path}`)
            else imageLines.push(`［图 ${i + 1}］没下下来：${s.error}`)
          })
        } catch (e) {
          imageLines.push(`［图］下载出错：${e?.message ?? e}`)
        }
      }
      const bodyText = String(msg.text ?? '').trim()
      const text = [
        `【QQ 私信】${msg.nickname || msg.userId}（${msg.userId}）刚给你发私信：`,
        '',
        bodyText || '（这条没有文字，只有图）',
        ...(imageLines.length ? ['', ...imageLines, '', '（要看得用 read_image 打开上面那些路径；喜欢的话可以存进表情包库）'] : []),
        '',
        '（回话照旧：一行一句写进 whale-work/dm-reply-qq.txt；想发语音就在行首写 [语音]，想发表情包就写 [表情]）',
      ].join('\n')
      // ⚠️ 2026-11-04 晚：原来这里是「先 deliverText，再 markSeen」。
      //   deliverText 一抛错，markSeen 就没执行 —— 但**轮询那边已经把它塞进 seen 了**
      //   （poller 在分拣前就 add 了），于是两边的 seen 各记一半，
      //   这条消息既没投出去、也不会再试一次 ✗
      //   现在：投递失败**往外抛**，让 index.js 看见、记日志；
      //   而且只有真投成功了才标记为「投过」✓
      const r = await deliverText({ text, signal })
      markSeen(msg)
      log(`[qq] 已叫醒（会话 ${r?.sessionId ?? currentSessionId()}）`)
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
