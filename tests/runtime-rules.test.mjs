import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readRuntimeRules } from '../lib/runtime-rules.js'

// 一份最小的规则实现（跟 core 的 capabilitiesFor 同样的形状），免得测试依赖 core 的路径
const rules = {
  normalizeShared: (s) => ({ dm: 'bili', dynamic: 'bili', share: true, ...s }),
  capabilitiesFor(id, { shared, enabled }) {
    if (enabled[id] === false) return { on: false, dm: false, share: false, dynamic: false, why: '关着' }
    return {
      on: true,
      dm: shared.dm === id,
      dynamic: shared.dynamic === id,
      share: id === 'bili',
      why: 'ok',
    }
  },
}

function home({ shared, index } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-rules-'))
  fs.mkdirSync(path.join(dir, 'whale-channels'), { recursive: true })
  if (shared) fs.writeFileSync(path.join(dir, 'whale-channels', 'shared.json'), JSON.stringify(shared))
  if (index) fs.writeFileSync(path.join(dir, 'whale-channels', 'index.json'), JSON.stringify(index))
  return dir
}

test('私聊给了 B 站 → QQ 运行时不私聊（这条以前是坏的）', () => {
  const r = readRuntimeRules({ dshHome: home({ shared: { dm: 'bili', dynamic: 'bili' } }), channel: 'qq', rules })
  assert.equal(r.dm, false, 'QQ 不该抢私聊')
  assert.equal(r.known, true)
})

test('私聊给了 QQ → QQ 运行时要私聊', () => {
  const r = readRuntimeRules({ dshHome: home({ shared: { dm: 'qq', dynamic: 'qq' } }), channel: 'qq', rules })
  assert.equal(r.dm, true)
  assert.equal(r.dynamic, true)
})

test('分享视频：B 站运行时能分享，QQ 不能', () => {
  const d = home({ shared: {} })
  assert.equal(readRuntimeRules({ dshHome: d, channel: 'bili', rules }).share, true)
  assert.equal(readRuntimeRules({ dshHome: d, channel: 'qq', rules }).share, false)
})

test('通道自己关着 → 什么都不能', () => {
  const d = home({ shared: { dm: 'qq', dynamic: 'qq' }, index: { channels: { qq: { enabled: false } } } })
  const r = readRuntimeRules({ dshHome: d, channel: 'qq', rules })
  assert.equal(r.dm, false)
  assert.equal(r.dynamic, false)
})

test('配置文件根本没有 → 按默认（B 站全有，QQ 没私聊）', () => {
  const d = home({})
  const bili = readRuntimeRules({ dshHome: d, channel: 'bili', rules })
  const qq = readRuntimeRules({ dshHome: d, channel: 'qq', rules })
  assert.equal(bili.dm, true)
  assert.equal(qq.dm, false)
})

test('没有规则实现时按允许处理（不能因为读不到就装死）', () => {
  const r = readRuntimeRules({ dshHome: home({}), channel: 'qq', rules: null })
  assert.equal(r.dm, true)
  assert.equal(r.known, false)
  assert.match(r.why, /按允许处理/)
})

test('规则实现抛错也按允许处理，并且把原因带出来', () => {
  const bad = { normalizeShared: () => { throw new Error('配置坏了') }, capabilitiesFor: () => ({}) }
  const r = readRuntimeRules({ dshHome: home({ shared: { dm: 'xx' } }), channel: 'qq', rules: bad })
  assert.equal(r.dm, true)
  assert.equal(r.known, false)
  assert.match(r.why, /配置坏了/)
})

test('配置文件是坏 json 也不炸', () => {
  const d = home({})
  fs.writeFileSync(path.join(d, 'whale-channels', 'shared.json'), '{ 坏 json')
  const r = readRuntimeRules({ dshHome: d, channel: 'qq', rules })
  assert.equal(r.known, true, '坏文件当成空配置，规则还能算')
  assert.equal(r.dm, false, '空配置 → 私聊默认在 B 站')
})
