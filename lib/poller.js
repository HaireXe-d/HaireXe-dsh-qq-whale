/**
 * dsh-qq-whale · 收信循环
 *
 * 为什么用**轮询**而不是 WebSocket：跟 B 站那边一致（`listen.dmIntervalSec`），
 * 而且 OneBot 的 WS 断线重连、心跳、握手这一套翻一倍代码量，
 * 出事的时候也难查（「我明明连着」其实早就断了 ✗）。
 * 轮询慢一点，但状态清清楚楚：上次游标、失败次数、退避多久，全在 state 里 ✓
 *
 * 这个文件不 import DSH，也不发网络请求（`ob` 是外面传进来的）—— 好测 ✓
 */
import { pickGroupMessages } from './group.js'

export const POLL_DEFAULTS = {
  intervalSec: 8,        // 多久问一次（跟 B 站 listen.dmIntervalSec 一样）
  backoffMaxSec: 180,    // 连续失败最多退到 3 分钟（跟 poll-policy 一致）
  quietHours: [],        // [{from:'23:00', to:'08:00'}] 这段时间不发主动消息，但**照样收**
  groupIntervalSec: 20,  // 群消息多久查一次（比私信慢：群多的时候要一个一个问）
}

/**
 * 群消息轮询（2026-11-07）
 *
 * ⚠️ 群聊跟私信最大的结构差别：**群有好几个**。
 *   私信只要一条「上次看到哪」；群里每个群各要一条，否则
 *   ① 拿 A 群的状态去问 B 群 → 漏消息
 *   ② 一次只问一个群 → 其他群要等好几轮
 *
 * 所以这里一次只问**一个**群（轮着来），各自留一份命中记录。
 * 「这条是不是给我的」不在这里判 —— 判在 group.js（那边单测更省事，也不用连网）✓
 */
export function createGroupPoller({
  ob,
  groups = [],
  selfId = '',
  ownerId = '',
  opts = {},
  selfNickname = '',
  seen = { keys: [] },
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g?.enabled !== false && g?.id)
  seen.keys ??= []
  const seenSet = new Set(seen.keys.slice(-1000))
  let rr = 0

  /**
   * 跑一轮：**每次只问一个群**（轮着来）。
   * 群多的时候一轮打十几个 HTTP 会撞限流，轮问更稳 ✓
   */
  async function pollOnce() {
    if (list.length === 0) return { ok: true, fresh: [], tried: null, unsupported: false }
    const g = list[rr % list.length]
    rr += 1
    let data
    try {
      data = await ob.getGroupHistory(g.id, { count: 20 })
    } catch (e) {
      const msg = String(e?.message ?? e).slice(0, 200)
      // ⚠️「接口不存在」和「网络挂了」要分开：
      //   前者说明这个 OneBot 实现不给群历史 → 群聊只能靠实时事件（README 里写了）
      //   后者是暂时性的，下一轮还会试 ✓
      const unsupported = /retcode=1[0-9]{2}|不支持的|unsupported|未知|not found|HTTP 404/i.test(msg)
      log(`[qq] 拉群 ${g.id} 的历史失败${unsupported ? '（这个 OneBot 实现可能不支持群历史）' : ''}：${msg}`)
      return { ok: false, fresh: [], tried: g.id, unsupported }
    }
    const { items } = pickGroupMessages(data, {
      selfId, ownerId, opts, selfNickname, seen: seenSet,
    })
    const fresh = []
    for (const it of items) {
      if (seenSet.has(it.key)) continue
      seenSet.add(it.key)
      fresh.push(it)
    }
    seen.keys = [...seenSet].slice(-1000)
    return { ok: true, fresh, tried: g.id, unsupported: false }
  }

  return { pollOnce, seen, groups: list, opts }
}

