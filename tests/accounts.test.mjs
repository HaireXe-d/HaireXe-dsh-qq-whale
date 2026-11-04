import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildChannel, DEFAULTS } from '../lib/index.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qq-accounts-'))

function makeCtx() {
  return {
    json: (res, code, payload) => { res.statusCode = code; res.body = payload },
    readBody: (req) => Promise.resolve(req.body ?? '{}'),
  }
}
async function callRoute(ch, key, body) {
  const res = {}
  await ch.routes[key]({ body: body === undefined ? '{}' : JSON.stringify(body) }, res, makeCtx())
  return { status: res.statusCode, body: res.body }
}

// ⚠️ 2026-11-04 晚：GET /accounts 现在会**先问一次 NapCat 实时登录的是谁**
//   （解决主人「为什么已经登录的和最上面显示的不一样」）。
//   但 DEFAULTS 里 webui.url 默认就是真实的 127.0.0.1:6099 ——
//   测试会真的连上本机 NapCat，结果不稳定（取决于当时登的是哪个号）✗
//   所以这里把 url 指到一个死端口，模拟"问不到 NapCat"的情况，
//   这样测的就纯粹是「从配置读」这条回退路径 ✓
const DEAD_WEBUI = { ...DEFAULTS.webui, url: 'http://127.0.0.1:1' }

test('GET /accounts：没配的时候返回空的自号和主号', async () => {
  const ch = buildChannel({
    dshHome: tmp(),
    readConfig: () => ({ ...DEFAULTS, webui: DEAD_WEBUI }),
    log: () => {},
  })
  const r = await callRoute(ch, 'GET /accounts')
  assert.equal(r.body.ok, true)
  assert.equal(r.body.self.uin, '')
  assert.equal(r.body.owner.uin, '')
  assert.equal(r.body.self.live, false, '问不到 NapCat 时应该标明不是实时的')
})

test('GET /accounts：配了就读出来', async () => {
  const cfg = {
    ...DEFAULTS,
    webui: DEAD_WEBUI,
    self: { uin: '123456789', nickname: '邦邦' },
    owner: { uin: '3546626108951012', nickname: '主人' },
  }
  const ch = buildChannel({ dshHome: tmp(), readConfig: () => cfg, log: () => {} })
  const r = await callRoute(ch, 'GET /accounts')
  assert.equal(r.body.self.uin, '123456789')
  assert.equal(r.body.self.nickname, '邦邦')
  assert.equal(r.body.owner.uin, '3546626108951012')
  assert.equal(r.body.owner.nickname, '主人')
})

test('GET /accounts 不把 token / 密码漏出来', async () => {
  const cfg = {
    ...DEFAULTS,
    onebot: { baseUrl: 'http://127.0.0.1:3000', token: 'SECRET_TOKEN' },
    webui: { url: 'http://127.0.0.1:6099', token: 'SECRET_WEBUI' },
    owner: { uin: '3546626108951012' },
  }
  const ch = buildChannel({ dshHome: tmp(), readConfig: () => cfg, log: () => {} })
  const r = await callRoute(ch, 'GET /accounts')
  const text = JSON.stringify(r.body)
  assert.equal(text.includes('SECRET_TOKEN'), false)
  assert.equal(text.includes('SECRET_WEBUI'), false)
})

test('DEFAULTS 里有 self 和 owner 两块（跟 B 站那边对齐）', () => {
  assert.ok(DEFAULTS.self, '缺 self')
  assert.ok(DEFAULTS.owner, '缺 owner')
  assert.equal(typeof DEFAULTS.self.uin, 'string')
  assert.equal(typeof DEFAULTS.owner.uin, 'string')
})
