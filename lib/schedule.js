/**
 * dsh-qq-whale · 作息（生物钟）
 *
 * 2026-11-04：主人说「QQ养鱼如果独立出来用好像做不到哔站养鱼的效果，像作息、人格、
 * 醒来时间设置啥的，你照着哔站养鱼的功能改好」。
 *
 * 所以这个文件照着 B 站 `scheduler.js` 的作息语义重写了一份**纯函数版**：
 * 只算「现在该不该醒」，不管网络、不管发消息 —— 那些交给 index.js。
 * 纯函数的好处是能测：给定时间和配置，答案完全确定 ✓
 *
 * 配置形状（和 B 站保持一致，方便互相迁移）：
 *   night = {
 *     windows: [{ start: '8:00', end: '12:00', wakes: 1 }, ...],  // 允许醒来的时段
 *     skipChance: 0,           // 到点了也有这个概率跳过（0 = 每次都醒）
 *     minGapMin: 60,           // 两次醒来之间至少隔多久
 *     maxWakesPerDay: 3,       // 一天最多醒几次
 *   }
 */

/** 'HH:MM' → 当天第几分钟。非法返回 null */
export function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** 分钟数 → 'HH:MM' */
export function formatClock(mins) {
  const m = ((Number(mins) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * 某个时刻落不落在任意一个窗口里。
 * 支持**跨零点**的窗口：{ start: '23:00', end: '02:00' } ✓
 * @returns {object|null} 命中的窗口（带上它的 wakes），没命中返回 null
 */
export function windowAt(windows, at) {
  const mins = typeof at === 'number' ? at : clockOf(at)
  for (const w of Array.isArray(windows) ? windows : []) {
    const s = parseClock(w?.start)
    const e = parseClock(w?.end)
    if (s === null || e === null) continue
    const inside = s <= e
      ? mins >= s && mins < e          // 普通窗口
      : mins >= s || mins < e          // 跨零点
    if (inside) return w
  }
  return null
}

/** Date → 当天第几分钟（本地时区） */
export function clockOf(date) {
  const d = date instanceof Date ? date : new Date(date)
  return d.getHours() * 60 + d.getMinutes()
}

/** 本地日期的 key，用来数「今天醒了几次」（YYYY-MM-DD） */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 现在该不该醒？
 *
 * @param {object} p
 * @param {object} p.night     作息配置
 * @param {object} p.state     { lastWakeAt, dayKey, wakesToday, lastWakeWindow }
 * @param {number|Date} [p.now]
 * @param {number} [p.random]  0..1，测试注入
 * @returns {{ wake: boolean, reason: string, window?: object, wakesToday?: number }}
 */
export function shouldWakeNow({ night, state = {}, now = Date.now(), random = Math.random } = {}) {
  const t = now instanceof Date ? now : new Date(now)
  const cfg = night ?? {}
  const windows = Array.isArray(cfg.windows) ? cfg.windows : []

  // ① 没配作息 → 不主动醒（只被动回消息）
  if (!windows.length) return { wake: false, reason: '没配作息' }

  // ② 现在不在任何窗口里 → 不该醒
  const win = windowAt(windows, t)
  if (!win) return { wake: false, reason: '不在醒来时段' }

  // ③ 这个窗口今天已经醒过了 → 不再醒（每个窗口有自己的 wakes 次数）
  const k = dayKey(t)
  const wakesToday = state.dayKey === k ? Number(state.wakesToday) || 0 : 0
  if (state.lastWakeWindow === windowId(win) && state.lastWakeDay === k) {
    return { wake: false, reason: '这个时段已经醒过', wakesToday }
  }

  // ④ 一天总量封顶
  const maxDay = Number(cfg.maxWakesPerDay)
  if (Number.isFinite(maxDay) && maxDay >= 0 && wakesToday >= maxDay) {
    return { wake: false, reason: `今天已经醒了 ${wakesToday} 次（上限 ${maxDay}）`, wakesToday }
  }

  // ⑤ 距上次醒得太近
  const gapMin = Number(cfg.minGapMin)
  const last = Number(state.lastWakeAt) || 0
  if (Number.isFinite(gapMin) && gapMin > 0 && last > 0) {
    const elapsedMin = (t.getTime() - last) / 60000
    if (elapsedMin < gapMin) {
      return { wake: false, reason: `离上次醒来才 ${Math.round(elapsedMin)} 分钟（最少隔 ${gapMin}）`, wakesToday }
    }
  }

  // ⑥ 到点了也可能跳过（不每次都那么勤快）
  const skip = Number(cfg.skipChance)
  if (Number.isFinite(skip) && skip > 0 && random() < skip) {
    return { wake: false, reason: '这次随机跳过了', wakesToday }
  }

  return { wake: true, reason: '到点了', window: win, wakesToday }
}

/** 窗口的身份（判断「这个时段今天醒没醒过」用 start-end 就能唯一确定） */
export function windowId(w) {
  return `${w?.start ?? ''}-${w?.end ?? ''}`
}

/**
 * 醒来之后更新状态。返回新的 state（不改原对象）。
 */
export function recordWake(state = {}, at = Date.now(), win = null) {
  const t = at instanceof Date ? at : new Date(at)
  const k = dayKey(t)
  const wakesToday = (state.dayKey === k ? Number(state.wakesToday) || 0 : 0) + 1
  return {
    ...state,
    lastWakeAt: t.getTime(),
    dayKey: k,
    wakesToday,
    lastWakeWindow: win ? windowId(win) : state.lastWakeWindow,
    lastWakeDay: k,
  }
}

/**
 * 下一次最早能醒的时刻（控制台显示「下次大概几点醒」用）。
 * @returns {number|null} 时间戳；没窗口返回 null
 */
export function nextWakeAt({ night, state = {}, now = Date.now() } = {}) {
  const cfg = night ?? {}
  const windows = Array.isArray(cfg.windows) ? cfg.windows : []
  if (!windows.length) return null
  const t = now instanceof Date ? now : new Date(now)
  const today = dayKey(t)
  const wakesToday = state.dayKey === today ? Number(state.wakesToday) || 0 : 0
  const maxDay = Number(cfg.maxWakesPerDay)
  if (Number.isFinite(maxDay) && maxDay >= 0 && wakesToday >= maxDay) {
    // 今天到头了，看明天第一个窗口
    const tomorrow = new Date(t)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const first = windows
      .map((w) => parseClock(w?.start))
      .filter((x) => x !== null)
      .sort((a, b) => a - b)[0]
    if (first === undefined) return null
    tomorrow.setHours(0, first, 0, 0)
    return tomorrow.getTime()
  }
  // 今天还没到的窗口
  const starts = windows
    .map((w) => parseClock(w?.start))
    .filter((x) => x !== null)
    .sort((a, b) => a - b)
  const nowMin = clockOf(t)
  const next = starts.find((s) => s > nowMin)
  if (next !== undefined) {
    const d = new Date(t)
    d.setHours(0, next, 0, 0)
    return d.getTime()
  }
  // 今天没有了 → 明天第一个
  const tomorrow = new Date(t)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, starts[0] ?? 0, 0, 0)
  return tomorrow.getTime()
}
