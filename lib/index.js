/**
 * dsh-qq-whale · 宿主侧入口
 *
 * 只做一件事：把自己登记成 core 里的**一个通道**。
 * 开关、配置、路由、生命周期都由 core 管 —— 这个文件里没有路由表 ✓
 *
 * 关掉这个通道时：
 *   · start() 不会被调 → 不轮询、不连 OneBot
 *   · /dsh-whale/api/channels/qq/* 一律 409
 *   · 配置只读
 *   · **数据一个字节都不删**（下次打开就接着用）✓
 */
import fs from 'node:fs'
import path from 'node:path'
// ⚠️ 2026-11-04 晚：ensureNapcat() 要用 —— 无窗口拉起 NapCat（不动它就不弹窗）
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createOneBot } from './onebot.js'
import { createPoller, inQuietHours, createGroupPoller } from './poller.js'
import { normalizeGroupOpts, splitGroupTag, canReplyToGroup } from './group.js'
import { createNapCatLogin } from './qr-login.js'
import { toDataURL } from './qr-image.js'
import { createPendingStore, shouldAutoReply } from './pending.js'
import { createStickerLibrary } from './sticker.js'
import { createQqWaker, loadPersonaText } from './wake.js'
import { shouldWakeNow, recordWake } from './schedule.js'
import { shouldBeProactive } from './proactive.js'
import { readRuntimeRules } from './runtime-rules.js'
import { planReply, materializeMessage, readOverride, decideFormat } from './compose.js'
// 2026-11-04 18:27：投递自检 —— `agent-busy` 的真因被 DSH 吃掉了，只能让插件自己捞完整错误
import { runDeliveryProbe } from './delivery-probe.js'
// ⚠️⚠️ 2026-11-04 18:32：「回话发不出去」的真因 —— 这个模块**之前根本不存在**。
//   `reply.file` 只是个配置项，没有任何代码去读它、发它 ✗
//   所以我把话写进 dm-reply-qq.txt，它就一直躺着，主人在 QQ 什么都收不到。
import { createReplySender } from './reply-sender.js'

/** 本文件所在目录（找自带 core 用） */
const HERE = path.dirname(fileURLToPath(import.meta.url))

const CHANNEL_ID = 'qq'

/**
 * 备份白名单：[源（相对 HOME）, 备份包里的相对路径]
 *
 * ⚠️ 2026-11-04 晚：这份必须和 `tools/qq-backup.mjs` 里的 FILES 保持一致 ——
 *   两边不一致会出现「命令行备份了、界面恢复不回来」这种诡异情况 ✗
 *   一份备份 = **整条鱼**，所以 B 站那边的凭据和设置也在里面。
 */
const BACKUP_WHITELIST = [
  // 她是谁（两个入口共用）
  ['.bili-ai/persona.md', 'bili-ai/persona.md'],
  // 记忆（两个入口共用，只有一份）
  //
  // ⚠️ 2026-11-04 晚（线上反馈：「备份里并没有日记之类的东西」）：
  //   日记是**她写过才有**的 —— 刚装好、还没聊过的时候这几个文件根本不存在，
  //   于是备份出来就是空目录，看起来像"备份坏了" ✗
  //   现在：这几个文件缺失时**补一份说明**进备份，并在 README 里讲清楚
  //   「她在什么时候会开始写」。（见 BACKUP_PLACEHOLDERS）
  ['.dsh/whale-diary.md', 'dsh/whale-diary.md'],
  ['.dsh/whale-diary-private.md', 'dsh/whale-diary-private.md'],
  ['.dsh/whale-rules.md', 'dsh/whale-rules.md'],
  // 共享的设置和"她在哪个对话"
  ['.dsh/whale-habits.json', 'dsh/whale-habits.json'],
  ['.dsh/whale-body.json', 'dsh/whale-body.json'],
  ['.dsh/whale-session.json', 'dsh/whale-session.json'],
  // B 站那边（一起用时才有）
  ['.dsh/bili-whale.config.json', 'dsh/bili-whale.config.json'],
  ['.bili-ai/credentials.json', 'bili-ai/credentials.json'],
  ['.bili-ai/quota.json', 'bili-ai/quota.json'],
  ['.bili-ai/dm-await-state.json', 'bili-ai/dm-await-state.json'],
  // QQ 自己的
  ['.dsh/whale-channels/channels/qq.json', 'dsh/whale-channels/channels/qq.json'],
  ['.dsh/whale-channels/index.json', 'dsh/whale-channels/index.json'],
  ['.dsh/whale-channels/shared.json', 'dsh/whale-channels/shared.json'],
  ['.dsh/whale-channels/qq-state.json', 'dsh/whale-channels/qq-state.json'],
  ['.dsh/whale-channels/qq-wake-state.json', 'dsh/whale-channels/qq-wake-state.json'],
  ['.dsh/whale-channels/qq-night-state.json', 'dsh/whale-channels/qq-night-state.json'],
  ['.dsh/whale-channels/qq-pending.json', 'dsh/whale-channels/qq-pending.json'],
  // 她写过的东西
  ['.dsh/whale-work', 'dsh/whale-work'],
]


// 同步 require 用（loadCoreRegistrySync：apply 里不能在登记前 await，见那段注释）
const require = createRequire(import.meta.url)

