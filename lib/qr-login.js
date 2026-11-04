/**
 * dsh-qq-whale · NapCat 扫码登录
 *
 * 跟 B 站那套（dsh-bili-whale/lib/auth.js）**流程完全一样**：
 *   start() → 拿到二维码 → 前端每 2 秒 poll() → 等待 / 已扫码 / 成功 / 过期
 * 区别只在于「问谁」：B 站问 passport.bilibili.com，这里问本机 NapCat 的 WebUI。
 *
 * NapCat WebUI 的实际协议（2026-11-04 从 NcatBot 的 setup 模块里核对过）：
 *   1. POST /api/auth/login   { hash: sha256("<webui_token>.napcat") }
 *      → { code: 0, data: { Credential } }        ← 之后所有请求带 Bearer Credential
 *   2. POST /api/QQLogin/GetQQLoginQrcode
 *      → { data: { qrcode: "https://..." } }
 *   3. POST /api/QQLogin/CheckLoginStatus
 *      → { data: { isLogin: true|false } }
 *   4. POST /api/QQLogin/GetQQLoginInfo
 *      → { data: { uin, online, ... } }
 *
 * 参考：ncatbot/adapter/napcat/setup/{auth,webui_client}.py 与 constants.py（盐是 "napcat"）
 *
 * ⚠️ 这个文件不 import 任何 DSH 的东西，也不碰 OneBot——
 *    登录是 NapCat 自己的事，插件只负责把二维码端到主人面前 ✓
 */
import { createHash, randomUUID } from 'node:crypto'

const SALT = 'napcat'
const TTL = 180_000        // 二维码 3 分钟后算过期（跟 B 站那边一致）
const POLL_GAP = 2_000     // 两次 poll 之间至少隔 2 秒
const START_GAP = 2_000

export class LoginError extends Error {
  constructor(message, { kind = 'error' } = {}) {
    super(message)
    this.name = 'LoginError'
    this.kind = kind
  }
}

/**
 * @param {object} opts
 * @param {string} opts.webuiUrl          例如 http://127.0.0.1:6099
 * @param {string} opts.webuiToken        WebUI 的 token（默认 napcat_webui）
 * @param {Function} [opts.fetchImpl]     测试注入
 * @param {Function} [opts.now]
 * @param {Function} [opts.render]        url => Promise<dataUrl>
 */
