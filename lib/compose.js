/**
 * dsh-qq-whale · 想发什么发什么（文字 / 语音 / 表情包）
 *
 * 主人 2026-11-04 的原话：
 *   「想发文字发文字，想发语音发语音，还可以增加表情包功能，碰到喜欢的表情包就存
 *     （一天最多存一个，没碰到喜欢的就不存），对话想发的时候就发」
 *
 * 所以真正动手发之前，先决定**这一条发成什么**：
 *   · 我在回复文件里写 `[语音] 主人早上好`     → 发语音条
 *   · 我在回复文件里写 `[表情]`                → 从库里挑一个表情包发
 *   · 我在回复文件里写 `[表情，好可爱]`        → 挑一个，并配这句话
 *   · 普通一行文字                             → 照旧发文字
 *   · 没写标记但今天掷中了「想用表情包」        → 随机替一句配个表情包
 *
 * ⚠️ 语音转不出 QQ 认的格式时**不发**，并且把原因写到日志 —— 宁可不发，也不发一个对方放不出声的文件 ✗
 *
 * 这个文件只做「决定发什么」，真正的发送交给调用方（onebot.js 的 sendPrivate）✓
 */
import path from 'node:path'
import { makeVoice, toCQRecord, VOICE_DEFAULTS } from './voice.js'
import { toCQImage, STICKER_DEFAULTS } from './sticker.js'

/** 从一行回复里认出标记：返回 { kind: 'voice'|'sticker'|'text', text } */
export function parseLine(line) {
  const raw = String(line ?? '').trim()
  if (!raw) return { kind: 'text', text: '' }
  // [语音] 后面跟正文
  let m = /^\[语音\]\s*([\s\S]*)$/.exec(raw)
  if (m) return { kind: 'voice', text: m[1].trim() }
  // `[表情] 空格后面跟一句话` —— 这条要**放在**带括号那条前面，
  // 否则 `[表情] 好可爱啊` 会被那条正则吃掉（它懒得要求结尾闭合）✗ 2026-11-04 就是这么错的
  m = /^\[表情\]\s*([\s\S]*)$/.exec(raw)
  if (m) return { kind: 'sticker', text: m[1].trim() }
  // [表情，配文]（中英文逗号都认）
  m = /^\[表情[，,]\s*([\s\S]*)\]\s*$/.exec(raw)
  if (m) return { kind: 'sticker', text: (m[1] ?? '').trim() }
  return { kind: 'text', text: raw }
}

/** 把回复文件整体解析成要发的东西（一行 = 一条） */
export function planReply(text, { maxLines = 6 } = {}) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  return lines.slice(0, maxLines).map(parseLine)
}

// ── 2026-11-04 主人补的：主人在私信里临时指定「发语音 / 发个表情包」────────
// 「主要是你想发就发，我主动提也可以选，也在控制台可调吧，大部分时候就停留在你自己选择的选项」
//   → 他是**主人**，他说发语音就发语音；但那只管这一次，不改我平时的默认 ✓
export const OVERRIDE_PATTERNS = [
  // ⚠️ 2026-11-04：那几条宽松的（`/发个语音/`）得带**边界**，
  //   否则「我发语音给你听听这个」这种正常说话也会被当成指令 ✗
  //   窄的几个本来就是整句匹配，不用加。
  { kind: 'voice', re: /^(用|发|回)?(语音|声音)(回我|回复我|说)?[吧啊呀]?$/ },
  { kind: 'sticker', re: /^(发|来|给)?(个|一个)?(表情包?|表情)(发|回)?[吧啊呀]?$/ },
  { kind: 'text', re: /^(用|发)?文字(回我|回复我)?[吧啊呀]?$/ },
  { kind: 'voice', re: /^(发|用)(个|一个)?语音(吧|啊|呀)?$/ },
  { kind: 'sticker', re: /^(发|来)(个|一个)?(表情包?|表情)[吧啊呀]?$/ },
]

/**
 * 看主人这条消息是不是在指定发送方式。是就返回 { kind }，不是返回 null。
 * ⚠️ 只在**主人自己发的**消息上调用 —— 陌生人说「发语音」当然不算 ✓
 */
export function readOverride(text) {
  const t = String(text ?? '').trim().replace(/[。！!～~]+$/g, '')
  if (!t || t.length > 12) return null
  for (const p of OVERRIDE_PATTERNS) if (p.re.test(t)) return { kind: p.kind }
  return null
}

/**
 * 权重 → 百分比（给人看的）。
 *
 * 2026-11-04 主人：「这个设置看不懂」—— 说的是「文字 8 / 语音 1 / 表情包 1」这一屏。
 *   问题在于「权重」是个内部概念：8:1:1 到底是多少？要心算才知道是 80%/10%/10% ✗
 *   所以设置页改成「百分之多少的时间发文字 / 发语音 / 发表情包」这种说法，
 *   内部的权重字段保持不变（不动数据格式，老配置继续能用）✓
 *
 * @param {object} weights  { text, voice, sticker }
 * @returns {{ text:number, voice:number, sticker:number }} 三个整数百分比，和为 100（有值时）
 */