/** 这个通道的默认配置。设置页只显示这里有的键 ✓ */
export const DEFAULTS = {
  enabled: true,               // 通道级开关（core 也有一份，以 core 的为准）
  onebot: {
    baseUrl: 'http://127.0.0.1:3000',
    token: '',
  },
  // 2026-11-04 主人要的：扫码登录，跟 B 站那套一样
  //   NapCat 自己有一个 WebUI（默认 6099 端口），登录走它
  webui: {
    url: 'http://127.0.0.1:6099',
    token: 'napcat_webui',     // NapCat 的默认值；主人改过就跟着改
  },
  // 2026-11-04 主人问「自己的ID和QQ号和主人的ID和QQ号做了没」
  //   B 站那边有 self.mid / self.name（她的）和 owner.mid / owner.name（他的）；
  //   QQ 这边之前只有 owner.uin，**没有她自己的号** ✗ → 补上 self，两边对齐 ✓
  self: {
    uin: '',                   // 她登录的 QQ 号（NapCat 登录成功后自动填）
    nickname: '',              // 她登录的 QQ 昵称（同上）
    at: '',                    // 什么时候记下来的
    // ⚠️ 2026-11-07 补：这是**运行时状态**（登录后写进来的），不是配置项。
    //   但用户配置文件里已经有它了，DEFAULTS 里不写的话类型对不上 ✗
    online: false,
  },
  owner: {
    uin: '',                   // 主人的 QQ 号
    nickname: '',              // 主人的 QQ 昵称（收到他的消息时顺手记）
  },
  listen: {
    intervalSec: 8,
    backoffMaxSec: 180,
  },
  // ⚠️ 2026-11-04 补（主人：「QQ养鱼独立出来用好像做不到哔站的效果，像作息、醒来时间」）：
  //   QQ 原来**完全没有作息** —— 只有「收到消息才反应」，不会自己想起来找主人。
  //   这里照 B 站那份配置形状补齐，语义保持一致，方便两个入口互相迁移 ✓
  night: {
    windows: [
      { start: '9:00', end: '11:00', wakes: 1 },
      { start: '14:00', end: '16:00', wakes: 1 },
      { start: '20:00', end: '22:00', wakes: 1 },
    ],
    skipChance: 0,          // 到点了也有这个概率跳过（0 = 每次都醒）
    minGapMin: 60,          // 两次醒来之间至少隔多久
    maxWakesPerDay: 3,      // 一天最多醒几次
  },
  // 主动找你（B 站叫 proactive）：醒来时有多大概率主动发消息
  proactive: {
    enabled: true,
    chance: 0.5,            // 醒来时 50% 概率主动说话
    dailyMax: 2,            // 一天最多主动几次
    quietMin: 30,           // 主人刚说过话多久内不主动（别打扰）
  },
  // 会话轮换：跟 B 站同一套规则（按自然日）
  sessionRotateDays: 1,
  personaOncePerSession: true,   // 同一会话内只注入一次完整人设
  // 口味：让她知道主人喜欢/不喜欢什么（和 B 站同一个字段名）
  preferences: {
    like: '',
    dislike: '',
    keywords: [],
  },
  reply: {
    // 跟 B 站那边同一个规矩：我写文件，插件来发；一条一行 = 一条消息
    file: 'dm-reply-qq.txt',
    maxLines: 6,
    maxChars: 600,
    gapMs: 1200,               // 多条之间停一下，别一秒钟刷过去
  },
  quietHours: [],              // [{from:'23:30', to:'07:00'}] 只收不发
  poke: {
    enabled: false,            // 戳一戳：他不理我就戳一下（默认关，怕烦）
    afterMinutes: 60,
  },
  // 2026-11-04 主人要的「想发文字发文字，想发语音发语音」
  voice: {
    enabled: true,
    // ⚠️ 2026-11-08 引擎三档：
    //   'preset' = **自带的大肥鱼音色**（系统 TTS + 音调改造，不花钱）← 默认
    //   'tts'    = 电脑原声（自己挑音色/语速）
    //   'file'   = 用你自己导入的一段音频
    engine: 'preset',                   // preset | tts | file
    preset: 'clever',                   // 大肥鱼预设：clever（机灵版）| dreamy（迷糊版）
    voice: 'Microsoft Huihui Desktop',  // 中文女声（本机实测有）
    pitch: 0,                           // 音调（-50..50，走 SSML）
    rate: 0,
    volume: 100,
    maxChars: 120,
    customFile: '',
  },
  // 2026-11-04 主人要的「碰到喜欢的表情包就存（一天最多存一个）」
  sticker: {
    enabled: true,
    perDay: 1,                 // 一天最多**存**几个
    maxBytes: 8388608,
    sendChance: 0.15,          // 文字顺手配表情包的概率
  },
  // ── 群聊（2026-11-07）──────────────────────────────────────────
  //   主人原话：「把你拉进群聊，主人 @ 你就回答主人，别人 @ 你就先问主人再回」
  //
  //   ⚠️ 默认是**关的、而且群名单是空的** —— 不默认监听所有群 ✗
  //     她进的群不止主人一个，默认全听等于把她扔进一堆没同意过的场合里。
  //     要她在哪个群说话，就把群号加进 groups 里 ✓
  group: {
    listen: false,
    groups: [],            // [{ id: '123456789', name: '宿舍群', enabled: true, invitedBy: 'owner' }]
    // ⚠️ 2026-11-07 主人：「群聊只有我能邀请你，你不能乱进」
    //   开着 = 名单里的群必须带 invitedBy: 'owner' 才算数；
    //   关掉 = 只要在名单里就听（不建议关，关了这个保险就没了）
    ownerOnly: true,
    needAt: true,          // 只有 @ 我 才理
    askWhenOthers: true,   // 别人 @ 我 → 先问主人（他定的）
    quoteContext: 3,       // 带前面几句给他判断
    maxPerPoll: 6,
    replyToGroup: true,
  },
  // 2026-11-04 主人补的：「主要是你想发就发，我主动提也可以选，大部分时候停留在你自己选的」
  //
  //   mode = 'auto'   → 平时按我自己挑的来（默认，也是「大部分时候」）✓
  //   mode = 'pinned' → 暂时固定成某一种（语音 / 表情包 / 文字），直到改回来
  //
  //   「他主动提也可以选」→ 他临时说一句「发语音」「发个表情包」就走 override，
  //     但这只是**这一次**的事，不改 mode ✓（他想改默认就去控制台改）
  format: {
    mode: 'auto',              // auto | pinned
    pinned: 'text',            // mode=pinned 时用这个：text | voice | sticker
    // 他自己说「发语音」这种临时指定的有效期（秒）—— 过了就回到 auto
    overrideTtlSec: 300,
    // auto 模式下，文字 / 语音 / 表情包 各自被挑中的权重（0 就是不用）
    weights: { text: 8, voice: 1, sticker: 1 },
  },
  // ⚠️ 2026-11-07 补（对比主人真实配置时发现的缺口）：
  //   主人的 qq.json 里早就有 persona 这一块，但 DEFAULTS 里**没有** ——
  //   后果：backupDirFor() 读 persona.name 永远读不到 →
  //        备份目录永远叫「她的备份」，而不是「邦邦的备份」✗
  //        控制台上改了名字也存不住（不在默认结构里）✓ 现在补上
  persona: {
    name: '',                  // 她的名字（备份目录、称呼都用它）
    ownerTitle: '主人',         // 她怎么称呼你
    selfClaim: '',             // 她自称什么（空 = 用 name）
  },
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 本地日期 key（作息计数用） */
function dayKeyOfLocal(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function writeJsonSafe(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

/**
 * 待审提醒：**攒一波再发**（2026-11-12 主人：
 *   「能不能等别人一次性发完后等二十几秒没反应了就都塞到一条待审发我」）
 *
 * 老的做法：每一条别人的消息进队就推一条私信 ⇒ 对方连发 10 条，他被轰 10 下 ✗
 * 中间试过「同一人 10 分钟只推第一条」：不吵了，但**后面的内容他看不到** ✗
 *
 * 现在：同一个人连着发，**每条都进待审队列**，只是先不推；
 *   等这个人 **idleMs（默认 20 秒）没再发**，把这一串合成**一条**推送给他 ✓
 *   · 一次最多列 8 条，多的写「还有 N 条」
 *   · 一天最多推 `perDay` 条汇总（默认 30），超了只进队不推
 *   · 判据：**宁可少吵他，也不要漏别人的话**
 */
export function makePendingBatchingNotifier({ stateFile, idleMs = 20_000, perDay = 30, onFlush, now = () => Date.now() } = {}) {
  /** whoId -> { whoName, msgs: [{text, at}], timer } */
  const buckets = new Map()

  function load() {
    const j = readJsonSafe(stateFile) ?? {}
    const today = dayKeyOfLocal(now())
    if (j.day !== today) return { day: today, pushedToday: 0 }
    return { day: today, pushedToday: Number(j.pushedToday) || 0 }
  }
  function bump() {
    const st = load()
    st.pushedToday += 1
    writeJsonSafe(stateFile, st)
    return st
  }

  function render({ whoName, msgs }) {
    const who = whoName || '有人'
    const n = msgs.length
    const lines = [n === 1 ? `【待审】${who}：` : `【待审】${who} 发了 ${n} 条：`]
    msgs.slice(0, 8).forEach((m, i) => {
      lines.push(n === 1 ? m.text : `${i + 1}. ${m.text}`)
    })
    if (n > 8) lines.push(`…还有 ${n - 8} 条（都在待审里）`)
    lines.push('（在「养鱼 · QQ」的待审里回或删）')
    return lines.join('\n')
  }

  function flush(key) {
    const b = buckets.get(key)
    if (!b) return
    buckets.delete(key)
    try { clearTimeout(b.timer) } catch { /* */ }
    if (!b.msgs.length) return
    if (load().pushedToday >= perDay) return   // 额度用完：只进队，不吵他
    bump()
    try { onFlush?.(render(b)) } catch { /* 推不出去不影响队列 */ }
  }

  /** 一条别人消息进队了 —— 记进来，重置这个人的静默计时 */
  function push({ whoId, whoName = '', text = '' } = {}) {
    const key = whoId == null ? 'unknown' : String(whoId)
    const cur = buckets.get(key) ?? { whoName, msgs: [], timer: null }
    cur.whoName = whoName || cur.whoName
    cur.msgs.push({ text: String(text ?? '').slice(0, 200), at: now() })
    if (cur.timer) { try { clearTimeout(cur.timer) } catch { /* */ } }
    cur.timer = setTimeout(() => flush(key), idleMs)
    if (cur.timer?.unref) cur.timer.unref()
    buckets.set(key, cur)
    return { queued: cur.msgs.length, idleMs }
  }

  /** 通道停了：把还没推的立刻推出去，别闷着 */
  function dispose() {
    for (const key of [...buckets.keys()]) flush(key)
  }

  return { push, flush, dispose, load }
}

/**
 * 建一个通道定义。**不在这里注册** —— 交给 index.js 的 apply 去注册，
 * 这样测试能直接调用 buildChannel() 而不碰 DSH ✓
 */
export function buildChannel({ dshHome, ctx = null, readConfig, log = () => {}, now = () => Date.now() } = {}) {
  /**
   * 扫码登录器：**整个通道共用一个实例** —— 每次点「生成二维码」都新建一个的话，
   * 上一次的会话就永远收不了尾，前端轮询会一直问一个不存在的 id ✗
   * 配置改了（WebUI 地址/token）→ 重建一个 ✓
   */
  let login = null
  let loginSig = ''
  function loginFor(cfg) {
    const webui = cfg?.webui ?? {}
    const sig = `${webui.url ?? ''}|${webui.token ?? ''}`
    if (login && sig === loginSig) return login
    login = createNapCatLogin({
      webuiUrl: webui.url,
      webuiToken: webui.token,
      render: (url) => toDataURL(url, { scale: 6, quiet: 4 }),
      now,
    })
    loginSig = sig
    return login
  }

  // ⚠️ 2026-11-07：路由里写配置走 core 的 createChannelConfig（跟 /accounts/refresh 同一条路）——
  //   buildChannel 只拿到 readConfig，没有 writeConfig。
  //   ① 先试着用 core 的；② 拿不到（比如单装 QQ、core 没找到）就直写这个通道的文件 ✓
  //   两种都要保留其余字段：`writeChannel` 是**深合并**，不会把 onebot / owner 冲掉。
  async function writeConfigSafe(patch) {
    try {
      const cfgMod = await importCoreModule('channel-config')
      const store = cfgMod.createChannelConfig({ dshHome, channels: [{ id: 'qq' }] })
      store.writeChannel('qq', patch)
      return { ok: true, how: 'core' }
    } catch (e) {
      try {
        const cur = readJsonSafe(path.join(dshHome, 'whale-channels', 'channels', 'qq.json')) ?? {}
        writeJsonSafe(path.join(dshHome, 'whale-channels', 'channels', 'qq.json'), { ...cur, ...patch })
        return { ok: true, how: 'file', warn: String(e?.message ?? e).slice(0, 120) }
      } catch (e2) {
        return { ok: false, error: String(e2?.message ?? e2).slice(0, 200) }
      }
    }
  }

  return {
    id: CHANNEL_ID,
    label: 'QQ',
    emoji: '🐧',
    order: 20,
    description: '走 OneBot 11（NapCat / LLOneBot）：收私信、发消息、戳一戳。',
    // ⚠️ 2026-11-04 主人纠错：「一条鱼控制两个插件，记忆本备份只有桌面一份」
    //   这里原来指向 `whale-work-qq` —— 一个**从来没被创建过的独立目录**，
    //   在控制台上就暗示成「QQ 有自己的工作区/记忆」，和事实相反 ✗
    //   整件事是：同一个她 + 两个说话的地方。日记在 ~/.dsh/whale-diary.md，
    //   人设在 ~/.bili-ai/persona.md，**都只有一份**，QQ 这边只是换个入口说话 ✓
    //   所以 home 和 B 站用同一个工作区，别另起一个。
    home: path.join(dshHome, 'whale-work'),
    defaultEnabled: false,      // 新装的先关着：没配 OneBot 前开着只会一直报错 ✗
    defaults: DEFAULTS,
    needsLogin: true,
    secretPaths: ['onebot.token'],

    // ⚠️ 2026-11-04 踩的坑：这里原来是 `start(ctx)` —— 参数名叫 ctx，
    //   把外面的闭包 ctx（buildChannel 收到的那个）**盖掉了** ✗
    //   于是 onMessage 里的 `ctx?.emit?.(...)` 调的是 core 传进来的那个空 ctx，
    //   主人的消息一条都投不出去，而且**不报错**（可选链吞掉了）。
    //   这就是「看着像完成了、其实没生效」那类病：变量名撞车也是静默失效的一种 ✓
    //   现在参数改叫 hostCtx，闭包那个 ctx 原样留着。
    start(hostCtx) {
      const cfg = readConfig()
      const stateFile = path.join(dshHome, 'whale-channels', 'qq-state.json')
      const state = readJsonSafe(stateFile) ?? {}
      let stopped = false
      let timer = null

      const onebot = cfg?.onebot ?? {}
      let ob
      try {
        ob = createOneBot({ baseUrl: onebot.baseUrl, token: onebot.token })
      } catch (e) {
        log(`[qq] 通道起不来：${e?.message ?? e}`)
        return { stop() {} }
      }

      const ownerId = String(cfg?.owner?.uin ?? '').trim()
      if (!/^\d{5,16}$/.test(ownerId)) {
        log('[qq] 还没配主人的 QQ 号（owner.uin）→ 只起不干活，等配上再轮询')
        return { stop() {} }
      }

      const pending = createPendingStore({ dshHome })

      // 2026-11-12 主人：「等别人一次性发完后等二十几秒没反应了就都塞到一条待审发我」
      //   → 同一个人连发，攒到他安静 20 秒，合成一条推给主人；队列照收不误
      const pendingNotifier = makePendingBatchingNotifier({
        stateFile: path.join(dshHome, 'whale-channels', 'qq-pending-notify.json'),
        idleMs: 20_000,
        perDay: 30,
        now,
        onFlush: (text) => {
          try { ob.sendPrivate(ownerId, text).catch((e) => log(`[qq] 待审汇总没发出去：${e?.message ?? e}`)) } catch (e) { log(`[qq] 待审汇总没发出去：${e?.message ?? e}`) }
        },
      })

      // 主人上一次「发语音 / 发个表情包」的临时指定（只管这一次，会过期）
      let override = null

      // 共用的「谁说了算」规则（shared.json）—— 运行时用的，跟控制台是同一份 ✓
      // ⚠️ 规则实现从 core 取；取不到就按「允许」处理（不能因为读不到就装死）
      let sharedRules = null
      const rulesNow = () => readRuntimeRules({ dshHome, channel: 'qq', rules: sharedRules })
      ;(async () => {
        try {
          const coreMod = await importCoreModule('shared')
          if (coreMod?.capabilitiesFor) { sharedRules = coreMod; log('[qq] 已接上共用规则') }
          else log('[qq] 没拿到 core 的共用规则 → 运行时按「允许」处理')
        } catch (e) { log(`[qq] 共用规则没加载上：${e?.message ?? e}`) }
      })()

      // 叫醒她：把消息投进 DSH 会话（跟 B 站那套走同一个会话池 ✓）
      let waker = null
      try {
        const controller = hostCtx?.sessionController ?? ctx?.sessionController ?? null
        if (controller) {
          // ⚠️ 2026-11-04 晚（线上反馈：「单独下载安装配置好之后聊天发消息没反应」）：
          //   这里原来兜底是 'bili-whale' —— 那是 **B站 的会话名**。
          //   单独装 QQ 的人根本没有这个会话 → 投递必然 "session not found"
          //   → 收得到消息，但她永远不说话 ✗（最难查的一种：日志里看着"投递了"）
          //
          //   现在按优先级找一个**真的存在**的会话：
          //     ① 设置里手填的 wake.sessionId（用户明确指定就用它）
          //     ② whale-body.json 里共享的（两个入口一条鱼时有）
          //     ③ 从 DSH 的会话控制器里挑一个能用的
          //     ④ 都没有 → 建一个新的给 QQ 用（QQ 单独装的时候就走这条）
          const wanted = String(cfg?.wake?.sessionId ?? '').trim()
          const sid = wanted || pickSessionIdSync({ controller, dshHome, log }) || 'qq-whale'
          waker = createQqWaker({
            controller,
            dshHome,
            cwd: dshHome && path.join(dshHome, 'whale-work'),
            sessionId: sid || 'qq-whale',
            persona: () => loadPersonaText({}),
            log,
            now,
          })
        } else {
          // ⚠️ 2026-11-04 晚：这根线断了以前只打一行字，然后消息照样记进 seen，
          //   看着像处理完了、其实人是哑的 ✗（今天 17:50 那条就是这么丢的）
          //   现在：① 写得刺眼 ② 落一个 owner-visible 的文件，别只活在控制台里
          const msg = '[qq] 拿不到 sessionController → 收得到消息但叫不醒她（回话这条路是断的！）'
          log(msg)
          try {
            const f = path.join(dshHome, 'whale-channels', 'qq-wake-error.txt')
            fs.mkdirSync(path.dirname(f), { recursive: true })
            fs.writeFileSync(f, [
              `时间：${new Date().toISOString()}`,
              '症状：QQ 收得到私信，但投不进会话（不会有人回话）',
              '最常见的原因：插件 inject 里没要 sessionController',
              '判据：qq-wake-state.json 不存在 / whale-work 下没有 dm-reply-qq.txt',
            ].join('\n') + '\n')
          } catch { /* 记不上不影响主流程 */ }
        }
      } catch (e) {
        log(`[qq] 叫醒功能起不来：${e?.message ?? e}`)
      }

      // ⚠️ 2026-11-04 晚（线上反馈「单独装好聊天没反应」时又发现的）：
      //   这段是当初查 agent-busy 时留的**诊断自检** —— 它会真的往会话里插
      //   一条「【自检】…」的假消息，而且 sessionId 还写死 'bili-whale' ✗
      //   别人单独装 QQ 时：会话不存在 + 每次启动多一条怪消息。
      //   现在默认**关掉**，只有显式设了 QQ_DELIVERY_PROBE=1 才跑（自己排查时用）✓
      if (waker && process.env.QQ_DELIVERY_PROBE === '1') {
        setTimeout(() => {
          void runDeliveryProbe({
            controller: hostCtx?.sessionController ?? ctx?.sessionController ?? null,
            dshHome,
            sessionId: pickSessionIdSync({ controller: hostCtx?.sessionController ?? ctx?.sessionController ?? null, dshHome, log }) || 'qq-whale',
            cwd: dshHome && path.join(dshHome, 'whale-work'),
            log,
            now,
          })
        }, 20 * 1000)
      }

      // ⚠️ 2026-11-04 18:32：**回话发送器**（以前压根没有这东西）
      //   她写 whale-work/dm-reply-qq.txt，这里负责读出来一条条发出去 ✓
      //   发失败不删文件，留到下一轮补发（B 站 11-03 踩过的坑）
      let stickerLib = null
      try { stickerLib = createStickerLibrary({ dshHome }) } catch { /* 没有库也不影响发文字 */ }
      const replySender = createReplySender({
        ob,
        ownerId,
        workDir: path.join(dshHome, 'whale-work'),
        fileName: String(cfg?.reply?.file ?? 'dm-reply-qq.txt'),
        readConfig,
        stickers: stickerLib,
        voiceDir: path.join(dshHome, 'whale-work', '.voice'),
        log,
        now,
      })
      replySender.start()

      const poller = createPoller({
        ob,
        ownerId,        // ⚠️ 2026-11-04 18:10 刷屏事故：把我自己的号传进去，
        //   历史里混着的「我发出去的消息」必须剔掉，不然会被当成「别人找我」→ 进待审 → 刷屏 ✗
        selfId: String(cfg?.self?.uin ?? '').trim(),
        state,
        opts: cfg?.listen ?? {},
        now,
        log,
        onMessage: async (msg) => {
          log(`[qq] 收到 ${msg.nickname || msg.userId}：${msg.text.slice(0, 40)}`)
          // ⚠️ 2026-11-04 18:15：投递「既没成功也没报错」——说明在某处提前 return 了。
          //   这里加一道**必经留痕**，每个分支都写一行，下次一眼看出卡在哪 ✗
          const trail = (what) => {
            try {
              fs.mkdirSync(path.join(dshHome, 'whale-channels'), { recursive: true })
              fs.appendFileSync(
                path.join(dshHome, 'whale-channels', 'qq-wake-error.txt'),
                `${new Date().toISOString()} [分拣] ${what} | msg=${msg.messageId ?? '?'} from=${msg.userId} waker=${waker ? '有' : '无'}\n`,
              )
            } catch { /* 记不上不影响 */ }
          }
          // 2026-11-04：记下「主人最后说话的时间」——
          //   主动找你（proactive）要靠它判断「他刚说过话，别打扰」✓
          if (String(msg.userId) === String(ownerId)) {
            state.lastUserMsgAt = now()
          }
          // ── 2026-11-04：**先看共用规则说该不该我说话** ──────────────────
          //   主人：「私聊和发动态只能选择一个平台」。
          //   之前这句话只有控制台看得见，运行时根本不看 → 两边同时叫醒她 ✗
          //   现在：私聊不在 QQ → 收到也**不叫醒**，只记日志（消息不丢，留在 OneBot 历史里）
          const rt = rulesNow()
          if (!rt.dm) {
            log(`[qq] 私聊现在归另一边（${rt.why}）→ 这条不叫醒她`)
            trail(`规则拦下（私聊归${rt.dm || '另一边'}，why=${rt.why}）`)
            return
          }
          // 2026-11-04 主人要的：**别人的话先过我一遍，报给他，他点头才回**
          const verdict = shouldAutoReply({ fromUserId: msg.userId, ownerId })
          trail(`分拣结果：${verdict.auto ? '主人本人→投递' : '别人/自己→待审'}`)
          if (verdict.auto) {
            // 2026-11-04：主人发消息时顺手记下他的昵称（跟 B 站那边 owner.name 对齐）
            //   只在名字变了的时候写一次，别每条消息都写盘 ✗
            try {
              const cached = String(readConfig()?.owner?.nickname ?? '')
              if (msg.nickname && msg.nickname !== cached) {
                const cfgMod = await importCoreModule('channel-config')
                cfgMod.createChannelConfig({ dshHome, channels: [{ id: 'qq' }] })
                  .writeChannel('qq', { owner: { nickname: msg.nickname } })
                log(`[qq] 记下主人的昵称：${msg.nickname}`)
              }
            } catch (e) { log(`[qq] 记昵称失败（不影响回话）：${e?.message ?? e}`) }
            // 2026-11-04 主人补的：「我主动提也可以选」
            //   他说「发语音」「发个表情包」→ 记成**这一次**的临时指定；
            //   过了 overrideTtlSec 就自动失效，不改我平时的默认 ✓
            try {
              const ov = readOverride(msg.text)
              if (ov) {
                override = { ...ov, at: now() }
                log(`[qq] 主人指定了这一次的发送方式：${ov.kind}`)
              }
            } catch (e) { log(`[qq] 读指定失败：${e?.message ?? e}`) }
            // 主人自己说的 → 直接投给会话（照旧）
            try { ctx?.emit?.('qq/message', msg) } catch {}
            // 2026-11-04 补的最后一块：**真的把她叫醒** ✓
            //   （之前只写了日志，人是哑的 —— 主人问「其他人发信息通知主人再回答做好了吗」那天落下的）
            try {
              if (waker) {
                trail('开始投递')
                const r = await waker.deliver(msg)
                if (r?.skipped) log(`[qq] 这条已经投过了，跳过：${msg.messageId ?? msg.text.slice(0, 12)}`)
                trail(`投递返回：ok=${r?.ok} skipped=${r?.skipped ?? '-'} session=${r?.sessionId ?? '-'}`)
                // ⚠️ 2026-11-04 18:32：投递成功之后**立刻**看一次回话文件。
                //   光靠 3 秒轮询也行，但会被 gapMs 拖慢；这里先推一把，回得快一点 ✓
                if (r?.ok) {
                  try { await replySender.tick() } catch (e) { log(`[qq] 回话发送失败：${e?.message ?? e}`) }
                }
              } else {
                // ⚠️ waker 没建起来 = 这条私信永远不会有人回。
                //   以前这里一声不响就 return 了（消息还被当成处理过的）✗
                log(`[qq] 没有 waker → 这条回不了：${msg.messageId ?? msg.text.slice(0, 12)}`)
                try {
                  const f = path.join(dshHome, 'whale-channels', 'qq-wake-error.txt')
                  fs.mkdirSync(path.dirname(f), { recursive: true })
                  fs.appendFileSync(f, `${new Date().toISOString()} 没投出去：${msg.messageId ?? ''} ${msg.text.slice(0, 60)}\n`)
                } catch { /* 记不上不影响 */ }
              }
            } catch (e) {
              // 投递报错也要留痕 —— 别让「没叫醒」只活在一行 console 里 ✗
              log(`[qq] 没叫醒：${e?.message ?? e}`)
              try {
                const f = path.join(dshHome, 'whale-channels', 'qq-wake-error.txt')
                fs.mkdirSync(path.dirname(f), { recursive: true })
                fs.appendFileSync(f, `${new Date().toISOString()} 投递失败：${msg.messageId ?? ''} ${e?.message ?? e}\n`)
              } catch { /* 记不上不影响 */ }
            }
            return
          }
          // 别人的 → 进待审队列 + 推一条私信给主人（推不出去也不影响进队 ✓）
          try {
            const added = pending.add({
              userId: msg.userId,
              messageId: msg.messageId,
              nickname: msg.nickname,
              text: msg.text,
              at: new Date(msg.time || now()).toISOString(),
            })
            if (!added.duplicate) {
              log(`[qq] 别人的消息进待审：${added.item.id}（${added.item.who}）`)
              // 2026-11-12：先只进队，等这个人安静 20 秒再合成一条推给他
              pendingNotifier.push({ whoId: msg.userId, whoName: added.item.who, text: msg.text })
            }
          } catch (e) {
            log(`[qq] 进待审队列失败：${e?.message ?? e}`)
          }
        },
      })

      const schedule = () => {
        if (stopped) return
        // ⚠️ 2026-11-04 晚修（代码审查抓到的 P1）：
        //   loop 是 async，setTimeout(loop) 的返回值没人接 ——
        //   loop 里任何一处抛错都会变成 unhandledRejection，
        //   而且**下一轮 schedule() 不会执行** ⇒ 私信轮询永久停摆 ✗
        //   表现：「一开始能收，过一会儿再也不回」。
        //   现在统一包一层 catch ✓
        timer = setTimeout(() => { void loop().catch((e) => {
          log(`[qq] 轮询出错（下一轮照常）：${e?.message ?? e}`)
          schedule()
        }) }, poller.nextDelayMs())
        if (typeof timer.unref === 'function') timer.unref()
      }
      async function loop() {
        if (stopped) return
        if (inQuietHours(cfg?.quietHours)) { schedule(); return }   // 安静时段照样收，只是不主动发
        // ⚠️ 用 try/finally：不管中间哪步行不行，**下一轮一定要排上** ✓
        try {
          await poller.pollOnce()
          try {
            writeJsonSafe(stateFile, { ...state, seen: (state.seen ?? []).slice(-500) })
          } catch (e) {
            // 存不下来不影响收消息，但要知道
            log(`[qq] 存轮询状态失败（不影响收消息）：${e?.message ?? e}`)
          }
        } finally {
          schedule()
        }
      }
      schedule()

      // ⚠️⚠️ 2026-11-08（对方反馈「收到消息不回」，但日志里连 [qq] 都没有）：
      //   这说明消息**根本没进到 onMessage** —— 不是"投递失败"，是"没收到"。
      //   以前这种情况在日志里一点痕迹都没有（轮询成功但拉 0 条也是静默的），
      //   只能干瞪眼。现在启动时**明确打一行**，并且写一份诊断文件 ✓
      log(`[qq] 私信轮询已启动（每 ${Number(cfg?.listen?.intervalSec ?? 8)} 秒；主人号=${ownerId || '没填！'}；自己的号=${String(cfg?.self?.uin ?? '') || '没填'}）`)
      try {
        fs.mkdirSync(path.join(dshHome, 'whale-channels'), { recursive: true })
        fs.writeFileSync(
          path.join(dshHome, 'whale-channels', 'qq-poll-status.txt'),
          [
            '# 私信轮询状态（每次启动覆盖）',
            `启动时间: ${new Date().toISOString()}`,
            `OneBot 地址: ${String(cfg?.onebot?.baseUrl ?? '')}`,
            `主人 QQ 号: ${ownerId || '(没填 — 收不到任何私信！)'}`,
            `自己登录的号: ${String(cfg?.self?.uin ?? '') || '(没填)'}`,
            `拉取间隔: ${Number(cfg?.listen?.intervalSec ?? 8)} 秒`,
            '',
            '主人号空着就收不到私信 —— 去「设置 → 养鱼 · QQ」填上再重启。',
            '收消息的处理过程看同目录的 qq-wake-error.txt。',
            '',
          ].join('\n'),
          'utf8',
        )
      } catch { /* 写不了不影响 */ }

      // ── 群聊（2026-11-07）──────────────────────────────────────────
      //
      // 主人：「把你拉进群聊，主人 @ 你就回答主人，别人 @ 你就先问主人再回」
      //
      // 结构上跟私信那条**完全平行**，只是多一层「哪个群」：
      //   · 一次只问一个群（轮着来），各自留一份命中记录
      //   · 主人 @ 我 → 直接叫醒，她当场回（回群里，行首写 [群:xxx]）
      //   · 别人 @ 我 → 进待审队列 + 推一条给他，他点头才发 ✓
      //
      // ⚠️ 整个群聊只在**配了群号并且 listen 开着**时才跑 ——
      //   没配就不问、不连、不报错（跟「关着的通道不干活」同一个道理）✓
      let groupTimer = null
      let groupSeen = { keys: [] }
      let lastSelfNick = ''
      const groupLoop = async () => {
        if (stopped) return
        try {
          const liveCfg = readConfig() ?? {}
          const gopts = normalizeGroupOpts(liveCfg.group)
          if (!gopts.listen || gopts.groups.filter((g) => g.enabled).length === 0) return
          // 拿一次我自己的昵称（群里没有 at 段时靠正文里「@昵称」兜底）
          if (!lastSelfNick) {
            try {
              const info = await ob.getLoginInfo().catch(() => null)
              lastSelfNick = String(info?.nickname ?? liveCfg?.self?.nickname ?? '')
            } catch { /* 拿不到就算了，不靠这个也能判 */ }
          }
          const gp = createGroupPoller({
            ob,
            groups: gopts.groups,
            selfId: String(liveCfg?.self?.uin ?? '').trim(),
            ownerId,
            opts: gopts,
            selfNickname: lastSelfNick,
            seen: groupSeen,
            now,
            log,
          })
          const r = await gp.pollOnce()
          groupSeen = gp.seen
          const fresh = (r.fresh ?? []).slice(0, gopts.maxPerPoll)
          for (const item of fresh) {
            log(`[qq] 群 ${item.groupId} 里 ${item.nickname}（${item.kind === 'owner' ? '主人' : '别人'}）喊了我：${item.text.slice(0, 40)}`)
            if (item.kind === 'owner') {
              // 主人本人 → 直接回，不用等点头
              if (waker) {
                try {
                  const w = await waker.deliverGroup(item)
                  if (w?.ok) { try { await replySender.tick() } catch (e) { log(`[qq] 回话发送失败：${e?.message ?? e}`) } }
                } catch (e) {
                  log(`[qq] 群消息没叫醒：${e?.message ?? e}`)
                  try {
                    fs.appendFileSync(
                      path.join(dshHome, 'whale-channels', 'qq-wake-error.txt'),
                      `${new Date().toISOString()} 群投递失败：${item.groupId}/${item.messageId ?? ''} ${e?.message ?? e}\n`,
                    )
                  } catch { /* 记不上不影响 */ }
                }
              }
              state.lastUserMsgAt = now()
            } else if (gopts.askWhenOthers) {
              // 别人 @ 我 → 进待审 + 推给他（跟私信那条队是**同一份**）
              try {
                const added = pending.add({
                  userId: item.userId,
                  messageId: item.messageId,
                  nickname: item.nickname,
                  text: item.text,
                  kind: 'group',
                  groupId: item.groupId,
                  groupName: item.groupName,
                  context: item.context,
                  at: new Date(item.at || now()).toISOString(),
                })
                if (!added.duplicate) {
                  log(`[qq] 群里别人的话进待审：${added.item.id}（${added.item.who} @ ${item.groupId}）`)
                  pendingNotifier.push({ whoId: item.userId, whoName: added.item.who, text: item.text })
                }
              } catch (e) {
                log(`[qq] 群消息进待审失败：${e?.message ?? e}`)
              }
            } else {
              // 他关了「先问他」→ 就当一般聊天直接叫醒（不进队）
              if (waker) { try { await waker.deliverGroup(item) } catch (e) { log(`[qq] 群消息没叫醒：${e?.message ?? e}`) } }
            }
          }
        } catch (e) {
          log(`[qq] 群轮询这一拍出错了：${e?.message ?? e}`)
        }
      }
      const groupTick = () => {
        if (stopped) return
        const interval = Math.max(5, Number(readConfig()?.listen?.groupIntervalSec ?? 20)) * 1000
        // ⚠️ 2026-11-04 晚修（同 loop 那条）：groupLoop 抛错时原来不会 groupTick()，
        //   群轮询整条链就死了 ✗ 现在 try/finally 保证下一轮一定排上 ✓
        groupTimer = setTimeout(() => {
          groupTimer = null
          if (stopped) return
          void groupLoop()
            .catch((e) => log(`[qq] 群轮询出错（下一轮照常）：${e?.message ?? e}`))
            .finally(() => groupTick())
        }, interval)
        if (typeof groupTimer.unref === 'function') groupTimer.unref()
      }
      // 启动先等 20 秒（等宿主把会话挂好，也错开私信第一轮）
      groupTimer = setTimeout(() => {
        groupTimer = null
        if (stopped) return
        void groupLoop()
          .catch((e) => log(`[qq] 群轮询出错（下一轮照常）：${e?.message ?? e}`))
          .finally(() => groupTick())
      }, 20_000)
      if (typeof groupTimer.unref === 'function') groupTimer.unref()

      // ── 作息：到点自己醒 ─────────────────────────────────────────
      //
      // ⚠️ 2026-11-04 新增（主人：「QQ养鱼独立出来用好像做不到哔站的效果，像作息、醒来时间」）。
      //   之前 QQ 只有「收到消息才反应」，她不会自己想起主人 —— 那就不算养鱼了 ✗
      //   现在和 B 站一样：按 night.windows 到点醒来，再按 proactive.chance 决定主动说话。
      //
      //   注意两个开关是分开的：
      //     · night.windows 决定「什么时候醒」
      //     · proactive.enabled 决定「醒来后说不说话」
      //   只醒不说话也有用（她会去读日记、想事情），所以不要合成一个 ✗
      let wakeTimer = null
      const wakeTickMs = 60_000          // 一分钟看一次，够用也不费
      const wakeStateFile = path.join(dshHome, 'whale-channels', 'qq-night-state.json')
      let nightState = readJsonSafe(wakeStateFile) ?? {}

      const nightTick = async () => {
        if (stopped) return
        try {
          const liveCfg = readConfig() ?? {}
          const night = liveCfg.night ?? {}
          const verdict = shouldWakeNow({ night, state: nightState, now: now() })
          if (!verdict.wake) return

          // ⚠️ 2026-11-04 晚修（代码审查抓到）：
          //   原来是「先记醒过了 → 再叫醒」。叫醒失败也算醒过 ⇒
          //   当天那个窗口**不会再试第二次**，等于睡过去了 ✗
          //   现在改成：先只记一个"试过了"的短锁（防同一分钟狂叫），
          //   真正叫醒成功之后才记「这个窗口醒过了」✓
          const tryKey = `${verdict.window?.start ?? ''}-${verdict.window?.end ?? ''}`
          const lastTry = Number(nightState.lastWakeTryAt) || 0
          if (now() - lastTry < 60 * 1000) return   // 一分钟内别重复试

          const windowText = verdict.window ? `${verdict.window.start}-${verdict.window.end}` : ''
          log(`[qq] 到点了（${windowText}），醒来`)

          // 安静时段不打扰
          if (inQuietHours(liveCfg.quietHours)) { log('[qq] 现在是安静时段，只醒不说话'); return }

          // 共用规则：私聊不在 QQ → 醒了也不说话（不抢 B 站的活）
          const rules = rulesNow()
          if (rules && rules.dm === false) { log('[qq] 私聊不在 QQ，醒了也不说话'); return }

          const pro = liveCfg.proactive ?? {}
          const k = dayKeyOfLocal(now())
          const sentToday = nightState.proactiveDayKey === k ? Number(nightState.proactiveToday) || 0 : 0
          const decided = shouldBeProactive({
            chance: pro.enabled === false ? 0 : Number(pro.chance ?? 0),
            dailyMax: Number(pro.dailyMax ?? 0),
            sentToday,
            lastUserAt: Number(state.lastUserMsgAt) || 0,
            now: now(),
            quietMin: Number(pro.quietMin ?? 30),
          })
          if (!decided.should) {
            log(`[qq] 醒了但不主动说话：${decided.reason}`)
            // 这种情况算"这个窗口处理过了"，不然每分钟都要再算一遍
            nightState = recordWake(nightState, now(), verdict.window)
            writeJsonSafe(wakeStateFile, nightState)
            return
          }

          if (!waker) { log('[qq] 没有 waker，醒着但没处说话'); return }

          // 先记"试过一次"，避免投递卡住时每分钟重试
          nightState = { ...nightState, lastWakeTryAt: now(), lastWakeTryKey: tryKey }
          writeJsonSafe(wakeStateFile, nightState)

          await waker.deliverProactive({ windowText })
          // ✅ 真的叫醒了，这时候才记「这个窗口醒过了」
          nightState = {
            ...recordWake(nightState, now(), verdict.window),
            proactiveDayKey: k,
            proactiveToday: sentToday + 1,
          }
          writeJsonSafe(wakeStateFile, nightState)
        } catch (e) {
          log(`[qq] 作息这一拍出错了：${e?.message ?? e}`)
        }
      }
      const nightLoop = () => {
        if (stopped) return
        void nightTick()
        wakeTimer = setTimeout(nightLoop, wakeTickMs)
        if (typeof wakeTimer.unref === 'function') wakeTimer.unref()
      }
      // 启动后先等 30 秒再开始看（等宿主把会话服务都挂好）
      wakeTimer = setTimeout(nightLoop, 30_000)
      if (typeof wakeTimer.unref === 'function') wakeTimer.unref()

      return {
        stop() {
          stopped = true
          if (timer) clearTimeout(timer)
          if (wakeTimer) clearTimeout(wakeTimer)
          // 2026-11-07：群轮询也要停，不然通道关了她还在问群
          if (groupTimer) clearTimeout(groupTimer)
          // ⚠️ 2026-11-04 18:32：回话发送器也要停，不然关掉通道还在往外发
          try { replySender.stop() } catch { /* 停不下来也别拦住别的 */ }
          // 2026-11-12：停之前把还没推的待审汇总先推出去，别闷着
          try { pendingNotifier.dispose() } catch { /* 推不出去也不拦着停 */ }
          writeJsonSafe(stateFile, { ...state, seen: state.seen.slice(-500) })
          try { writeJsonSafe(wakeStateFile, nightState) } catch { /* 停的时候存不上就算了 */ }
          log('[qq] 通道已停')
        },
        poller,
        replySender,
        onebot: ob,
      }
    },

    async deps(ctx) {
      const cfg = readConfig()
      const items = []
      const onebot = cfg?.onebot ?? {}
      items.push({ name: 'OneBot 地址', ok: Boolean(onebot.baseUrl), detail: onebot.baseUrl || '没填' })
      items.push({
        name: '主人的 QQ 号',
        ok: /^\d{5,16}$/.test(String(cfg?.owner?.uin ?? '')),
        detail: cfg?.owner?.uin ? `${cfg.owner.uin}` : '没填（填了才能收私信）',
      })
      // ⚠️ 2026-11-04 晚加的防呆（线上反馈「发消息没反应」，主人自己也踩过）：
      //   「主人的 QQ 号」和「我登录的 QQ 号」填成同一个时，
      //   她其实是在**给自己发消息** —— 收得到、回不出，看起来就是"没反应" ✗
      //   这个坑没有任何报错，所以必须在这里显式拦一下 ✓
      {
        const selfUin = String(cfg?.self?.uin ?? '').trim()
        const ownerUin = String(cfg?.owner?.uin ?? '').trim()
        if (selfUin && ownerUin && selfUin === ownerUin) {
          items.push({
            name: '主人和机器人不是同一个号',
            ok: false,
            detail: `两个都是 ${ownerUin} —— 这样她是在给自己发消息，回不出来。`
              + '「主人的 QQ 号」要填**你用来聊天的那个号**，不能和机器人号一样',
          })
        } else if (selfUin && ownerUin) {
          items.push({ name: '主人和机器人不是同一个号', ok: true, detail: `主人 ${ownerUin} / 机器人 ${selfUin}` })
        }
      }
      // 真的去问一句 OneBot 活不活
      try {
        const ob = createOneBot({ baseUrl: onebot.baseUrl, token: onebot.token, timeoutMs: 3000 })
        const info = await ob.getLoginInfo().catch(async () => {
          await ob.getStatus()
          return null
        })
        items.push({ name: 'OneBot 连通', ok: true, detail: info?.nickname ? `已登录：${info.nickname}（${info.user_id}）` : '能连上' })
      } catch (e) {
        items.push({ name: 'OneBot 连通', ok: false, detail: String(e?.message ?? e).slice(0, 200) })
      }

      // ── NapCat WebUI（扫码登录走的是这条）2026-11-04 晚补 ──────────────
      //   主人：「我重启了又用不了」，截图只有一句「出错了」。
      //   上面那条 OneBot 检查的是「能不能收消息」，扫码走的是 WebUI —— 两码事 ✗
      //   所以把 WebUI 单独查一遍：能不能连 → 密码对不对
      const webui = cfg?.webui ?? {}
      const webuiUrl = String(webui.url ?? '').trim()
      if (!webuiUrl) {
        items.push({ name: 'NapCat 网页地址', ok: false, detail: '没填（扫码登录要用它）' })
      } else {
        try {
          // ⚠️ 参数名是 webuiUrl / webuiToken（不是 baseUrl / token）——
          //   写成 baseUrl 会静默变成空字符串，自检永远报「还没填地址」✗ 已实测踩过
          const lg = createNapCatLogin({ webuiUrl, webuiToken: String(webui.token ?? ''), log: () => {} })
          const r = await lg.inspect()
          items.push({ name: 'NapCat WebUI', ok: true, detail: r })
        } catch (e) {
          const msg = String(e?.message ?? e).slice(0, 240)
          items.push({
            name: 'NapCat WebUI',
            ok: false,
            detail: /没在跑|ECONNREFUSED|ECONNRESET|EPIPE|超时/.test(msg)
              ? `${msg} → 双击 C:\\NapCat\\start-napcat.bat 启动它`
              : msg,
          })
        }
      }
      return { ok: items.every((i) => i.ok), items }
    },

    routes: {
      // ══ 记忆备份 / 恢复（2026-11-04 晚，主人：「QQ养鱼的控制台还少了记忆恢复」）══
      //
      //   之前 QQ 控制台只写了「去命令行跑 node tools/qq-backup.mjs」，
      //   而 B 站那边是**有按钮的**（看一眼 + 备份 + 预演恢复 + 真恢复）✗
      //   现在对齐：三个接口，跟 tools/qq-backup.mjs 用同一份白名单 ✓
      //
      //   GET  /backup/inspect?dir=   看一眼备份目录里有什么（不动任何文件）
      //   POST /backup/export         {to?}   备份到桌面（默认「邦邦的备份」）
      //   POST /backup/import         {from, dry?}  恢复；**默认只预演**，要真写必须 dry:false
      'GET /backup/inspect': async (req, res, { json }) => {
        const u = new URL(req.url, 'http://localhost')
        const home = process.env.USERPROFILE || process.env.HOME || '.'
        const dir = String(u.searchParams.get('dir') ?? backupDirFor(home, dshHome))
        const abs = path.resolve(dir)
        if (!fs.existsSync(abs)) {
          json(res, 200, { ok: false, error: '还没有备份目录：' + abs, dir: abs, items: [] })
          return
        }
        const items = BACKUP_WHITELIST.map(([src, rel]) => {
          const p = path.join(abs, rel)
          let ok = false; let size = 0; let mtime = null
          try { const st = fs.statSync(p); ok = st.isFile(); size = st.size; mtime = st.mtime.toISOString() } catch { /* 没有 */ }
          return { rel, ok, size, mtime }
        })
        const hasSessions = fs.existsSync(path.join(abs, '记忆', 'sessions'))
        json(res, 200, {
          ok: true, dir: abs, items, hasSessions,
          canRestore: items.filter((i) => i.ok).length,
          total: items.length,
        })
      },

      'POST /backup/export': async (req, res, { readBody, json }) => {
        const home = process.env.USERPROFILE || process.env.HOME || '.'
        let b = {}
        try { b = JSON.parse((await readBody(req)) || '{}') } catch { /* 空 body 也行 */ }
        const dir = path.resolve(String(b.to ?? backupDirFor(home, dshHome)))
        let n = 0; let miss = 0
        const absent = []
        try {
          for (const [srcRel, dstRel] of BACKUP_WHITELIST) {
            const src = path.join(home, srcRel)
            const dst = path.join(dir, dstRel)
            if (!fs.existsSync(src)) {
              // ⚠️ 2026-11-04 晚（线上反馈：「备份里并没有日记之类的东西」）：
              //   缺的文件不再"悄悄跳过" —— 记下来，最后写进备份里的
              //   「怎么复活她.md」，让人一眼看出"是还没有，不是丢了" ✓
              miss += 1
              absent.push({ rel: dstRel, srcRel })
              continue
            }
            fs.mkdirSync(path.dirname(dst), { recursive: true })
            fs.cpSync(src, dst, { recursive: true })
            n += 1
          }
          // 对话全文
          if (fs.existsSync(path.join(dshHome, 'sessions'))) {
            try {
              fs.cpSync(path.join(dshHome, 'sessions'), path.join(dir, '记忆', 'sessions'), { recursive: true })
              n += 1
            } catch { /* 拷不动就算了 */ }
          }
          // ⚠️ 一定要写这份说明 —— 刚装好的机器上日记还没生成，
          //   用户打开备份看到"空的"，会以为备份坏了 ✗
          try {
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, '怎么复活她.md'), buildRestoreReadme({ n, absent, dir }), 'utf8')
          } catch { /* 写不了说明不影响备份本身 */ }
        } catch (e) {
          json(res, 500, { ok: false, error: String(e?.message ?? e).slice(0, 200) })
          return
        }
        json(res, 200, { ok: true, dir, copied: n, missing: miss, absent: absent.map((a) => a.rel), at: new Date().toISOString() })
      },

      'POST /backup/import': async (req, res, { readBody, json }) => {
        const home = process.env.USERPROFILE || process.env.HOME || '.'
        let b = {}
        try { b = JSON.parse((await readBody(req)) || '{}') } catch { /* 空 */ }
        const from = String(b.from ?? '').trim()
        if (!from) { json(res, 400, { ok: false, error: '要传 from（备份目录路径）' }); return }
        const abs = path.resolve(from)
        if (!fs.existsSync(abs)) { json(res, 400, { ok: false, error: '目录不存在：' + abs }); return }
        // ⚠️ 默认**只预演** —— 恢复会覆盖现在的日记/设置，必须先让人看清楚
        const dryRun = b.dry !== false
        let n = 0
        const done = []
        for (const [tgtRel, srcRel] of BACKUP_WHITELIST) {
          const src = path.join(abs, srcRel)
          if (!fs.existsSync(src)) continue
          const tgt = path.join(home, tgtRel)
          if (!dryRun) {
            fs.mkdirSync(path.dirname(tgt), { recursive: true })
            fs.cpSync(src, tgt, { recursive: true, force: true })
          }
          done.push(tgtRel)
          n += 1
        }
        // 对话全文：默认不覆盖（怕盖掉更新的记录）
        let sessions = 'not-requested'
        const sessSrc = path.join(abs, '记忆', 'sessions')
        if (b.sessions === true && fs.existsSync(sessSrc)) {
          sessions = 'copied'
          if (!dryRun) {
            try { fs.cpSync(sessSrc, path.join(dshHome, 'sessions'), { recursive: true }) } catch (e) {
              sessions = 'failed: ' + String(e?.message ?? e).slice(0, 100)
            }
          }
        } else if (fs.existsSync(sessSrc)) {
          sessions = 'skipped（要恢复对话全文请传 sessions:true）'
        }
        json(res, 200, { ok: true, from: abs, dry: dryRun, restored: n, files: done, sessions })
      },

      // ── 我的账号 / 主人的账号（2026-11-04 主人问「自己的ID和QQ号和主人的ID和QQ号做了没」）──
      //   跟 B 站那边对齐：self（她的）和 owner（他的），两个都能看能改 ✓
      //   密码/token 一律不回显（存的是号，不是密码）
      'GET /accounts': async (req, res, { json }) => {
        const cfg = readConfig()
        const storedSelf = { uin: '', nickname: '', at: '', ...(cfg?.self ?? {}) }
        const owner = { uin: '', nickname: '', ...(cfg?.owner ?? {}) }

        // ⚠️ 2026-11-04 晚（主人：「为什么已经登录的和最上面显示的不一样」）：
        //   「我登录的 QQ 号」原来只读**配置文件**里存的值 —— 那是上次登录时写下的。
        //   如果之后在 NapCat 里换了号（快登、WebUI 里换、或自动登录），
        //   配置里的 self 就成了**过期的**，和下面「已登录：xxx」对不上 ✗
        //
        //   现在：顺便问一次 NapCat 现在到底登的是谁。
        //     · 拿到了 → 以实时为准（并顺手把配置改正）
        //     · 没登录 / 问不到 → 用配置里的旧值（至少有个参考）
        let liveSelf = null
        try {
          const acc = await loginFor(cfg).whoAmI()
          if (acc?.uin) {
            liveSelf = { uin: String(acc.uin), nickname: acc.nickname ?? '', online: acc.online === true }
            // 和配置不一致 → 说明换过号，把配置改正（下次不用再问）
            if (String(storedSelf.uin) !== liveSelf.uin || String(storedSelf.nickname ?? '') !== liveSelf.nickname) {
              try {
                const cfgMod = await importCoreModule('channel-config')
                const store = cfgMod.createChannelConfig({ dshHome, channels: [{ id: 'qq' }] })
                store.writeChannel('qq', { self: { ...storedSelf, ...liveSelf, at: new Date().toISOString() } })
              } catch { /* 写不进去也不影响读 */ }
            }
          }
        } catch { /* NapCat 没开 / 没登录 → 用配置里的 */ }

        const self = liveSelf ? { ...storedSelf, ...liveSelf, live: true } : { ...storedSelf, live: false }
        json(res, 200, { ok: true, self, owner })
      },
      // 问 NapCat 现在登的是哪个号，记成 self（登录成功时也会自动记）
      'POST /accounts/refresh': async (req, res, { json }) => {
        const cfg = readConfig()
        try {
          const login = loginFor(cfg)
          const acc = await login.whoAmI()
          if (!acc) { json(res, 200, { ok: false, error: 'NapCat 那边没拿到登录信息（现在是没登录？）' }); return }
          const patch = { self: { uin: acc.uin, nickname: acc.nickname ?? '', at: new Date().toISOString() } }
          // 用 core 的通道配置写回（只动 self 这一块）
          // ⚠️ 走 importCoreModule：link 安装下 `import('dsh-whale-core/config')` 会找不到 ✗
          const cfgMod = await importCoreModule('channel-config')
          const store = cfgMod.createChannelConfig({ dshHome, channels: [{ id: 'qq' }] })
          store.writeChannel('qq', patch)
          json(res, 200, { ok: true, self: patch.self })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },

      'GET /status': async (req, res, { json }) => {
        const stateFile = path.join(dshHome, 'whale-channels', 'qq-state.json')
        json(res, 200, { ok: true, state: readJsonSafe(stateFile) ?? null })
      },

      // ── 群聊（2026-11-07，主人：「把你拉进群聊」）────────────────────
      //
      //   为什么要一个「拉群列表」接口：
      //     光让主人手填群号，他得先去群里查号、再看是不是打错了 —— 一步都不能省 ✗
      //     NapCat 有 get_group_list，直接把我加过的群摆出来给他挑就行 ✓
      //
      //   ⚠️ 拿不到（没登录 / 实现不给这个 action）不算错，前端照样能手填 ✓
      'GET /groups': async (req, res, { json }) => {
        const cfg = readConfig()
        const g = normalizeGroupOpts(cfg?.group)
        let live = []
        let liveError = ''
        try {
          const ob = createOneBot({ baseUrl: cfg?.onebot?.baseUrl, token: cfg?.onebot?.token, timeoutMs: 4000 })
          const list = await ob.getGroupList()
          live = (Array.isArray(list) ? list : []).map((x) => ({
            id: String(x?.group_id ?? ''),
            name: String(x?.group_name ?? ''),
            memberCount: Number(x?.member_count) || 0,
          })).filter((x) => x.id)
        } catch (e) { liveError = String(e?.message ?? e).slice(0, 200) }
        // 配上但 NapCat 那边已经没有的群，也列出来（标出来，别悄悄消失）
        const configured = g.groups.map((x) => ({
          ...x,
          live: live.length ? live.some((l) => l.id === x.id) : null,
          // 2026-11-07：这个群是不是主人邀请她进的（不是的话她不会理）
          invitedByOwner: x.invitedBy ? x.invitedBy === 'owner' : true,
        }))
        json(res, 200, {
          ok: true,
          listen: g.listen,
          needAt: g.needAt,
          askWhenOthers: g.askWhenOthers,
          ownerOnly: g.ownerOnly,
          configured,
          live,
          liveError,
          hint: liveError
            ? '拿不到你的群列表（NapCat 没登录，或这个实现没开 get_group_list）→ 可以手动填群号'
            : '',
        })
      },
      // 把一个群加进名单 / 从名单里拿掉（控制台点一下就走这里）
      //
      // ⚠️ 2026-11-07 主人：「群聊只有我能邀请你，你不能乱进」
      //
      //   这个接口就是「邀请」这个动作 —— 而且**只认主人**。
      //   所以：
      //     ① 记录 `invitedBy: 'owner'`（谁放的，写清楚，以后查得到）
      //     ② 先问 NapCat：「这个群我真的在里面吗？」不在里面就拒绝
      //        （不在里面还加进来，等于她答应去一个她进不去的地方 ✗）
      //     ③ 从群列表里挑的时候带上群名，主人一眼看得出加的是哪个
      'POST /groups/add': async (req, res, { readBody, json }) => {
        let b = {}
        try { b = JSON.parse((await readBody(req)) || '{}') } catch { /* 空 */ }
        const id = String(b.id ?? '').trim()
        if (!/^\d{5,16}$/.test(id)) { json(res, 400, { ok: false, error: '群号不对' }); return }
        const cfg = readConfig()
        const g = normalizeGroupOpts(cfg?.group)

        // ② 她真的在这个群里吗（问不到就不拦，但要说出来）
        let inGroup = null
        let checkError = ''
        if (b.force !== true) {
          try {
            const ob = createOneBot({ baseUrl: cfg?.onebot?.baseUrl, token: cfg?.onebot?.token, timeoutMs: 4000 })
            const list = await ob.getGroupList()
            if (Array.isArray(list)) inGroup = list.some((x) => String(x?.group_id ?? '') === id)
          } catch (e) { checkError = String(e?.message ?? e).slice(0, 160) }
          if (inGroup === false) {
            json(res, 400, {
              ok: false,
              error: `她不在群 ${id} 里 —— 先把她的号拉进那个群，再加到这里`,
              hint: '拉进群之后点「刷新群列表」，会自己出现在下面',
            })
            return
          }
        }

        const nowIso = new Date().toISOString()
        const hit = g.groups.find((x) => x.id === id)
        if (hit) {
          // 已经在名单里：只补名字/标记，不重复加
          if (b.name && !hit.name) hit.name = String(b.name).slice(0, 60)
          hit.invitedBy = hit.invitedBy || 'owner'
        } else {
          g.groups.push({
            id,
            name: String(b.name ?? '').slice(0, 60),
            enabled: true,
            invitedBy: 'owner',   // ⚠️ 只认这个值；别的来源一律不算「主人邀请」
            at: nowIso,
          })
        }
        const w = await writeConfigSafe({ group: g })
        if (!w.ok) { json(res, 500, { ok: false, error: w.error }); return }
        json(res, 200, {
          ok: true, group: g, saved: w.how,
          checked: inGroup === true ? '她在那个群里 ✓' : (inGroup === null ? `没问到（${checkError || 'NapCat 没开'}），先按主人说的加` : ''),
        })
      },
      'POST /groups/remove': async (req, res, { readBody, json }) => {
        let b = {}
        try { b = JSON.parse((await readBody(req)) || '{}') } catch { /* 空 */ }
        const id = String(b.id ?? '').trim()
        const cfg = readConfig()
        const g = normalizeGroupOpts(cfg?.group)
        g.groups = g.groups.filter((x) => x.id !== id)
        const w = await writeConfigSafe({ group: g })
        if (!w.ok) { json(res, 500, { ok: false, error: w.error }); return }
        json(res, 200, { ok: true, group: g, saved: w.how })
      },

      // ── 快登（2026-11-04 晚，主人：「为什么还是扫不出来」）────────────────
      //
      //   ⚠️ 查出来：这台机器上 NapCat 里已经有号登录过了，
      //   它启动日志直接写「可用于快速登录 of QQ：1. xxx 2. yyy」——
      //   这种情况下**根本不用扫码**，直接快登就进去了 ✓
      //   （实测：快登 → loginPhase: ready, isLogin: true, OneBot 3000 起来了）
      'GET /auth/quick': async (req, res, { json }) => {
        try {
          const list = await loginFor(readConfig()).quickList()
          json(res, 200, { ok: true, list })
        } catch (e) {
          // 快登只是"更省事的一条路"，拿不到不算错 —— 还能扫码
          json(res, 200, { ok: false, list: [], error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      'POST /auth/quick': async (req, res, { readBody, json }) => {
        try {
          let body = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { /* 空 */ }
          const cfg = readConfig()
          // 不传号就用设置里的"我登录的 QQ 号"
          const uin = String(body.uin ?? cfg?.self?.uin ?? '').trim()
          const r = await loginFor(cfg).quickLogin(uin)
          // 登上之后立刻记住这是谁
          // ⚠️ 2026-11-04 晚：原来只在 r.ok 为 true 时记 —— 但 NapCat 对已登录的号
          //   会回「QQ Is Logined」，两种都算登上，所以这里改成**只要没抛错就去问一次** ✓
          try {
            const acc = await loginFor(readConfig()).whoAmI()
            if (acc?.uin) {
              const cur = readConfig()
              await writeConfigSafe({
                self: {
                  ...(cur.self ?? {}),
                  uin: String(acc.uin),
                  nickname: acc.nickname ?? '',
                  at: new Date().toISOString(),
                },
              })
            }
          } catch { /* 记不上不影响登录 */ }
          json(res, 200, r)
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },

      // ── 扫码登录（跟 B 站那套流程一样：start → 二维码 → 隔 2 秒 poll）──────
      //   跟 B 站一样的规矩：二维码和账号信息之外，**任何 token 都不回给浏览器** ✓
      'POST /auth/qr/start': async (req, res, { json }) => {
        try {
          const state = await loginFor(readConfig()).start()
          json(res, 200, { ok: true, ...state })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      'POST /auth/qr/poll': async (req, res, { readBody, json }) => {
        let id = ''
        try { id = String(JSON.parse((await readBody(req)) || '{}').id ?? '') } catch { /* 空 body 也算错 */ }
        try {
          const state = await loginFor(readConfig()).poll(id)
          json(res, 200, { ok: true, ...state })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      'POST /auth/qr/cancel': async (req, res, { readBody, json }) => {
        let id = ''
        try { id = String(JSON.parse((await readBody(req)) || '{}').id ?? '') } catch {}
        try {
          json(res, 200, { ok: true, ...loginFor(readConfig()).cancel(id) })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },

      // ── 待审队列（别人发来的话）──────────────────────────────────────
      'GET /pending': async (req, res, { json }) => {
        const store = createPendingStore({ dshHome })
        const items = store.list({ status: 'pending' })
        json(res, 200, { ok: true, count: items.length, items })
      },
      'POST /pending/approve': async (req, res, { readBody, json }) => {
        const body = JSON.parse((await readBody(req)) || '{}')
        const id = String(body.id ?? '')
        const store = createPendingStore({ dshHome })
        const item = store.get(id)
        if (!item) { json(res, 404, { ok: false, error: `没有这条待审：${id}` }); return }
        const cfgNow = readConfig()
        const text = String(body.text ?? item.draft ?? '').trim()
        if (!text) { json(res, 400, { ok: false, error: '没有要发的内容（草稿是空的，你也没给新正文）' }); return }
        // ⚠️ 2026-11-07 主人：「群聊只有我能邀请你，你不能乱进」
        //   「点头」本身也是一种邀请 —— 但前提是那个群本来就在他给的名单里。
        //   名单外的群，就算他在页面上点了「发」，也不该让这条出得去 ✗
        if (item.kind === 'group') {
          const gopts = normalizeGroupOpts(cfgNow?.group)
          const v = canReplyToGroup(gopts, item.groupId)
          if (!v.ok) {
            json(res, 400, { ok: false, error: `这个群她不该说话：${v.reason}`, hint: '要她在那个群说话，先去「群聊」把群加进名单' })
            return
          }
        }
        try {
          const ob = createOneBot({ baseUrl: cfgNow?.onebot?.baseUrl, token: cfgNow?.onebot?.token })
          // ⚠️ 2026-11-07：群待审要**发回那个群**，不是发私信。
          //   发私信的话主人会看到「我回的话」出现在自己的窗口里，群里的人什么都没收到 ✗
          const data = item.kind === 'group'
            ? await ob.sendGroup(item.groupId, text)
            : await ob.sendPrivate(item.userId, text)
          const taken = store.take(id)   // ⚠️ 发成功了才出队；失败就留着，绝不悄悄丢 ✗
          json(res, 200, { ok: true, sent: true, to: item.kind === 'group' ? `群 ${item.groupId}` : '私信', messageId: data?.message_id ?? null, item: taken })
        } catch (e) {
          json(res, 200, { ok: false, error: `没发出去（还留在队列里）：${String(e?.message ?? e).slice(0, 200)}` })
        }
      },
      'POST /pending/drop': async (req, res, { readBody, json }) => {
        const body = JSON.parse((await readBody(req)) || '{}')
        const store = createPendingStore({ dshHome })
        const hit = store.drop(String(body.id ?? ''), { reason: String(body.reason ?? '') })
        if (!hit) { json(res, 404, { ok: false, error: '没有这条待审' }); return }
        json(res, 200, { ok: true, item: hit })
      },
      'POST /pending/revise': async (req, res, { readBody, json }) => {
        const body = JSON.parse((await readBody(req)) || '{}')
        const store = createPendingStore({ dshHome })
        const hit = store.revise(String(body.id ?? ''), String(body.text ?? ''))
        if (!hit) { json(res, 404, { ok: false, error: '没有这条待审' }); return }
        json(res, 200, { ok: true, item: hit })
      },

      'POST /test': async (req, res, { readBody, json }) => {
        const cfg = readConfig()
        const uin = String(cfg?.owner?.uin ?? '').trim()
        if (!/^\d{5,16}$/.test(uin)) { json(res, 400, { ok: false, error: '还没填主人的 QQ 号' }); return }
        const body = JSON.parse((await readBody(req)) || '{}')
        const text = String(body.text ?? '这是一条来自养鱼的测试消息 🐟').slice(0, 200)
        try {
          const ob = createOneBot({ baseUrl: cfg?.onebot?.baseUrl, token: cfg?.onebot?.token })
          const data = await ob.sendPrivate(uin, text)
          json(res, 200, { ok: true, messageId: data?.message_id ?? null })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      'POST /poke': async (req, res, { json }) => {
        const cfg = readConfig()
        const uin = String(cfg?.owner?.uin ?? '').trim()
        try {
          const ob = createOneBot({ baseUrl: cfg?.onebot?.baseUrl, token: cfg?.onebot?.token })
          await ob.sendPoke(uin)
          json(res, 200, { ok: true })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },

      // ── 表情包库（2026-11-04 主人要的）──────────────────────────────
      'GET /stickers': async (req, res, { json }) => {
        const cfg = readConfig()
        const lib = createStickerLibrary({ dshHome, opts: cfg?.sticker ?? {} })
        json(res, 200, { ok: true, count: lib.list().length, todayCount: lib.countToday(), perDay: lib.opts.perDay, items: lib.list() })
      },
      // 存一个：body 里给 { text?, note?, source? }；图从 URL / 本地路径 / base64 来
      'POST /stickers/save': async (req, res, { readBody, json }) => {
        const cfg = readConfig()
        const lib = createStickerLibrary({ dshHome, opts: cfg?.sticker ?? {} })
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          let data = null
          let mime = String(body.mime ?? 'image/gif')
          if (body.base64) { data = Buffer.from(String(body.base64), 'base64') }
          else if (body.path) { data = fs.readFileSync(String(body.path)) }
          else if (body.url) {
            const r = await fetch(String(body.url))
            if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
            mime = r.headers.get('content-type') ?? mime
            data = Buffer.from(await r.arrayBuffer())
          } else throw new Error('要给我 base64 / path / url 其中一个')
          const out = lib.saveSticker({ data, mime, source: body.source ?? '', note: body.note ?? '' })
          json(res, 200, out.ok ? { ok: true, item: out.item, remainingToday: out.remainingToday } : { ok: false, error: out.reason })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      'POST /stickers/send': async (req, res, { readBody, json }) => {
        const cfg = readConfig()
        const uin = String(cfg?.owner?.uin ?? '').trim()
        const lib = createStickerLibrary({ dshHome, opts: cfg?.sticker ?? {} })
        const body = JSON.parse((await readBody(req)) || '{}')
        const picked = body.id ? lib.list().find((x) => x.id === body.id) : lib.pickRandom()
        if (!picked) { json(res, 400, { ok: false, error: '没有可发的表情包' }); return }
        try {
          const ob = createOneBot({ baseUrl: cfg?.onebot?.baseUrl, token: cfg?.onebot?.token })
          await ob.sendPrivate(uin, `[CQ:image,file=${picked.file.replace(/\\/g, '/')}]`)
          json(res, 200, { ok: true, item: picked })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },

      // ── 语音（2026-11-04 主人：「上限和声音都可以在控制台导入」）──────
      'GET /voice/check': async (req, res, { json }) => {
        const { findFfmpeg, listVoices, VOICE_DEFAULTS } = await import('./voice.js')
        const cfg = readConfig()
        const ff = findFfmpeg()
        let voices = []
        try { voices = await listVoices() } catch { voices = [] }
        json(res, 200, {
          ok: true,
          windows: process.platform === 'win32',
          ffmpeg: ff,
          canSendVoice: Boolean(ff) && process.platform === 'win32',
          voices,
          current: { ...VOICE_DEFAULTS, ...(cfg?.voice ?? {}) },
          note: process.platform === 'win32'
            ? '能不能真发出语音，取决于 ffmpeg 有没有带 amr 编码器；没有的话就不发（免得对方放不出声）'
            : '语音只做了 Windows 的 TTS，这台机器用不了',
        })
      },
      // 导入我自己的声音（控制台里选文件 → 拷到数据目录）
      'POST /voice/import': async (req, res, { readBody, json }) => {
        const { importVoiceFile } = await import('./voice.js')
        const body = JSON.parse((await readBody(req)) || '{}')
        try {
          const got = importVoiceFile({ from: body.path, dshHome })
          json(res, 200, { ok: true, ...got, note: '已经拷进来了；把配置里的 voice.engine 改成 "file" 它就会用这个' })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      // 试听：念一句给我听（不发给任何人）—— 控制台里调完音色点这个
      'POST /voice/preview': async (req, res, { readBody, json }) => {
        const { synthWav, findFfmpeg, toQqAudio, VOICE_DEFAULTS, getDailyPreset } = await import('./voice.js')
        const cfg = readConfig()
        const v = { ...VOICE_DEFAULTS, ...(cfg?.voice ?? {}) }
        const body = JSON.parse((await readBody(req)) || '{}')
        const text = String(body.text ?? '这是本鱼的声音，你听听').slice(0, 120)
        const dir = path.join(dshHome, 'whale-channels', 'qq-voice', 'preview')
        fs.mkdirSync(dir, { recursive: true })
        const wav = path.join(dir, `preview-${Date.now()}.wav`)

        // ⚠️ 2026-11-08：支持 preset（自带大肥鱼）试听 ——
        //   控制台传 { preset: 'clever' } 就按那个预设念，不传就用配置里的
        const wantPreset = body.preset ?? v.preset
        const preset = wantPreset ? getDailyPreset(wantPreset) : null
        const voice = body.voice ?? preset?.voice ?? v.voice
        const rate = body.rate ?? (preset ? preset.rate : v.rate)
        const pitch = body.pitch ?? (preset ? preset.pitch : (v.pitch ?? 0))
        const volume = body.volume ?? preset?.volume ?? v.volume

        try {
          await synthWav({ text, outFile: wav, voice, rate, pitch, volume })
          const conv = await toQqAudio({ wavFile: wav, ffmpeg: findFfmpeg() })
          json(res, 200, {
            ok: true,
            wav,
            used: { voice, rate, pitch, volume, preset: wantPreset || null },
            canSend: conv.ok,
            sendError: conv.ok ? null : conv.error,
            note: '试听文件在本地；能不能真发出去看 canSend',
          })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
        }
      },
      // ── 发什么方式（2026-11-04 主人：主要我想发就发，他主动提也可以选）────
      'GET /format': async (req, res, { json }) => {
        const cfg = readConfig()
        const f = { ...DEFAULTS.format, ...(cfg?.format ?? {}) }
        const decided = decideFormat({ format: f, override, now: now() })
        json(res, 200, {
          ok: true,
          config: f,
          override,
          now: decided,                       // 现在这一条会发成什么
          note: f.mode === 'auto'
            ? '平时按我自己挑的来（权重大 → 更容易被挑中）'
            : `已经固定成「${f.pinned}」了，改回自动把 mode 设成 auto`,
        })
      },
      // 控制台里临时固定成一种（不动 mode 也能改 mode —— 都在配置里）
      'POST /format/pin': async (req, res, { readBody, json }) => {
        const body = JSON.parse((await readBody(req)) || '{}')
        const kind = String(body.kind ?? '')
        if (!['auto', 'text', 'voice', 'sticker'].includes(kind)) {
          json(res, 400, { ok: false, error: 'kind 只能是 auto / text / voice / sticker' }); return
        }
        // 只改内存里这次运行的指定；要永久改就去通道配置里改 format.mode ✓
        override = kind === 'auto' ? null : { kind, at: now() }
        json(res, 200, { ok: true, override, note: kind === 'auto' ? '回到自动 ✓' : `这一次固定成 ${kind}（${DEFAULTS.format.overrideTtlSec} 秒后失效）` })
      },
    },
  }
}


/**
 * 备份里那份说明（2026-11-04 晚）
 *
 * 为什么必须有：线上有人反馈「备份里并没有日记之类的东西」——
 *   真相是**日记要她写过才有**，刚装好还没聊过的机器上这些文件不存在，
 *   备份出来就只有设置没有人味的东西，看着像坏了 ✗
 *   这份说明把"哪些还没有、为什么没有、什么时候会有"讲清楚。
 */
function buildRestoreReadme({ n, absent, dir }) {
  const today = new Date().toISOString().slice(0, 10)
  const lines = [
    '# 怎么复活她',
    '',
    `备份时间：${today}`,
    `备份位置：${dir}`,
    `这次拷了 ${n} 项。`,
    '',
    '## 备份里都是什么',
    '',
    '| 目录 | 是什么 |',
    '| --- | --- |',
    '| `bili-ai/persona.md` | 她的人格（她是谁、怎么说话） |',
    '| `dsh/whale-diary.md` | 她写的日记 |',
    '| `dsh/whale-diary-private.md` | 她写的私密日记 |',
    '| `dsh/whale-rules.md` | 你们的约定 |',
    '| `dsh/whale-habits.json` | 作息、口味这些共用设置 |',
    '| `dsh/whale-channels/` | QQ 的设置、登录号、待审队列 |',
    '| `记忆/sessions/` | 对话全文（原始记录） |',
    '',
  ]

  if (absent.length) {
    lines.push('## 这次还没有的文件')
    lines.push('')
    lines.push('**不是丢了，是还没有。** 下面这些要等她"活过一阵子"才会出现：')
    lines.push('')
    for (const a of absent) {
      let why = '还没有'
      if (/diary/.test(a.rel)) why = '日记 —— 她写过第一篇才会有'
      else if (/persona/.test(a.rel)) why = '人格 —— 要先在设置里填'
      else if (/rules/.test(a.rel)) why = '约定 —— 你们聊出约定后才有'
      else if (/credential|quota/.test(a.rel)) why = 'B 站登录后才有（只装了 QQ 就没有）'
      else if (/pending/.test(a.rel)) why = '有待审消息时才有'
      else if (/wake-state|night-state/.test(a.rel)) why = '她主动找过你之后才有'
      lines.push(`- \`${a.rel}\` —— ${why}`)
    }
    lines.push('')
    lines.push('等用一阵子再备份一次，这些就会自己出现了。')
    lines.push('')
  }

  lines.push('## 怎么恢复')
  lines.push('')
  lines.push('**方法一：在 DSH 里点**')
  lines.push('')
  lines.push('设置 → 养鱼 · QQ → 记忆那一栏 → 填备份目录 → 先「预演」看一眼 → 再「真恢复」。')
  lines.push('')
  lines.push('**方法二：命令行**')
  lines.push('')
  lines.push('```')
  lines.push(`node tools/qq-backup.mjs --restore --from "${dir}"`)
  lines.push('```')
  lines.push('')
  lines.push('默认只预演（Dry run），看清楚会改哪些文件；加 `--go` 才真的写。')
  lines.push('')
  lines.push('## 换了一台新电脑怎么弄')
  lines.push('')
  lines.push('1. 装好 DSH 和两个养鱼插件')
  lines.push('2. 把这个备份目录整个拷到新电脑')
  lines.push('3. 按上面的方法恢复')
  lines.push('4. 重新登录 QQ（登录态不跟着备份走，要重新扫一次）')
  lines.push('')
  return lines.join('\n')
}

/**
 * 找一个能投递的 DSH 会话 id —— **同步版**（2026-11-04 晚）
 *
 * ⚠️ 为什么必须是同步的：这段跑在一个同步函数里（loginFor 那一层），
 *   塞 await 会直接语法错误 ✗（实测踩过）
 *
 * 背景：单独装 QQ 时 `bili-whale` 这个会话根本不存在 ——
 *   投递会报 "session not found"，表现就是「发消息没反应」✗
 *
 * 顺序：
 *   ① whale-body.json 里共享的（两个入口共用一条鱼时，必须用同一个）
 *   ② DSH 控制器里列出来的、名字里带 whale 的（只认同步能拿到的）
 *   ③ 都没有 → 返回空，让调用方用兜底名
 */
function pickSessionIdSync({ controller, dshHome, log = () => {} } = {}) {
  // ① 共享的会话身份
  try {
    const f = path.join(dshHome, 'whale-body.json')
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      const id = String(j?.id ?? j?.sessionId ?? '').trim()
      // ⚠️ 2026-11-04 晚：原来这里排除 `id !== 'bili-whale'`，
      //   那是"以为 B站 的会话名是假的"的老假设 —— 两个都装时反而把正确的挡掉 ✗
      //   现在只要非空就用（wake.js 会自己校验/创建）
      if (id) {
        log(`[qq] 投递会话用共享的那个：${id}`)
        return id
      }
    }
  } catch { /* 往下走 */ }

  // ② 控制器上的会话列表
  //
  // ⚠️⚠️ 2026-11-08 修（主人：「找不到一个叫醒鱼的会话来接收消息」）：
  //   这段原来是：
  //       const v = c[name]
  //       const arr = Array.isArray(v) ? v : null     ← 只认数组
  //   但 DSH 真实的 sessionController.list() 是个**函数**，
  //   而且它返回的是 `{ items: [...] }`，不是数组 ✗
  //   所以这里永远 continue → 拿不到任何会话 → 退到最后那个不存在的名字
  //   → 投递报「找不到会话」→ 她永远不说话。
  //
  //   实测（probe-controller.mjs）：
  //     list() 返回: {"items":[]}
  //
  //   现在：函数就调它（同步/异步都支持），结果数组 / {items} / {sessions} 都能认 ✓
  const c = controller ?? {}
  const toIdList = (r) => {
    if (!r) return []
    const arr = Array.isArray(r) ? r : (r.items ?? r.sessions ?? r.list ?? null)
    if (!Array.isArray(arr)) return []
    return arr.map((s) => String(s?.id ?? s?.sessionId ?? s?.name ?? s ?? '').trim()).filter(Boolean)
  }
  for (const name of ['list', 'listSessions', 'sessions']) {
    try {
      const v = c[name]
      if (v == null) continue
      const raw = typeof v === 'function' ? v.call(c) : v
      // 异步的这边等不了（这是同步函数）—— 只有同步结果能用
      if (raw && typeof raw.then === 'function') continue
      const ids = toIdList(raw)
      if (!ids.length) continue
      const whale = ids.find((i) => /whale/i.test(i))
      if (whale) { log(`[qq] 投递会话挑了带 whale 的：${whale}`); return whale }
      log(`[qq] 投递会话用列表第一个：${ids[0]}`)
      return ids[0]
    } catch (e) {
      log(`[qq] 读 ${name}() 失败：${String(e?.message ?? e).slice(0, 80)}`)
    }
  }

  // ③ DSH 磁盘上真实存在的会话
  //
  // ⚠️⚠️ 2026-11-08 修（主人：「找不到一个叫醒鱼的会话来接收消息」）：
  //   这段原来扫的是 `~/.dsh/sessions/` 的**第一层**，但 DSH 的结构是两层：
  //
  //     sessions/
  //       --C-Users-xxx-.dsh-whale-work--/     ← 第一层：工作目录（URL 编码的路径）
  //         07d93c0e-7ee3-48bc-a8af-1b0ddf0e80d3/   ← 第二层：真正的会话 id
  //         session-14e269ba-a0d3-4be5-8c70-e78dc15fa535/
  //
  //   扫第一层永远拿不到会话 id ✗
  //   现在两层都扫，第一层下没子目录时才把它自己当候选（兼容别的布局）✓
  try {
    const dir = path.join(dshHome, 'sessions')
    if (fs.existsSync(dir)) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const found = []
      for (const top of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!top.isDirectory()) continue
        const topPath = path.join(dir, top.name)
        let subs = []
        try { subs = fs.readdirSync(topPath, { withFileTypes: true }).filter((e) => e.isDirectory()) } catch { /* */ }
        // 第二层才是会话 id
        for (const s of subs) {
          // 可能是 'session-<uuid>' 或者纯 uuid
          const raw = s.name.replace(/^session-/, '')
          if (uuidRe.test(raw)) found.push(raw)
          else if (uuidRe.test(s.name)) found.push(s.name)
        }
        // 第一层自己就直接是 uuid（别的布局）
        if (!subs.length && uuidRe.test(top.name)) found.push(top.name)
      }
      if (found.length) {
        log(`[qq] 从磁盘找到 ${found.length} 个会话，用第一个：${found[0]}`)
        return found[0]
      }
      log('[qq] 磁盘上一个会话都没有 —— 交给 wake 建一个')
    }
  } catch { /* 没有 */ }

  return ''
}

/**
 * 确保 NapCat 在跑；没跑就**无窗口**地拉起来（2026-11-04 晚）
 *
 * 主人：「能不能 dsh 启动它也自己启动无弹窗」
 *
 * 为什么不用 start-napcat.bat：
 *   bat 必须由 cmd.exe 执行，cmd.exe 是控制台程序 → **一定会出现一个黑窗口** ✗
 *   而且 NapCat 作为它的子进程，窗口关掉又会被重建（"删不掉的弹窗"就是这个）。
 *
 * 正确做法：PowerShell 的 Start-Process -WindowStyle Hidden
 *   它走 ShellExecute，进程**从一开始就没有控制台**，Windows 不会给它分配窗口 ✓
 *
 * @returns {Promise<{ok:boolean, started:boolean, how:string}>}
 */
async function ensureNapcat() {
  const NAPCAT_DIR = 'C:\\NapCat'
  const APP = path.join(NAPCAT_DIR, 'app')
  const exe = path.join(APP, 'node.exe')
  const entry = path.join(APP, 'index.js')

  // 没装就直说，别硬起
  if (!fs.existsSync(exe) || !fs.existsSync(entry)) {
    return { ok: false, started: false, how: 'NapCat 没装（没有 node.exe / index.js）' }
  }

  const alive = async () => {
    try {
      const r = await fetch('http://127.0.0.1:6099', { signal: AbortSignal.timeout(2500) })
      return r.status === 200
    } catch { return false }
  }

  // 已经在跑 → 什么都不做（也不要杀它）
  if (await alive()) return { ok: true, started: false, how: '已在运行' }

  // ⚠️ 2026-11-04 晚修（代码审查抓到的）：
  //   原来只要 6099 不通就去 kill 所有 *NapCat* 的 node 进程 ——
  //   但用户可能**主动关了 WebUI**（webui.json 里 disableWebUI: true），
  //   或者 WebUI 换到别的端口 —— 那种情况下 NapCat 活得好好的，
  //   我们却把它连登录态一起干掉 ✗
  //
  //   现在先看 OneBot 端口(3000)活不活：
  //     · 3000 通 → NapCat 正在正常工作，**绝对不动它** ✓
  //     · 3000 也不通 → 才认为是残留，清掉重起
  const onebotAlive = async () => {
    try {
      const r = await fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(2000) })
      return r.status === 200
    } catch { return false }
  }
  if (await onebotAlive()) {
    return { ok: true, started: false, how: 'NapCat 在跑（OneBot 3000 通），只是 WebUI 没开 —— 不动它' }
  }

  // 有残留但没监听 → 清掉，免得端口冲突启动即失败
  try {
    const list = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -like '*NapCat*' } | Select-Object -ExpandProperty ProcessId",
    ], { encoding: 'utf8' })
    for (const pid of list.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'pipe' }) } catch { /* 已经没了 */ }
    }
  } catch { /* 查不到就算了 */ }

  // ⚠️ 关键：-WindowStyle Hidden。别改成 cmd /c start，那个会闪一下窗口
  // ⚠️ 2026-11-04 晚修：原来是把数组用空格 join 起来当一行命令 ——
  //   `$env:X='v' Start-Process ...` 在 PowerShell 里是两条语句连写，会报语法错 ✗
  //   现在用 `;` 分隔，并且逐条拼清楚 ✓
  try {
    const script = [
      `$env:NAPCAT_WEBUI_SECRET_KEY='napcat_webui'`,
      `$p = Start-Process -FilePath '${exe}' -ArgumentList '${entry}' -WorkingDirectory '${APP}' -WindowStyle Hidden -PassThru`,
      `$p.Id`,
    ].join('; ')
    execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 25000 })
  } catch (e) {
    return { ok: false, started: false, how: '启动命令失败：' + String(e?.message ?? e).slice(0, 100) }
  }

  // 等它就绪（最多 40 秒）
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await alive()) return { ok: true, started: true, how: `${i + 1} 秒就绪` }
  }
  return { ok: false, started: true, how: '40 秒还没就绪' }
}

/**
 * 备份目录叫什么（2026-11-04 晚）
 *
 * 主人：「不需要『邦邦的备份』，直接是他创建那个人格名字的备份就行」
 *
 * 目录名 = 设置里的人格名字（persona.name）：
 *   邦邦 → 「邦邦的备份」；阿鱼 → 「阿鱼的备份」；没名字 → 「她的备份」
 *
 * 名字先看共享习惯（和 B站 同一份），再看 B站 配置。
 */
/**
 * 备份目录叫什么（2026-11-04 晚）
 *
 * 主人：「不需要『邦邦的备份』，直接是他创建那个人格名字的备份就行」
 *
 * 目录名 = 设置里的人格名字（persona.name）：
 *   邦邦 → 「邦邦的备份」；阿鱼 → 「阿鱼的备份」；没名字 → 「她的备份」
 *
 * ⚠️ 2026-11-04 晚修（代码审查抓到的 P0）：
 *   这个函数原来只收 `home`，函数体里却用了 `dshHome` ——
 *   而 `dshHome` 是 apply() 里的局部变量，**模块顶层根本没有它** ⇒
 *   每次调用都抛 ReferenceError，被下面的 catch 静默吃掉 ⇒
 *   **人格名字从来没被读到过，备份目录永远叫「她的备份」** ✗
 *   （实测才会发现：功能"不报错"但"不生效"，最难查的一种）
 *
 *   现在 `dshHome` 作为参数显式传进来 ✓
 */
function backupDirFor(home, dshHome) {
  const root = dshHome || path.join(home, '.dsh')
  let name = ''
  try {
    const hf = path.join(root, 'whale-habits.json')
    if (fs.existsSync(hf)) name = String(JSON.parse(fs.readFileSync(hf, 'utf8'))?.persona?.name ?? '')
  } catch { /* 读不到就看下面 */ }
  if (!name.trim()) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(root, 'bili-whale.config.json'), 'utf8'))
      name = String(b?.persona?.name ?? '')
    } catch { /* 还没有 */ }
  }
  const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
  return path.join(home, 'Desktop', safe ? `${safe}的备份` : '她的备份')
}

