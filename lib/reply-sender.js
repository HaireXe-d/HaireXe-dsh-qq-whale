/**
 * 2026-11-04 18:32 · 回话发送器（**这个文件之前根本不存在**）
 *
 * 查出来的真相：
 *   `index.js` 里写了 `reply.file: 'dm-reply-qq.txt'`，
 *   `compose.js` 里也有 `planReply` / `materializeMessage`，
 *   **但没有任何代码去读那个文件、把内容发出去** ✗
 *
 *   于是我把话写进 `whale-work/dm-reply-qq.txt`，
 *   它就在那儿躺着，谁也不会读 —— 所以主人一直在 QQ 收不到回话。
 *   （B 站那边是 `scheduler.js` 干这件事的，QQ 这边从来没写。）
 *
 * 这个模块干一件事：
 *   定时看 `dm-reply-qq.txt`，有内容就一行一条发出去，发成功了再清空。
 *
 * 三条规矩（照 B 站的踩坑记录）：
 *   ① **发不成功就不删文件** —— 留到下一轮补发（B 站 11-03 掉过这个坑 ✗）
 *   ② 一条一行 = 一条消息，中间隔 gapMs，别一秒钟刷过去
 *   ③ 发过的不重发：按文件内容指纹记住「上次发出去的是什么」
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { planReply, materializeMessage } from './compose.js'

// 2026-11-07：这一行是不是「发到某个群」的（行首 `[群:123456] 正文`）
import { splitGroupTag } from './group.js'

export const SENDER_DEFAULTS = {
  intervalMs: 3000,      // 多久看一次文件
  maxLines: 6,
  gapMs: 1200,
  maxChars: 600,
}

/**
 * @param {object} p
 * @param {object} p.ob            OneBot 客户端（有 sendPrivate）
 * @param {string} p.ownerId       发给谁
 * @param {string} p.workDir       她的工作目录（文件在这儿）
 * @param {string} [p.fileName]    'dm-reply-qq.txt'
 * @param {Function} [p.readConfig] () => 配置
 * @param {object} [p.stickers]    表情包库
 * @param {string} [p.voiceDir]
 * @param {Function} [p.log]
 * @param {Function} [p.now]
 */
export function createReplySender({
  ob,
  ownerId,
  workDir,
  fileName = 'dm-reply-qq.txt',
  readConfig = () => ({}),
  stickers = null,
  voiceDir,
  log = () => {},
  now = () => Date.now(),
} = {}) {
  const file = path.join(workDir, fileName)
  let lastSentHash = ''      // 上次成功发出去的内容指纹（防重发）
  let timer = null
  let stopped = false
  let sending = false

  const cfgOf = () => {
    const c = readConfig() ?? {}
    return { ...SENDER_DEFAULTS, ...(c.reply ?? {}), ...(Number(c.reply?.maxLines) ? { maxLines: Number(c.reply.maxLines) } : {}) }
  }

  function readPending() {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      if (!raw.trim()) return null
      return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') }
    } catch { return null }
  }

  function clearFile() {
    try { fs.writeFileSync(file, '') } catch (e) { log(`[qq] 清空回话文件失败：${e?.message ?? e}`) }
  }

  /**
   * 跑一次：有内容就发。
   *
   * ⚠️ 2026-11-07 群聊：一行里可能带 `[群:<群号>]`。
   *   带了就发到那个群，没带就照旧发私信 —— 同一个文件、同一行一条，
   *   **文件格式没变**，只是行首多了一个可选标记 ✓
   *   （这样做的好处：她说「群里回一句、私下再跟他说一句」能一次写完）
   *
   * @returns {Promise<{sent:number, skipped:string|null}>}
   */
  async function tick() {
    if (stopped || sending) return { sent: 0, skipped: 'busy' }
    const got = readPending()
    if (!got) return { sent: 0, skipped: 'empty' }
    if (got.hash === lastSentHash) return { sent: 0, skipped: 'already-sent' }

    const cfg = cfgOf()
    // 先按行拆标记，再交给 planReply —— planReply 只认「一行要发什么」，
    // 群号是**目的地**，不属于它的活 ✓
    const lines = String(got.raw ?? '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, cfg.maxLines)
      .map(splitGroupTag)
    const plans = lines.map((x) => ({ ...planReply(x.line, { maxLines: 1 })[0], groupId: x.groupId }))
      .filter((x) => x && x.text !== undefined)
    if (plans.length === 0) return { sent: 0, skipped: 'empty' }

    sending = true
    let sent = 0
    try {
      for (let i = 0; i < plans.length; i += 1) {
        const plan = plans[i]
        const built = await materializeMessage({
          plan,
          opts: readConfig() ?? {},
          stickers,
          voiceDir: voiceDir ?? path.join(workDir, '.voice'),
          log,
        })
        if (!built.ok) {
          // ⚠️ 造不出来（比如语音转不了格式）：**不删文件**，把原因记下来
          log(`[qq] 这条造不出来：${built.error}`)
          return { sent, skipped: `build-failed:${built.error}` }
        }
        // 有群号 → 发群里；没有 → 发给他（老路，一个字节都不改）
        const r = plan.groupId
          ? await ob.sendGroup(plan.groupId, built.message)
          : await ob.sendPrivate(ownerId, built.message)
        if (!r || r.ok === false) {
          // ⚠️ 发失败：**不删文件**，留到下一轮（B 站 11-03 的坑）
          log(`[qq] 回话没发出去（${plan.groupId ? `群 ${plan.groupId}` : '私信'}），文件留着，下一轮再试`)
          return { sent, skipped: 'send-failed' }
        }
        sent += 1
        if (i < plans.length - 1 && cfg.gapMs > 0) {
          await new Promise((r2) => setTimeout(r2, cfg.gapMs))
        }
      }
      lastSentHash = got.hash
      clearFile()
      log(`[qq] 回话已发出 ${sent} 条`)
      return { sent, skipped: null }
    } catch (e) {
      log(`[qq] 回话发送出错：${e?.message ?? e}`)
      return { sent, skipped: `error:${e?.message ?? e}` }
    } finally {
      sending = false
    }
  }

  function start() {
    if (timer) return
    const loop = async () => {
      if (stopped) return
      try { await tick() } catch { /* tick 自己会记 */ }
      const delay = cfgOf().intervalMs
      timer = setTimeout(() => { timer = null; if (!stopped) void loop() }, delay)
      if (timer.unref) timer.unref()
    }
    void loop()
  }

  function stop() {
    stopped = true
    if (timer) { clearTimeout(timer); timer = null }
  }

  return { tick, start, stop, get file() { return file }, _state: () => ({ lastSentHash, sending }) }
}
