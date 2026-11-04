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

export const POLL_DEFAULTS = {
  intervalSec: 8,        // 多久问一次（跟 B 站 listen.dmIntervalSec 一样）
  backoffMaxSec: 180,    // 连续失败最多退到 3 分钟（跟 poll-policy 一致）
  quietHours: [],        // [{from:'23:00', to:'08:00'}] 这段时间不发主动消息，但**照样收**
}

export function createPoller({
  ob,
  ownerId,
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

  const seen = new Set(state.seen.slice(-500))

  function nextDelayMs() {
    const base = Math.max(1, Number(o.intervalSec) || 8) * 1000
    if (!state.failures) return base
    const backoff = Math.min(base * 2 ** state.failures, Math.max(1, o.backoffMaxSec) * 1000)
    return backoff
  }

  async function pollOnce() {
    state.lastPollAt = now()
    try {
      const history = await ob.getPrivateHistory(ownerId, { count: 20 })
      state.failures = 0
      state.connected = true
      state.lastError = null
      const list = normalizeHistory(history)
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
 * 统一成 [{ key, userId, text, time }]，最近的在后。
 */
export function normalizeHistory(data) {
  const raw = Array.isArray(data) ? data : (data?.messages ?? data?.message_list ?? [])
  if (!Array.isArray(raw)) return []
  return raw
    .map((m) => {
      const userId = String(m?.sender?.user_id ?? m?.user_id ?? '')
      const messageId = m?.message_id ?? m?.real_id ?? null
      const time = Number(m?.time ?? 0) * 1000 || 0
      const text = typeof m?.message === 'string'
        ? stripCqLocal(m.message)
        : Array.isArray(m?.message)
          ? m.message.filter((s) => s?.type === 'text').map((s) => s.data?.text ?? '').join('').trim()
          : stripCqLocal(m?.raw_message ?? '')
      return {
        key: `${userId}:${messageId ?? `${time}:${text}`}`,
        userId,
        nickname: m?.sender?.nickname ?? '',
        text,
        time,
      }
    })
    .filter((m) => m.text)
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