/**
 * 把自带的 core 挂到 DSH 里（2026-11-04 晚）
 *
 * 主人要求「dsh-whale-core 那个库不要，两个库里分别放一个就行」→ core 内嵌进 core/。
 *
 * ⚠️ 但内嵌不等于会被加载：DSH 只加载 profile 里登记的 bundle，
 *   藏在插件子目录的 core 没人管 → 总控制台接口 404 ✗（实测过）
 *   所以这里用 ctx.plugin() 交给 cordis 挂载（走完整注入/生命周期）。
 *
 * 两份 core 同时存在时，core 内部有单例锁，只有第一个真正挂载 ✓
 * 失败不影响 QQ 自己工作。
 */
async function mountBundledCore(ctx) {
  const file = path.join(HERE, '..', 'core', 'lib', 'index.js')
  if (!fs.existsSync(file)) return false
  let mod = null
  try { mod = await import(pathToFileURL(file).href) } catch (e) {
    console.log(`[qq] 自带 core 加载失败（不影响 QQ 自己）：${e?.message ?? e}`)
    return false
  }
  const plugin = mod?.default
  if (!plugin || typeof plugin.apply !== 'function') return false
  try {
    if (typeof ctx.plugin === 'function') { ctx.plugin(plugin); return true }
    plugin.apply(ctx)
    return true
  } catch (e) {
    console.log(`[qq] 挂载自带 core 失败（不影响 QQ 自己）：${e?.message ?? e}`)
    return false
  }
}

