/**
 * dsh-qq-whale · 主动找你 + 人设/日记注入
 *
 * 2026-11-04：主人要求「照着哔站养鱼的功能改好」。
 *
 * 这里补的正是 QQ 独立使用时最缺的两块：
 *   ① 空闲时她自己会想起你（B 站叫 proactive.js）
 *   ② 每次醒来都要带上「她是谁 + 记得什么」（B 站 session-delivery.js 里的 prefix）
 *
 * 设计上刻意和 B 站保持一致：
 *   · 人设文件同一份：~/.bili-ai/persona.md
 *   · 日记同一份：~/.dsh/whale-diary.md、whale-diary-private.md
 *   · 规则同一份：~/.dsh/whale-rules.md
 * 这样「一条鱼两个入口」在 QQ 独立安装时也成立 ✓
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

/** 读人设正文（和 B 站 loadPersonaText 一致，最大 maxChars 字） */
export function loadPersonaText({ homeDir, maxChars = 20000 } = {}) {
  const home = homeDir || process.env.USERPROFILE || process.env.HOME || '.'
  const file = path.join(home, '.bili-ai', 'persona.md')
  try {
    const text = fs.readFileSync(file, 'utf8').trim()
    if (!maxChars || maxChars <= 0) return text
    return text.length > maxChars ? text.slice(0, maxChars) : text
  } catch { return '' }
}

/** 人设指纹：只在人设改了的时候才重新注入（省上下文） */
export function personaFingerprint(text) {
  return crypto.createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16)
}

/**
 * 拼「醒来时该带上的上下文」。
 *
 * 和 B 站 session-delivery.js 的 prefix 语义一致：
 *   · 首次投递 / 人设变了 → 带**完整人设**
 *   · 那次不带 → 只带一句「人设依据在哪，缺了自己重读」
 *   · 进程起来后第一次（或还没投递过）→ 追加**日记恢复指引**
 *
 * @param {object} p
 * @param {string} p.persona       人设正文
 * @param {boolean} [p.includePersona]  这次要不要带完整人设
 * @param {boolean} [p.includeDiary]    这次要不要带日记指引
 * @param {string} p.dshHome
 * @returns {string}
 */
export function buildWakePrefix({ persona = '', includePersona = true, includeDiary = true, dshHome } = {}) {
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  const parts = []
  if (includePersona && String(persona).trim()) {
    parts.push(String(persona).trim())
  } else if (String(persona).trim()) {
    parts.push(`人设依据：${path.join(home, '.bili-ai/persona.md')}；上下文缺失时重读。`)
  }
  if (includeDiary) {
    parts.push(
      `先读本地日记恢复记忆：${path.join(dshHome, 'whale-diary.md')} 和 ` +
      `${path.join(dshHome, 'whale-diary-private.md')}；规则和改动看 ` +
      `${path.join(dshHome, 'whale-rules.md')}；不要将旧会话未确认事项当成已完成。`,
    )
  }
  return parts.join('\n')
}

/**
 * 主动找你的判定。
 *
 * B 站那边逻辑：醒来时有 proactiveChance 的概率主动发消息，每天最多 proactiveDailyMax 次。
 * 这里保持一致，但**多一层保护**：如果你刚说过话（最近 peaceMin 分钟内有互动），就不主动打扰 ✓
 *
 * @param {object} p
 * @param {number} p.chance        0..1
 * @param {number} p.dailyMax      每天最多几次
 * @param {number} p.sentToday     今天已经主动了几次
 * @param {number} [p.lastUserAt]  主人最后一次说话的时间戳
 * @param {number} [p.now]
 * @param {number} [p.quietMin]    主人刚说过话多久内不主动（默认 30 分钟）
 * @param {Function} [p.random]
 * @returns {{ should: boolean, reason: string }}
 */
export function shouldBeProactive({
  chance = 0, dailyMax = 0, sentToday = 0, lastUserAt = 0,
  now = Date.now(), quietMin = 30, random = Math.random,
} = {}) {
  const c = Number(chance)
  const max = Number(dailyMax)
  if (!Number.isFinite(c) || c <= 0) return { should: false, reason: '主动概率是 0' }
  if (Number.isFinite(max) && max >= 0 && Number(sentToday) >= max) {
    return { should: false, reason: `今天已经主动 ${sentToday} 次（上限 ${max}）` }
  }
  // 主人刚说过话 → 别打扰，正常聊就够
  const last = Number(lastUserAt) || 0
  if (last > 0 && quietMin > 0) {
    const mins = (now - last) / 60000
    if (mins < quietMin) return { should: false, reason: `你 ${Math.round(mins)} 分钟前刚说过话` }
  }
  if (random() >= c) return { should: false, reason: '这次没抽中' }
  return { should: true, reason: '抽中了' }
}

/**
 * 主动醒来时，投给她的那句话长什么样。
 * 让它「知道自己是主动想起主人」，而不是把这当成一条用户消息 —— 这点和 B 站一致 ✓
 * ⚠️ 2026-11-08：加了 replyFile 参数。
 *   原来这里写死相对路径 `whale-work/dm-reply-qq.txt`，
 *   但她的工作目录不是 ~/.dsh → 写到别处 → 插件读不到 → 文件永远空白 ✗
 *   现在传绝对路径进来（调用方从 dshHome 拼好）。
 */
export function proactiveMessage({ sentToday = 0, replyFile = '' } = {}) {
  const n = Number(sentToday) + 1
  const where = replyFile || 'whale-work/dm-reply-qq.txt'
  return [
    '【主动】没人叫你，是你自己想起主人了。',
    `（今天第 ${n} 次主动）`,
    '',
    `想发就发：写进这个文件就行 → ${where}。一行一句；`,
    '行首写 [语音] 发语音，写 [表情] 发表情包。',
    '不想发就留空 —— 但既然主动醒了，多少说点什么吧。',
  ].join('\n')
}

/**
 * 主动消息的每日计数（跨天自动归零）。
 * @param {object} state { dayKey, sentToday }
 * @param {number} [now]
 */
export function proactiveCounter(state = {}, now = Date.now()) {
  const d = new Date(now)
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const sentToday = state?.dayKey === k ? Number(state.sentToday) || 0 : 0
  return {
    dayKey: k,
    sentToday,
    bump: () => ({ dayKey: k, sentToday: sentToday + 1 }),
  }
}
