import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS, makeConfigReader } from '../lib/index.js'

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-qq-')) }

test('通道定义是合法的：id、label、order、默认关', () => {
  const ch = buildChannel({ dshHome: tmpHome(), readConfig: () => DEFAULTS })
  assert.equal(ch.id, 'qq')
  assert.equal(ch.label, 'QQ')
  assert.equal(ch.order, 20)
  assert.equal(ch.defaultEnabled, false, '没配 OneBot 之前不能默认开，不然一直报错')
  assert.equal(typeof ch.start, 'function')
  assert.equal(typeof ch.deps, 'function')
})

test('没配 OneBot 地址 / 没配主人 QQ 号时 start 不炸，只记日志', () => {
  const logs = []
  const ch = buildChannel({
    dshHome: tmpHome(),
    readConfig: () => ({ ...DEFAULTS, owner: { uin: '' } }),
    log: (m) => logs.push(m),
  })
  const handle = ch.start({})
  assert.equal(typeof handle.stop, 'function')
  handle.stop()
  assert.ok(logs.some((l) => l.includes('主人的 QQ 号')), logs.join('\n'))
})

test('配置文件不存在时用默认值（不会读成 undefined）', () => {
  const file = path.join(tmpHome(), 'nope.json')
  const read = makeConfigReader({ file })
  const cfg = read()
  assert.equal(cfg.onebot.baseUrl, 'http://127.0.0.1:3000')
  assert.equal(cfg.listen.intervalSec, 8)
})

test('deps 在没配的时候有条目是红的，但不抛', async () => {
  const ch = buildChannel({ dshHome: tmpHome(), readConfig: () => DEFAULTS })
  const r = await ch.deps({})
  assert.equal(r.ok, false)
  const uin = r.items.find((i) => i.name.includes('QQ 号'))
  assert.equal(uin.ok, false)
})

test('路由表声明了 status / test / poke', () => {
  const ch = buildChannel({ dshHome: tmpHome(), readConfig: () => DEFAULTS })
  // ⚠️ 2026-11-04 晚：新增三个备份接口（主人要「控制台有记忆恢复」）
  //   GET  /backup/inspect   看一眼备份目录
  //   POST /backup/export    备份
  //   POST /backup/import    恢复（默认只预演）
  assert.deepEqual(Object.keys(ch.routes).sort(), [
    'GET /accounts',
    'GET /backup/inspect',
    'GET /format',
    'GET /pending',
    'GET /status',
    'GET /stickers',
    'GET /voice/check',
    'POST /accounts/refresh',
    'POST /auth/qr/cancel',
    'POST /auth/qr/poll',
    'POST /auth/qr/start',
    'POST /backup/export',
    'POST /backup/import',
    'POST /format/pin',
    'POST /pending/approve',
    'POST /pending/drop',
    'POST /pending/revise',
    'POST /poke',
    'POST /stickers/save',
    'POST /stickers/send',
    'POST /test',
    'POST /voice/import',
    'POST /voice/preview',
  ])
})