/**
 *
 * ⚠️ 2026-11-04 主人要求：「只要配置或改动了一种养鱼方式的设置，另一种养鱼方式的
 *   相同设置就会同步更新（比如人格，作息），保证连贯性」
 *
 *   所以这里读完之后**叠一层共享习惯**（~/.dsh/whale-habits.json）：
 *   作息 / 主动 / 口味 / 人设 / 轮换天数 这几项只有一份，B 站改了这边立刻生效 ✓
 *
 *   没有 core 的时候（单独装了 QQ）就用自己配置里的值，不崩 ✓
 */
export function makeConfigReader({ file, defaults = DEFAULTS } = {}) {
  return () => {
    const base = { ...defaults, ...(readJsonSafe(file) ?? {}) }
    const hm = habitsMod
    if (!hm) return base
    try {
      const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
      hm.ensureHabits({ dshHome, qqCfg: base })
      // 2026-11-08 修（「独立配置QQ的时候找不到一个醒的时间」）：
      //   fallback 传 base —— 没有共享文件时用**这个通道自己的配置**当来源，
      //   而不是让 readHabits 凭空返回写死的默认作息，
      //   否则用户在控制台改了作息，读出来还是默认那三个窗 ✗
      const habits = hm.readHabits({ dshHome, fallback: base })
      return { ...hm.applyHabits({ cfg: base, habits }), __habits: habits }
    } catch { return base }
  }
}

