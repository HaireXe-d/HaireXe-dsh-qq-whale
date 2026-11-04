import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseClock, formatClock, windowAt, clockOf, dayKey,
  shouldWakeNow, recordWake, nextWakeAt, windowId,
} from '../lib/schedule.js'

/** 造一个本地时间，省得写一长串 */
function at(y, mo, d, h, mi = 0) {
  return new Date(y, mo - 1, d, h, mi, 0, 0)
}

const NIGHT = {
  windows: [
    { start: '8:00', end: '12:00', wakes: 1 },
    { start: '14:00', end: '16:00', wakes: 1 },
    { start: '19:00', end: '23:00', wakes: 1 },
  ],
  skipChance: 0,
  minGapMin: 60,
  maxWakesPerDay: 3,
}

test('parseClock 认 HH:MM，拒绝非法值', () => {
  assert.equal(parseClock('8:00'), 480)
  assert.equal(parseClock('08:30'), 510)
  assert.equal(parseClock('23:59'), 1439)
  assert.equal(parseClock('24:00'), null)
  assert.equal(parseClock('9:60'), null)
  assert.equal(parseClock('abc'), null)
  assert.equal(parseClock(''), null)
})

test('formatClock 补零', () => {
  assert.equal(formatClock(480), '08:00')
  assert.equal(formatClock(0), '00:00')
  assert.equal(formatClock(1440), '00:00')
})

test('windowAt：普通窗口命中/不命中', () => {
  const w = windowAt([{ start: '8:00', end: '12:00' }], at(2026, 11, 4, 9, 30))
  assert.ok(w)
  assert.equal(windowAt([{ start: '8:00', end: '12:00' }], at(2026, 11, 4, 12, 0)), null, '右开区间')
  assert.equal(windowAt([{ start: '8:00', end: '12:00' }], at(2026, 11, 4, 7, 59)), null)
})

test('windowAt：跨零点的窗口也能命中（23:00-02:00）', () => {
  const wins = [{ start: '23:00', end: '02:00' }]
  assert.ok(windowAt(wins, at(2026, 11, 4, 23, 30)))
  assert.ok(windowAt(wins, at(2026, 11, 4, 0, 30)))
  assert.ok(windowAt(wins, at(2026, 11, 4, 1, 59)))
  assert.equal(windowAt(wins, at(2026, 11, 4, 2, 0)), null)
  assert.equal(windowAt(wins, at(2026, 11, 4, 12, 0)), null)
})

test('没配作息 → 永远不主动醒', () => {
  assert.equal(shouldWakeNow({ night: {}, now: at(2026, 11, 4, 9) }).wake, false)
  assert.equal(shouldWakeNow({ night: { windows: [] }, now: at(2026, 11, 4, 9) }).wake, false)
})

test('在窗口里 + 没醒过 → 该醒', () => {
  const r = shouldWakeNow({ night: NIGHT, state: {}, now: at(2026, 11, 4, 9) })
  assert.equal(r.wake, true)
  assert.equal(r.window.start, '8:00')
})

test('不在窗口里 → 不醒', () => {
  const r = shouldWakeNow({ night: NIGHT, state: {}, now: at(2026, 11, 4, 13) })
  assert.equal(r.wake, false)
  assert.match(r.reason, /不在醒来时段/)
})

test('同一时段已经醒过 → 不再醒', () => {
  const t = at(2026, 11, 4, 9)
  const s1 = recordWake({}, t, NIGHT.windows[0])
  const r = shouldWakeNow({ night: NIGHT, state: s1, now: at(2026, 11, 4, 10) })
  assert.equal(r.wake, false)
  assert.match(r.reason, /已经醒过/)
})

test('换一个时段就能再醒', () => {
  const t1 = at(2026, 11, 4, 9)
  const s1 = recordWake({}, t1, NIGHT.windows[0])
  const r = shouldWakeNow({ night: NIGHT, state: s1, now: at(2026, 11, 4, 15) })
  assert.equal(r.wake, true, '下午那个窗口该醒')
  assert.equal(r.window.start, '14:00')
})