export function createPoller({
  ob,
  ownerId,
  selfId = '',           // ⚠️ 2026-11-04：我自己的号 —— 历史里混着的「我发的」要剔掉（见 normalizeHistory）
  state = {},
  opts = {},
  onMessage,
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const o = { ...POLL_DEFAULTS, ...opts }
  state.failures ??= 0
  state.lastPollAt ??= 0
  state.seen ??= []
  state.connected ??= null
  const me = String(selfId ?? '')

  const seen = new Set(state.seen.slice(-500))

  // ⚠️ 2026-11-07 晚（线上反馈「发消息收不到」）：
  //   别人的私信也要能收到 —— 从好友列表里**轮着**挑几个来拉。
  //   好友列表拉一次缓存 5 分钟（别每轮都打接口），每轮挑 2 个 ✓
  let friendCache = { at: 0, list: [], loading: false }
  let friendIdx = 0
  function friendRoundRobin() {
    const ttl = 5 * 60 * 1000
    if (now() - friendCache.at > ttl && !friendCache.loading) {
      // getFriendList 是异步的，这里同步取不到 → 后台刷新，下一轮就能用上
      friendCache.loading = true
      void (async () => {
        try {
          const r = await ob.getFriendList()
          const arr = Array.isArray(r) ? r : (r?.data ?? [])
          friendCache = {
            at: now(),
            loading: false,
            list: arr.map((f) => String(f?.user_id ?? f?.userId ?? '')).filter(Boolean),
          }
        } catch {
          friendCache = { at: now(), loading: false, list: friendCache.list }  // 拿不到就沿用旧的
        }
      })()
    }
    const list = friendCache.list
    if (!list.length) return []
    const out = []
    for (let i = 0; i < 2 && i < list.length; i += 1) {
      out.push(list[friendIdx % list.length])
      friendIdx += 1
    }
    return out.filter((u) => u && u !== String(ownerId ?? '').trim())
  }

  function nextDelayMs() {
    const base = Math.max(1, Number(o.intervalSec) || 8) * 1000
    if (!state.failures) return base
    const backoff = Math.min(base * 2 ** state.failures, Math.max(1, o.backoffMaxSec) * 1000)
    return backoff
  }

  async function pollOnce() {
    state.lastPollAt = now()
    try {
      // ⚠️ 2026-11-07 晚（线上反馈「发消息收不到」）：
      //   原来这里**只拉 ownerId 一个人的私信**。三个坑：
      //   ① ownerId 没填（空串）→ get_friend_msg_history user_id='' → 报错 → 一条都收不到 ✗
      //   ② 别人给机器人发私信 → 从来不去拉 → 收不到 ✗
      //   ③ 有的 OneBot 实现压根没这个接口
      //
      //   现在：
      //   · ownerId 有 → 先拉他的（最常见，也最靠前）
      //   · 再从好友列表里**轮流**拉几个别人的（每轮 2 个，别撞限流）
      //     —— 这样别人发私信也能收到，进待审 ✓
      //   · ownerId 为空 → 直接走好友列表，不再发那个必然失败的请求 ✓
      const targets = []
      const oid = String(ownerId ?? '').trim()
      if (oid) targets.push(oid)
      for (const u of friendRoundRobin()) {
        if (!targets.includes(u)) targets.push(u)
        if (targets.length >= 3) break   // 主人 + 2 个好友，够用且不炸限流
      }

      if (!targets.length) {
        // 一个可拉的对象都没有 —— 别当错误，下一轮再看（好友列表可能还没拿到）
        state.failures = 0
        state.connected = true
        state.lastError = null
        return { ok: true, fresh: [], note: '没有可拉私信的对象（主人号没填、好友列表也还是空的）' }
      }

      // 把多个人拉回来的消息合成一批
      const merged = []
      let lastErr = null
      for (const uid of targets) {
        try {
          const h = await ob.getPrivateHistory(uid, { count: 20 })
          const list = normalizeHistory(h, { selfId: me })
          merged.push(...list)
        } catch (e) {
          lastErr = e
          // 单个号失败不影响其他的（比如对方注销了）
        }
      }
      if (merged.length === 0 && lastErr) throw lastErr
      // ⚠️ 2026-11-07 晚：merged 里**已经**是 normalizeHistory 处理过的对象了，
      //   不能再 normalizeHistory 一次 —— 那会把它们当成原始消息重新解析，
      //   结果是 type/message 字段都没有 → 全部过滤掉 → 一条消息都收不到 ✗
      //   （自己刚写的 bug，靠 debug 日志才看出来）
      merged.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))
      state.failures = 0
      state.connected = true
      state.lastError = null
      const list = merged
      const fresh = []
      for (const msg of list) {
        if (seen.has(msg.key)) continue
        seen.add(msg.key)
        fresh.push(msg)
      }
      // 只在有新东西时通知，别每次轮询都吵
      if (fresh.length) {
        // 第一次轮询（还没有基线）只建基线，不把老消息当成新消息灌进去 ✓
        if (state.baselineDone) {
          for (const msg of fresh) onMessage?.(msg)
        }
        state.baselineDone = true
      } else if (!state.baselineDone && list.length === 0) {
        state.baselineDone = true
      }
      state.seen = [...seen].slice(-500)
      return { ok: true, fresh: state.baselineDone ? fresh.length : 0 }
    } catch (e) {
      state.failures += 1
      state.connected = false
      state.lastError = String(e?.message ?? e).slice(0, 300)
      log(`[qq] 轮询失败（第 ${state.failures} 次）：${state.lastError}`)
      return { ok: false, error: state.lastError }
    }
  }

  return { pollOnce, nextDelayMs, state, opts: o, _seen: seen }
}