/**
 * 共享习惯模块（同步可用）。跟 importCoreModule 一样要兜路径 ——
 * 但 readConfig 是同步的，所以启动时预加载一次，之后同步用 ✓
 */
let habitsMod = false
export async function loadHabitsModule() {
  try {
    const m = await importCoreModule('habits')
    if (m?.readHabits) { habitsMod = m; return m }
  } catch { /* 下面兜底 */ }
  habitsMod = false
  return false
}

/**
 * 拿 dsh-whale-core 的注册表（**不靠裸 import**，见下面的坑）
 *
 * ⚠️ 2026-11-04 踩的坑：这里是 link 安装，pnpm 不会给这个包建自己的 node_modules，
 *    所以 `import('dsh-whale-core/registry')` 在 profile 里会 ERR_MODULE_NOT_FOUND ✗
 *    改成：① 先试裸 import（npm 正常安装时最省事）② 再从 DSH_HOME 下几个常规位置找。
 *    两条都失败才算真没有 ✓（失败原因全带出来，别只报一句「找不到」）
 */
/**
 * core 在哪 —— 2026-11-04 晚主人要求「dsh-whale-core 那个库不要，两个库里分别放一个就行」。
 *
 * 所以 core 现在**自带在本仓库的 core/ 目录里**（install.mjs 会把整个仓库拷进
 * ~/.dsh/plugins/dsh-qq-whale，所以 core/ 跟着一起过去）。
 *
 * 顺序：先找自己带的，再找独立安装的（兼容老安装）✓
 */