test('一天总量封顶', () => {
  const night = { ...NIGHT, minGapMin: 0, maxWakesPerDay: 1 }
  const t = at(2026, 11, 4, 9)
  const s = recordWake({}, t, night.windows[0])
  const r = shouldWakeNow({ night, state: s, now: at(2026, 11, 4, 15) })
  assert.equal(r.wake, false)
  assert.match(r.reason, /上限 1/)
})

test('跨天重新计数', () => {
  const night = { ...NIGHT, minGapMin: 0 }
  const s1 = recordWake({}, at(2026, 11, 4, 9), night.windows[0])
  assert.equal(s1.wakesToday, 1)
  // 第二天同一个窗口又能醒
  const r = shouldWakeNow({ night, state: s1, now: at(2026, 11, 5, 9) })
  assert.equal(r.wake, true)
})

test('两次醒来间隔太近 → 不醒', () => {
  const night = { ...NIGHT, minGapMin: 120 }
  const t = at(2026, 11, 4, 9)
  const s = recordWake({}, t, night.windows[0])
  // 10:00 在下一个窗口外，用个同一窗口内的时刻测间隔
  const r = shouldWakeNow({ night, state: s, now: at(2026, 11, 4, 9, 30) })
  // 9:30 还在 8-12 窗口，但「这个时段醒过」先拦住了 —— 这本身也是对的
  assert.equal(r.wake, false)
})

test('间隔够久 → 换窗口能醒', () => {
  const night = { ...NIGHT, minGapMin: 60 }
  const s = recordWake({}, at(2026, 11, 4, 9), night.windows[0])
  const r = shouldWakeNow({ night, state: s, now: at(2026, 11, 4, 14, 30) })
  assert.equal(r.wake, true)
})

test('skipChance=1 → 一定跳过', () => {
  const night = { ...NIGHT, skipChance: 1 }
  const r = shouldWakeNow({ night, state: {}, now: at(2026, 11, 4, 9), random: () => 0 })
  assert.equal(r.wake, false)
  assert.match(r.reason, /跳过/)
})

test('skipChance=0 → 一定不跳过', () => {
  const night = { ...NIGHT, skipChance: 0 }
  const r = shouldWakeNow({ night, state: {}, now: at(2026, 11, 4, 9), random: () => 0 })
  assert.equal(r.wake, true)
})

test('recordWake 不改原对象，正确累加', () => {
  const s0 = { dayKey: dayKey(at(2026, 11, 4, 1)), wakesToday: 2 }
  const s1 = recordWake(s0, at(2026, 11, 4, 9), NIGHT.windows[0])
  assert.equal(s0.wakesToday, 2, '原对象不能被改')
  assert.equal(s1.wakesToday, 3)
})

test('nextWakeAt：今天还有窗口 → 返回今天的下一个', () => {
  const n = nextWakeAt({ night: NIGHT, state: {}, now: at(2026, 11, 4, 9, 30) })
  const d = new Date(n)
  assert.equal(d.getHours(), 14, '下一个窗口是 14:00')
})

test('nextWakeAt：今天没了 → 返回明天第一个', () => {
  const n = nextWakeAt({ night: NIGHT, state: {}, now: at(2026, 11, 4, 23, 30) })
  const d = new Date(n)
  assert.equal(d.getDate(), 5)
  assert.equal(d.getHours(), 8)
})

test('nextWakeAt：没配作息 → null', () => {
  assert.equal(nextWakeAt({ night: {}, now: at(2026, 11, 4, 9) }), null)
})

test('clockOf / dayKey 用本地时区', () => {
  assert.equal(clockOf(at(2026, 11, 4, 9, 30)), 570)
  assert.equal(dayKey(at(2026, 11, 4, 23, 59)), '2026-11-04')
})

test('windowId 稳定', () => {
  assert.equal(windowId({ start: '8:00', end: '12:00' }), '8:00-12:00')
})