/**
 * OneBot 实现五花八门：有的给 { messages: [...] }，有的直接给数组。
 * 统一成 [{ key, messageId, userId, nickname, text, images, time }]，最近的在后。
 *
 * ⚠️⚠️ 2026-11-04 18:10 刷屏事故的真因就在这里：
 *
 *   NapCat 的 `get_friend_msg_history` 里**混着我自己发出去的消息**
 *   （`post_type: "message_sent"`，`sender.user_id` 是我自己的号）。
 *   原来这里一律当成「来信」，于是：
 *     · 我自己发一句 → 下一轮轮询看见它 → 当成「别人发来的」
 *     · `shouldAutoReply` 判定不是主人 → 进待审队列 + 给他推一条【等你审核】
 *     · 我每发一条就多一条，越堆越多 → 他那边的 QQ 直接被刷屏 ✗
 *
 *   现在两道闸：
 *     ① 带 `post_type === 'message_sent'` / `message_sent_type` 字段的 → 直接丢掉（明确是我发的）
 *     ② 发送者 == 我自己的号（selfId）→ 也丢掉（有些实现不给 post_type）
 *   `selfId` 不传的话只靠 ①，所以调用方**应该传**。
 *
 * ⚠️⚠️ 2026-11-04 18:40 **纯图片消息收不到**：
 *
 *   原来只取 `type === 'text'` 的段，纯图消息 text 是空串，
 *   最后 `.filter((m) => m.text)` 把它整个丢掉 —— 表情包连进都进不来 ✗
 *   （18:38 主人真发了一张，NapCat 明明收到了，这边什么都看不见）
 *
 *   现在：把 `image` 段也提出来放进 `images`，**只要有图就不算空消息** ✓
 *   每个 image 带 `{ url, file, summary, size }`，下载交给上层
 *   （这个函数保持纯解析，方便单测）✓
 */
export function normalizeHistory(data, { selfId = '' } = {}) {
  const raw = Array.isArray(data) ? data : (data?.messages ?? data?.message_list ?? [])
  if (!Array.isArray(raw)) return []
  const me = String(selfId ?? '')
  return raw
    .filter((m) => {
      // ① 明确是我发出去的
      if (m?.post_type === 'message_sent') return false
      if (m?.message_sent_type) return false
      // ② 发送者是自己
      if (me && String(m?.sender?.user_id ?? m?.user_id ?? '') === me) return false
      return true
    })
    .map((m) => {
      const userId = String(m?.sender?.user_id ?? m?.user_id ?? '')
      const messageId = m?.message_id ?? m?.real_id ?? null
      const time = Number(m?.time ?? 0) * 1000 || 0
      const segs = Array.isArray(m?.message) ? m.message : null
      const text = segs
        ? segs.filter((s) => s?.type === 'text').map((s) => s.data?.text ?? '').join('').trim()
        : stripCqLocal(m?.raw_message ?? '')
      // 图片段（2026-11-04 18:40 新增）
      const images = (segs ? segs.filter((s) => s?.type === 'image') : [])
        .map((s) => ({
          url: s.data?.url ?? '',
          file: s.data?.file ?? '',
          summary: s.data?.summary ?? '',
          size: Number(s.data?.file_size) || 0,
        }))
        .filter((x) => x.url || x.file)
      return {
        key: `${userId}:${messageId ?? `${time}:${text}`}`,
        messageId,
        userId,
        nickname: m?.sender?.nickname ?? '',
        text,
        images,
        time,
      }
    })
    // ⚠️ 有文字**或者**有图，都算一条消息 ✓（以前只看文字，纯图被丢掉）
    .filter((m) => m.text || m.images.length > 0)
}
function stripCqLocal(s) { return String(s ?? '').replace(/\[CQ:[^\]]+\]/g, '').trim() }

/** 现在是不是安静时段（安静时段只收不发） */
export function inQuietHours(windows, date = new Date()) {
  if (!Array.isArray(windows) || windows.length === 0) return false
  const mins = date.getHours() * 60 + date.getMinutes()
  const parse = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim())
    if (!m) return null
    return Number(m[1]) * 60 + Number(m[2])
  }
  for (const w of windows) {
    const a = parse(w?.from)
    const b = parse(w?.to)
    if (a === null || b === null) continue
    if (a === b) continue
    if (a < b) { if (mins >= a && mins < b) return true }
    else if (mins >= a || mins < b) return true   // 跨零点
  }
  return false
}