export function coreSearchDirs() {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return [
    // ① 本仓库自带（HERE = .../dsh-qq-whale/lib，往上一级就是仓库根）
    path.join(HERE, '..', 'core', 'lib'),
    // ② 老方式：作为依赖/独立包装过
    path.join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-whale-core', 'lib'),
    path.join(dshHome, 'whale-core', 'lib'),
    path.join(dshHome, 'plugins', 'whale-core', 'lib'),
  ]
}

/**
 * 从 core 里拿一个子模块（registry / shared / config …）。
 * ⚠️ 跟 loadCoreRegistry 同样的原因：link 安装下裸 import 可能找不到，得走路径兜底 ✓
 */
export async function importCoreModule(name) {
  const tries = []
  for (const dir of coreSearchDirs()) {
    const file = path.join(dir, `${name}.js`)
    if (!fs.existsSync(file)) { tries.push(`${file}：不存在`); continue }
    try { return await import(pathToFileURL(file).href) } catch (e) { tries.push(`${file}：${e.code ?? e.message}`) }
  }
  try { return await import(`dsh-whale-core/${name}`) } catch (e) { tries.push(`裸 import：${e.code ?? e.message}`) }
  const err = new Error(`找不到 dsh-whale-core/${name}（${tries.join(' / ')}）`)
  err.tries = tries
  throw err
}