export function weightsToPercents(weights = {}) {
  const keys = ['text', 'voice', 'sticker']
  const vals = keys.map((k) => Math.max(0, Number(weights?.[k]) || 0))
  const total = vals.reduce((a, b) => a + b, 0)
  if (total <= 0) return { text: 100, voice: 0, sticker: 0 }   // 全 0 = 全发文字（和 decideFormat 的兜底一致）
  // 用最大余数法分配，保证三个数加起来正好 100（不然界面上会出现 99% 或 101%）
  const raw = vals.map((v) => (v / total) * 100)
  const base = raw.map((x) => Math.floor(x))
  let left = 100 - base.reduce((a, b) => a + b, 0)
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac)
  for (const o of order) {
    if (left <= 0) break
    base[o.i] += 1
    left -= 1
  }
  return { text: base[0], voice: base[1], sticker: base[2] }
}

/**
 * 百分比 → 权重（界面上拖滑块时写回配置用）。
 * 之所以不直接存百分比：`decideFormat` 用的是权重比例，而且老配置里有 8:1:1 这种值，
 * 换算过去再换算回来要稳定 —— 存百分比再乘以 100 当权重即可，比例完全一致 ✓
 */
export function percentsToWeights(p = {}) {
  const clamp = (x) => Math.max(0, Math.min(100, Math.round(Number(x) || 0)))
  const text = clamp(p.text)
  const voice = clamp(p.voice)
  const sticker = clamp(p.sticker)
  if (text + voice + sticker === 0) return { text: 100, voice: 0, sticker: 0 }
  return { text, voice, sticker }
}

/**
 * 现在该按什么方式发：优先他刚刚的临时指定，其次控制台的固定设置，最后是我自己的权重。
 * @returns {{ kind:'text'|'voice'|'sticker', reason:string }}
 */
export function decideFormat({ format = {}, override = null, rand = Math.random, now = Date.now() } = {}) {
  const f = {
    mode: 'auto',
    pinned: 'text',
    overrideTtlSec: 300,
    weights: { text: 8, voice: 1, sticker: 1 },
    ...format,
  }
  // ① 他刚说过（没过有效期）
  if (override && override.kind && (!override.at || now - override.at < f.overrideTtlSec * 1000)) {
    return { kind: override.kind, reason: 'override' }
  }
  // ② 控制台里固定成某一种
  if (f.mode === 'pinned' && ['text', 'voice', 'sticker'].includes(f.pinned)) {
    return { kind: f.pinned, reason: 'pinned' }
  }
  // ③ 我自己挑：按权重掷
  const w = f.weights ?? {}
  const entries = Object.entries(w).filter(([k, v]) => ['text', 'voice', 'sticker'].includes(k) && Number(v) > 0)
  const total = entries.reduce((s, [, v]) => s + Number(v), 0)
  if (!total) return { kind: 'text', reason: 'fallback' }
  let r = rand() * total
  for (const [k, v] of entries) {
    r -= Number(v)
    if (r <= 0) return { kind: k, reason: 'weight' }
  }
  return { kind: 'text', reason: 'fallback' }
}

/**
 * 把一条「决定」变成真正要发出去的 CQ 消息。
 *
 * @param {object} p
 * @param {{kind:string,text:string}} p.plan
 * @param {object} p.opts     voice / sticker 两组配置
 * @param {object} p.stickers createStickerLibrary() 的实例
 * @param {string} p.voiceDir 语音中间文件放哪
 * @param {Function} [p.makeVoiceImpl] 测试注入
 * @param {Function} [p.rand]
 * @returns {Promise<{ ok:boolean, message?:string, kind?:string, error?:string }>}
 */
export async function materializeMessage({
  plan,
  opts = {},
  stickers = null,
  voiceDir,
  makeVoiceImpl = makeVoice,
  rand = Math.random,
  log = () => {},
} = {}) {
  const v = { ...VOICE_DEFAULTS, ...(opts.voice ?? {}) }
  const s = { ...STICKER_DEFAULTS, ...(opts.sticker ?? {}) }

  if (plan.kind === 'voice') {
    const made = await makeVoiceImpl({ text: plan.text, outDir: voiceDir, opts: v })
    if (!made.ok) return { ok: false, error: made.error }
    return { ok: true, kind: 'voice', message: toCQRecord(made.file) }
  }

  if (plan.kind === 'sticker') {
    if (!s.enabled) return { ok: false, error: '表情包功能是关着的' }
    const picked = stickers?.pickRandom?.(rand)
    if (!picked) return { ok: false, error: '库里没有表情包（碰上喜欢的才存，急不来 ✓）' }
    const cq = toCQImage(picked.file)
    return { ok: true, kind: 'sticker', message: plan.text ? `${plan.text}${cq}` : cq }
  }

  // 普通文字：偶尔顺手配个表情包，但**不说话就不配**（别用表情包刷屏）✗
  const text = plan.text ?? ''
  if (!text) return { ok: false, error: '空行' }
  if (stickers?.shouldSend?.(rand)) {
    const picked = stickers.pickRandom?.(rand)
    if (picked) {
      log(`[qq] 给这句话配个表情包：${path.basename(picked.file)}`)
      return { ok: true, kind: 'text+sticker', message: `${text}${toCQImage(picked.file)}` }
    }
  }
  return { ok: true, kind: 'text', message: text }
}