export function createNapCatLogin({
  webuiUrl,
  webuiToken = '',
  fetchImpl,
  now = () => Date.now(),
  render,
} = {}) {
  const base = String(webuiUrl ?? '').replace(/\/+$/, '')
  const doFetch = fetchImpl ?? globalThis.fetch
  let credential = null
  let session = null
  let nextStart = 0

  async function post(pathname, payload = {}, { timeoutMs = 8000, auth = true } = {}) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await doFetch(`${base}${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(auth && credential ? { authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      const code = e?.cause?.code ?? e?.message ?? e
      // ⚠️ 2026-11-04：光说「NapCat 开着吗？」不够 —— 主人连着两次撞上 EPIPE/ECONNREFUSED，
      //   因为 NapCat 不会自己起来（尤其被父进程带走 / 没设自启时）。这里把**怎么开**说出来 ✓
      if (e?.name === 'AbortError') {
        throw new LoginError(`NapCat WebUI 超时（${base}）—— 它可能在启动中，或卡住了`, { kind: 'timeout' })
      }
      const dead = code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE'
      throw new LoginError(
        dead
          ? `连不上 NapCat WebUI（${base}，${code}）—— NapCat 没在跑。` +
            `双击 C:\\NapCat\\start-napcat.bat 把它打开（首次用要先扫码登录），然后再点这里`
          : `连不上 NapCat WebUI（${base}，${code}）—— 检查地址填得对不对`,
        { kind: 'unreachable' },
      )
    }
    clearTimeout(timer)
    let body = null
    try { body = await res.json() } catch { /* 下面按状态码兜 */ }
    if (!res.ok) throw new LoginError(`NapCat WebUI 返回 HTTP ${res.status}（${pathname}）`)
    if (!body || typeof body !== 'object') throw new LoginError(`NapCat WebUI 应答不是 JSON（${pathname}）`)
    return body
  }

  /** 换 Bearer token（每次登录流程开头都要换） */
  async function authenticate() {
    const hash = createHash('sha256').update(`${webuiToken}.${SALT}`).digest('hex')
    const body = await post('/api/auth/login', { hash }, { auth: false })
    const msg = String(body.message ?? '')
    if (body.code !== 0) {
      if (/rate limit/i.test(msg)) throw new LoginError('NapCat WebUI 登录太快被限流了，等几秒再试', { kind: 'ratelimit' })
      throw new LoginError(`NapCat WebUI 认证失败（code=${body.code}）：token 对不对？`, { kind: 'auth' })
    }
    credential = body.data?.Credential ?? null
    if (!credential) throw new LoginError('NapCat WebUI 认证响应里没有 Credential', { kind: 'auth' })
    return credential
  }

  /**
   * 体检：只做「连得上 + 密码对」这一步，**不开登录会话**
   * （免得和界面上正在扫码的那个抢）
   *
   * 2026-11-04 晚加（主人：「我重启了又用不了」，界面上只有一句「出错了」）：
   * 有了它，「查一下哪里不对」才能指出是 NapCat 没开、还是密码被换了 ✓
   *
   * @returns {Promise<string>} 一句人话，说明 WebUI 现在什么状态
   */
  async function inspect() {
    if (!base) throw new LoginError('还没填 NapCat WebUI 地址')
    // 认证这一步本身就会在连不上时抛登录错误（带 kind: 'unreachable'）
    await authenticate()
    return `能连上，密码也对（${base}）`
  }

  function state() {
    if (!session) return { status: 'idle' }
    return {
      id: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      ...((session.status === 'waiting' || session.status === 'scanned') ? { image: session.image, url: session.url } : {}),
      ...(session.account ? { account: session.account } : {}),
      ...(session.error ? { error: session.error } : {}),
    }
  }

  /** 生成一张二维码。返回 { id, status, image, expiresAt } */
  async function start() {
    if (!base) throw new LoginError('还没填 NapCat WebUI 地址')
    // ⚠️ 2026-11-04 晚（主人截图：「出错了」+「请稍等两秒再生成二维码」，看不懂）：
    //   这条本来是防止连续狂点的冷却，但提示没说是**哪个原因**，
    //   和真正的错误（NapCat 没开）混在一起，看起来就像插件坏了 ✗
    //   现在把「还剩几秒」写出来，并且加 (kind: 'cooldown') 让前端能区别对待 ✓
    if (now() < nextStart) {
      const left = Math.max(1, Math.ceil((nextStart - now()) / 1000))
      throw new LoginError(
        `刚生成过一次，再等 ${left} 秒（防连点把 NapCat 刷爆）。` +
        '如果 NapCat 根本没开，点上面「查一下哪里不对」',
        { kind: 'cooldown' },
      )
    }
    nextStart = now() + START_GAP
    session = { id: randomUUID(), status: 'waiting', expiresAt: now() + TTL, nextPoll: 0 }

    await authenticate()

    // NapCat 这个接口有时候第一次不给二维码，得等一会儿再问 —— 跟 NcatBot 那边一样重试
    let qrUrl = null
    const deadline = now() + 15_000
    let lastErr = null
    while (now() < deadline) {
      try {
        const body = await post('/api/QQLogin/GetQQLoginQrcode')
        if (String(body.message ?? '').includes('QQ Is Logined')) {
          session.status = 'success'
          session.account = await readAccount().catch(() => null)
          return state()
        }
        qrUrl = body.data?.qrcode ?? null
        if (qrUrl) break
      } catch (e) {
        lastErr = e
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    if (!qrUrl) {
      session.status = 'error'
      throw lastErr instanceof LoginError ? lastErr : new LoginError('NapCat 没给二维码（15 秒）—— 它登录好了吗？')
    }

    // 只吃 http(s) 的二维码内容，防止被塞 data:/file: 之类
    let parsed
    try { parsed = new URL(qrUrl) } catch { throw new LoginError('NapCat 给的二维码内容不是 URL') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new LoginError('NapCat 给的二维码内容协议不对')
    session.url = qrUrl
    session.image = render ? await render(qrUrl) : null
    return state()
  }

  /** 问一次状态；返回 waiting / scanned / success / expired / error */
  async function poll(id) {
    if (!session || session.id !== id) throw new LoginError('登录流程已失效，请重新扫码')
    if (['success', 'expired', 'cancelled', 'error'].includes(session.status)) return state()
    if (now() >= session.expiresAt) { session.status = 'expired'; return state() }
    if (now() < session.nextPoll) return state()
    session.nextPoll = now() + POLL_GAP

    try {
      const body = await post('/api/QQLogin/CheckLoginStatus')
      const isLogin = body?.data?.isLogin === true
      if (isLogin) {
        session.account = await readAccount().catch(() => null)
        session.status = 'success'
        delete session.image
        delete session.url
      } else {
        session.status = 'waiting'
      }
    } catch (e) {
      // 一次失败不算失败：NapCat 重启的时候会短暂连不上
      session.lastError = String(e?.message ?? e)
    }
    return state()
  }

  async function readAccount() {
    const body = await post('/api/QQLogin/GetQQLoginInfo')
    const d = body?.data ?? {}
    const uin = String(d.uin ?? '')
    if (!/^\d{5,16}$/.test(uin)) return null
    return { uin, online: d.online === true, nickname: d.nickname ?? d.nick ?? '' }
  }

  /** 不用扫码也能问一句「现在登的是哪个号」—— 控制台显示「我的账号」用这个 ✓ */
  async function whoAmI() {
    await authenticate()
    return readAccount()
  }

  function cancel(id) {
    // ⚠️ 2026-11-04 晚：取消要**解除冷却** ——
    //   用户主动取消（或者会话已经结束）之后再点「重新生成」，不该被"稍等两秒"挡住。
    //   冷却只该防「连着狂点」，不该罚「取消后重来」✗（主人就是这么撞上的）
    nextStart = 0
    if (!session || (id && session.id !== id)) return { status: 'cancelled' }
    if (!['success', 'expired', 'cancelled', 'error'].includes(session.status)) session.status = 'cancelled'
    delete session.image
    delete session.url
    return state()
  }

  return { start, poll, cancel, readAccount, whoAmI, state, inspect }
}