/**
 * **同步**拿 core 的注册表 —— apply() 里用它，避免「登记晚于路由挂载」那个窗口。
 *
 * 为什么必须是同步的：DSH 的 Loader 并行 create 所有条目（Promise.all），
 * 如果这里 await 一下，core 就可能先把 prefix 路由挂好、浏览器已经开始打请求，
 * 而这边还没登记 → 那一发就是 404 ✗（2026-11-04 实测到过这个窗口）
 *
 * registry.js 本身把表挂在 globalThis 上（Symbol.for 全局键），所以只要能同步
 * 把那个模块 import 进来就行 —— Node 的 require(esm) 正好干这个。
 * 拿不到就返回 null（core 没装 = 正常情况，不是错误）✓
 */
export function loadCoreRegistrySync() {
  // ① 全局表已经在，而且本进程里有人把 register 挂上去了 → 直接借用
  //    （registry.js 用的是 Symbol.for，所以不同模块实例看到的是同一张表）
  //    注意：不要写 `get` / `list` —— 本文件自己就有同名函数，会重复声明（SyntaxError）
  const KEY = Symbol.for('dsh-whale-core.registry.v1')
  const table = globalThis[KEY]
  if (table?.__register) {
    return {
      register: (...a) => table.__register(...a),
      get: (id) => table.get(String(id)),
      list: () => [...table.values()],
    }
  }

  // ② 同步 import 一份 registry.js，用它的 register（写进的就是那张全局表）
  //   2026-11-04 晚：先找本仓库自带的 core（主人要求去掉独立的 core 仓库）
  const candidates = coreSearchDirs().map((d) => path.join(d, 'registry.js'))
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      // ESM 在 Node ≥22.12 可以 require；拿到的就是同一个模块实例
      const mod = require(file)
      if (typeof mod.getRegistry === 'function') return mod.getRegistry()
    } catch { /* 换下一个 */ }
  }
  return null
}

