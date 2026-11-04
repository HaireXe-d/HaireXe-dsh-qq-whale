import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNapCatLogin, LoginError } from '../lib/qr-login.js'

function clock(start = Date.UTC(2026, 10, 4, 1, 0, 0)) {
  let t = start
  return { now: () => t, adv: (ms) => { t += ms } }
}

/** 假 NapCat WebUI：够用就好 */
function fakeNapCat({ qr = 'https://qun.qq.com/qrcode/index.html?key=K', isLoginOnFirstPoll = false, credential = 'CRED' } = {}) {
  const calls = []
  let pollCount = 0
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization })
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (path === '/api/auth/login') return ok({ code: 0, message: 'success', data: { Credential: credential } })
    if (path === '/api/QQLogin/GetQQLoginQrcode') return ok({ data: { qrcode: qr } })
    if (path === '/api/QQLogin/CheckLoginStatus') { pollCount += 1; return ok({ data: { isLogin: isLoginOnFirstPoll || pollCount > 1 } }) }
    if (path === '/api/QQLogin/GetQQLoginInfo') return ok({ data: { uin: '123456789', online: true, nickname: '主人' } })
    return ok({})
  }
  return { fetchImpl, calls }
}

test('start 会先用 sha256(token.napcat) 换 Credential，再要二维码', async () => {
  const { fetchImpl, calls } = fakeNapCat()
  const { now } = clock()
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'napcat_webui', fetchImpl, now, render: async () => 'data:image/png;base64,AAA' })
  const s = await login.start()
  assert.equal(s.status, 'waiting')
  assert.equal(s.image, 'data:image/png;base64,AAA')
  assert.equal(calls[0].path, '/api/auth/login')
  assert.match(calls[0].body.hash, /^[0-9a-f]{64}$/)
  assert.equal(calls[0].auth, undefined, '认证请求本身不该带 Bearer')
  assert.equal(calls[1].path, '/api/QQLogin/GetQQLoginQrcode')
  assert.equal(calls[1].auth, 'Bearer CRED', '拿码要带 Bearer')
})

test('认证失败要说是 token 的问题，别只说「失败」', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ code: -1, message: 'token 不对' }) })
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: clock().now })
  await assert.rejects(() => login.start(), /token 对不对/)
})

// 2026-11-04：文案从「NapCat 开着吗？」改成直接告诉他**怎么开** ——
//   只问「开着吗」不够，主人连着两次撞上这个错才发现 NapCat 根本没起来（它不会自启）。
test('连不上 WebUI 时带底层错误码，并直接告诉他怎么把 NapCat 开起来', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: clock().now })
  await assert.rejects(
    () => login.start(),
    (e) => /连不上 NapCat WebUI/.test(e.message)
      && /ECONNREFUSED/.test(e.message)
      && /NapCat 没在跑/.test(e.message)
      && /start-napcat\.bat/.test(e.message),
  )
})

test('二维码内容不是 http(s) 就拒（防止被塞 file:/data:）', async () => {
  const { fetchImpl } = fakeNapCat({ qr: 'file:///C:/Windows/win.ini' })
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: clock().now })
  await assert.rejects(() => login.start(), /协议不对/)
})

test('poll：没扫是 waiting，扫了之后 success 并带账号', async () => {
  const { fetchImpl } = fakeNapCat()
  const c = clock()
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: c.now, render: async () => 'img' })
  const s = await login.start()
  const first = await login.poll(s.id)
  assert.equal(first.status, 'waiting')
  c.adv(2100)
  const second = await login.poll(s.id)
  assert.equal(second.status, 'success')
  assert.equal(second.account.uin, '123456789')
  assert.equal(second.image, undefined, '成功后不该再回传二维码')
})

test('两次 poll 之间至少隔 2 秒（别一秒问五次）', async () => {
  const { fetchImpl, calls } = fakeNapCat()
  const c = clock()
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: c.now, render: async () => 'img' })
  const s = await login.start()
  await login.poll(s.id)
  const before = calls.filter((x) => x.path === '/api/QQLogin/CheckLoginStatus').length
  await login.poll(s.id)   // 立刻再问一次，应该被节流
  const after = calls.filter((x) => x.path === '/api/QQLogin/CheckLoginStatus').length
  assert.equal(after, before)
  c.adv(2100)
  await login.poll(s.id)
  assert.equal(calls.filter((x) => x.path === '/api/QQLogin/CheckLoginStatus').length, after + 1)
})

test('过期之后 poll 直接返回 expired，不再问 NapCat', async () => {
  const { fetchImpl, calls } = fakeNapCat()
  const c = clock()
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: c.now, render: async () => 'img' })
  const s = await login.start()
  c.adv(181_000)
  const r = await login.poll(s.id)
  assert.equal(r.status, 'expired')
  assert.equal(calls.filter((x) => x.path === '/api/QQLogin/CheckLoginStatus').length, 0)
})

test('拿错 id 的 poll 要被拒（防跨会话串号）', async () => {
  const { fetchImpl } = fakeNapCat()
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: clock().now })
  await login.start()
  await assert.rejects(() => login.poll('not-my-id'), LoginError)
})

test('cancel 之后状态是 cancelled，且清掉二维码', async () => {
  const { fetchImpl } = fakeNapCat()
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: clock().now, render: async () => 'img' })
  const s = await login.start()
  const c = login.cancel(s.id)
  assert.equal(c.status, 'cancelled')
  assert.equal(c.image, undefined)
})

test('NapCat 说已经登录了（QQ Is Logined）→ 直接 success', async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (path === '/api/auth/login') return ok({ code: 0, data: { Credential: 'C' } })
    if (path === '/api/QQLogin/GetQQLoginQrcode') return ok({ message: 'QQ Is Logined', data: {} })
    if (path === '/api/QQLogin/GetQQLoginInfo') return ok({ data: { uin: '987654321', online: true } })
    return ok({})
  }
  const login = createNapCatLogin({ webuiUrl: 'http://127.0.0.1:6099', webuiToken: 'x', fetchImpl, now: clock().now })
  const s = await login.start()
  assert.equal(s.status, 'success')
  assert.equal(s.account.uin, '987654321')
})

test('还没填 WebUI 地址 → 明确说，别去连空地址', async () => {
  const login = createNapCatLogin({ webuiUrl: '', webuiToken: 'x', fetchImpl: async () => ({}), now: clock().now })
  await assert.rejects(() => login.start(), /还没填 NapCat WebUI 地址/)
})