export async function loadCoreRegistry() {
  const tries = []
  try { return (await import('dsh-whale-core/registry')).getRegistry() } catch (e) { tries.push(`裸 import：${e.code ?? e.message}`) }

  const candidates = coreSearchDirs().map((d) => path.join(d, 'registry.js'))
  for (const file of candidates) {
    if (!fs.existsSync(file)) { tries.push(`${file}：不存在`); continue }
    try {
      const mod = await import(pathToFileURL(file).href)
      if (typeof mod.getRegistry === 'function') return mod.getRegistry()
      tries.push(`${file}：没有 getRegistry`)
    } catch (e) { tries.push(`${file}：${e.code ?? e.message}`) }
  }
  const err = new Error(`找不到 dsh-whale-core（${tries.join(' / ')}）`)
  err.tries = tries
  throw err
}

export default {
  name: 'dsh-qq-whale',
  // ⚠️ 2026-11-04 晚 真因抓到了：
  //   `inject` 里原来只有 'webServer' —— **`sessionController` 根本没被要过**。
  //   DSH 不会给你没 inject 的服务，所以 `hostCtx.sessionController` 和
  //   `ctx.sessionController` 全都是 undefined → waker 永远建不起来 →
  //   `[qq] 拿不到 sessionController → 收得到消息但叫不醒她` 这一行，
  //   然后消息照样记进 seen（以为处理了），人就一直哑着 ✗
  //   B 站那边 273 行早就有这个 inject，QQ 抄漏了。
  inject: ['sessionController', 'webServer'],
  apply(ctx) {
    const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
    const log = (m) => { try { console.log(m) } catch {} }

    // 2026-11-04 修「读取配置失败：HTTP 404」（三处，缺哪个都还是 404）
    //
    //   ① 这个变量必须先声明、再被下面使用：
    //      makeConfigReader / buildChannel 都会读它；声明挪到调用点之后就是 TDZ ReferenceError，
    //      整个 apply 抛错 → 通道根本登记不上 → core 里 /channels/qq/* 全是 404 ✗
    let configFile = path.join(dshHome, 'whale-channels', 'channels', 'qq.json')

    // 通道定义里要用到 ctx（投递消息给会话），先收进闭包
    const channel = buildChannel({
      dshHome,
      ctx,
      readConfig: makeConfigReader({ file: configFile }),
      log,
    })

    //   ② 登记进注册表的条目必须带上 configFile。
    //      buildChannel 不往外吐这个字段 → registry.register() 会把它归一成空串 ✗
    //      （registry.normalizeConfigFile：undefined/null/'' 一律 → ''）
    //      这里用**同一个**路径字符串补上，别另拼一份带 resolve/realpath 的
    //      （Windows 上大小写、短文件名会让两个字符串永远不等）
    if (!channel.configFile) channel.configFile = configFile

    // ③ 登记进注册表。
    //
    // ⚠️ 2026-11-04（第三次）：原来这里整段是 `async` 的（第一步就 `await loadCoreRegistry()`），
    //   而 DSH 的 Loader 用 Promise.all **并行** create 所有插件条目。
    //   于是存在一个小窗口：core 的 prefix 路由已经挂上、浏览器已经开始打请求，
    //   而 qq 还卡在 await 里没登记 → 那一刻 /channels/qq/config 就是 404 ✗
    //   （实测：同一进程里「补丁一打 → 404，等 400ms → 200」）
    //   注册表本身挂在 globalThis 上（见 registry.js），所以只要模块能**同步**拿到，
    //   就能在 apply 的同步帧里登记完，不留任何窗口 ✓
    let unregister = null
    const tryRegister = () => {
      let registry = null
      let lastErr = null
      try {
        registry = loadCoreRegistrySync()
      } catch (e) { lastErr = e }
      if (!registry) {
        // 到这里说明 core 真的没装 —— 这不是错误，是最常见的安装方式（单装 QQ）✓
        log(`[qq] 没找到 dsh-whale-core，跳过登记（${lastErr?.message ?? '未安装'}）`)
        return
      }
      try {
        unregister = registry.register(channel)
        const stored = registry.get ? registry.get('qq')?.configFile : channel.configFile
        log(`[qq] 通道已登记：qq（registry.configFile=${stored || '空！core 不会挂 /config 路由'}）`)
      } catch (e) {
        log(`[qq] 登记失败：${e?.message ?? e}`)
      }
    }
    tryRegister()

    // ⚠️ 2026-11-04 晚（主人：「能不能 dsh 启动它也自己启动无弹窗」）：
    //   以前 NapCat 要靠开机自启的 .bat —— 那个必然弹一个黑窗口，
    //   而且电脑一重启就忘了开，DSH 这边就「连不上 NapCat WebUI」✗
    //
    //   现在：DSH 启动时**顺便把 NapCat 拉起来**，全程无窗口：
    //     · 已经在跑（6099 通）→ 什么都不做 ✓
    //     · 没跑 → 用 PowerShell 的 Start-Process -WindowStyle Hidden 起一份
    //       （node.exe 是控制台程序，只有这条路才真正不给它窗口）
    //   失败只记日志，绝不影响 DSH 本身启动 ✓
    void ensureNapcat().then((r) => {
      if (r.started) log(`[qq] NapCat 没在跑，已自动拉起（${r.how}）`)
      else if (r.ok) log('[qq] NapCat 已在运行 ✓')
      else log(`[qq] NapCat 起不来（${r.how}）—— 扫码/收消息会不可用`)
    })

    // ⚠️ 2026-11-04 晚：把自带的 core 挂到 DSH 里 ——
    //   内嵌在 core/ 的 core 不会自动被加载（DSH 只加载 profile 里登记的 bundle），
    //   不挂的话总控制台的 /dsh-whale/api/* 全 404 ✗（实测过）
    void mountBundledCore(ctx).then((ok) => {
      if (ok) log('[qq] 已挂上自带的 core（总控制台可用）')
    })

    // ⚠️ 2026-11-04：预加载共享习惯层 —— makeConfigReader 是同步的，
    //   所以先把模块拿到手，之后每次读配置都能叠上共享的作息/口味/人设 ✓
    void loadHabitsModule().then((m) => {
      if (m) log('[qq] 已接上共享习惯（作息/口味/人设和 B 站同一份）')
      else log('[qq] 没拿到共享习惯层 → 用本通道自己的设置')
    })

    // ⚠️ 2026-11-04 晚修（代码审查抓到的）：原来这里无条件调 ctx.effect，
    //   宿主万一没提供就直接抛 → apply 失败 → 但通道**已经登记过了**，
    //   于是路由和登记状态对不上，卸载时还会泄漏 ✗
    //   现在有就用，没有就算了（unregister 交给宿主统一回收）✓
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => () => { try { unregister?.() } catch {} })
    } else {
      try { log('[qq] 宿主没提供 ctx.effect —— 卸载时可能不会自动反注册，不影响使用') } catch {}
    }
  },
}
