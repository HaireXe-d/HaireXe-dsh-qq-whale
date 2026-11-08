/**
 * dsh-qq-whale · OneBot 11 客户端
 *
 * 为什么是 OneBot 11：NapCat / LLOneBot 这些工具都实现了它，
 * 插件只要跟 `http://127.0.0.1:<port>` 说话，**不碰 QQ 客户端本身** ✓
 * 换成别的实现（Lagrange 之类）也不用改这里。
 *
 * 这个文件只做 HTTP；轮询、重连、额度这些在 poller.js。
 * 不 import 任何 DSH 的东西 —— 这样 `node tools/qq.mjs` 能单独跑，能测 ✓
 */

export class OneBotError extends Error {
  constructor(message, { code = null, status = null, body = null } = {}) {
    super(message)
    this.name = 'OneBotError'
    this.code = code
    this.status = status
    this.body = body
  }
}

function trimSlash(u) { return String(u ?? '').replace(/\/+$/, '') }

/**
 * @param {object} opts
 * @param {string} opts.baseUrl   例如 http://127.0.0.1:3000
 * @param {string} [opts.token]   OneBot 的 access_token（填了就带 Authorization: Bearer）
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl]  测试里注入假 fetch
 */
export function createOneBot({ baseUrl, token = '', timeoutMs = 10_000, fetchImpl } = {}) {
  if (!baseUrl) throw new OneBotError('没有配置 OneBot 地址（默认 http://127.0.0.1:3000）')
  const base = trimSlash(baseUrl)
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new OneBotError('这个运行环境没有 fetch')

  async function call(action, params = {}) {
    const url = `${base}/${action}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params ?? {}),
        signal: ctrl.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      if (e?.name === 'AbortError') throw new OneBotError(`OneBot 超时（${timeoutMs}ms）：${action}`)
      throw new OneBotError(`连不上 OneBot：${e?.cause?.code ?? e?.message ?? e}（地址 ${base}，客户端开了吗？）`)
    }
    clearTimeout(timer)

    let body = null
    try { body = await res.json() } catch { /* 不是 json，下面按状态码报 */ }
    if (!res.ok) {
      throw new OneBotError(`OneBot 返回 HTTP ${res.status}：${action}`, { status: res.status, body })
    }
    // OneBot 11 的标准应答：{ status: 'ok' | 'failed', retcode: 0, data: ... }
    if (!body || typeof body !== 'object') {
      throw new OneBotError(`OneBot 应答不是 JSON 对象：${action}`, { status: res.status })
    }
    if (body.status === 'failed' || (body.retcode !== undefined && body.retcode !== 0)) {
      throw new OneBotError(`OneBot 拒绝了 ${action}：retcode=${body.retcode ?? '?'} ${body.wording ?? body.message ?? ''}`.trim(), {
        code: body.retcode ?? null, body,
      })
    }
    return body.data ?? null
  }

  /** 发私信。注意：message 用字符串（CQ 码可以写在里头），不要自己拼数组 */
  function sendPrivate(userId, message, { autoEscape = false } = {}) {
    return call('send_private_msg', { user_id: normalizeId(userId), message: String(message ?? ''), auto_escape: autoEscape })
  }

  /** 发群消息 */
  function sendGroup(groupId, message, { autoEscape = false } = {}) {
    return call('send_group_msg', { group_id: normalizeId(groupId), message: String(message ?? ''), auto_escape: autoEscape })
  }

  /** 戳一戳（私聊传 user_id，群聊传 group_id + user_id） */
  function sendPoke(userId, { groupId = null } = {}) {
    return call('send_poke', groupId
      ? { group_id: normalizeId(groupId), user_id: normalizeId(userId) }
      : { user_id: normalizeId(userId) })
  }

  function getLoginInfo() { return call('get_login_info') }
  function getStatus() { return call('get_status') }

  /** 拉私信历史：OneBot 11 的 get_friend_msg_history（部分实现才有） */
  function getPrivateHistory(userId, { count = 20, messageSeq = undefined } = {}) {
    return call('get_friend_msg_history', { user_id: normalizeId(userId), count, ...(messageSeq ? { message_seq: messageSeq } : {}) })
  }

  /**
   * 拉群历史：get_group_msg_history。
   *
   * ⚠️ 2026-11-07：跟私信那个不是同一个 action，参数名也不一样（`group_id` 不是 `user_id`）。
   *   这个接口**不是 OneBot 11 标准的一部分**，是 NapCat 等实现的扩展 ——
   *   拿不到的时候不要当成"没有新消息"，要区分「空」和「不支持」（见 poller 那边）✓
   */
  function getGroupHistory(groupId, { count = 20 } = {}) {
    return call('get_group_msg_history', { group_id: normalizeId(groupId), count })
  }

  /**
   * 我加了哪些群（NapCat 扩展）。
   * 主人要「把你拉进群聊」—— 光有群号不够，控制台里得能**挑群**，
   * 所以先把这个列表拉出来给他选 ✓
   */
  function getGroupList() {
    return call('get_group_list')
  }

  /**
   * 我的好友列表。
   *
   * ⚠️ 2026-11-07 晚（线上反馈「发消息收不到」）：
   *   poller 原来只拉**主人一个人**的私信历史，
   *   别人给机器人发私信永远收不到 ✗
   *   现在要轮着拉几个好友的，所以需要这个列表 ✓
   */
  function getFriendList() {
    return call('get_friend_list')
  }

  /** 群里戳一戳：group_id + user_id （私聊那个是另一套参数） */
  function sendGroupPoke(groupId, userId) {
    return call('send_poke', { group_id: normalizeId(groupId), user_id: normalizeId(userId) })
  }

  return {
    baseUrl: base, call, sendPrivate, sendGroup, sendPoke, sendGroupPoke,
    getLoginInfo, getStatus, getPrivateHistory, getGroupHistory, getGroupList, getFriendList,
  }
}

/** QQ 号在 JSON 里有的实现给字符串、有的给数字 —— 统一成字符串，避免 0 开头的号被吃掉 */
export function normalizeId(v) {
  const s = String(v ?? '').trim()
  // QQ 号 5–13 位；放到 16 位是因为测试和日志里可能拿主人的 mid（16 位）当样例，
  //   在校验这一层一刀切掉只会制造假故障（2026-11-04 就这么踩了一次 ✗）
  if (!/^\d{5,16}$/.test(s)) throw new OneBotError(`QQ/群号不合法：${JSON.stringify(v)}`)
  return s
}

/**
 * 从 OneBot 事件里抽出「这是主人说的什么话」。
 * 只认私信；群消息、自己发的、撤回、系统提示都不算 ✓
 *
 * @returns {{ kind: 'private', userId, nickname, text, messageId, time } | null}
 */
export function readIncoming(event) {
  if (!event || typeof event !== 'object') return null
  if (event.post_type !== 'message') return null
  if (event.message_type !== 'private') return null
  const text = messageText(event)
  if (!text) return null
  return {
    kind: 'private',
    userId: String(event.user_id ?? ''),
    nickname: event.sender?.nickname ?? '',
    text,
    messageId: event.message_id ?? null,
    time: Number(event.time ?? 0) * 1000 || Date.now(),
  }
}

/** OneBot 11 的 message 既可能是字符串（含 CQ 码）也可能是数组 —— 统一取纯文本 */
export function messageText(event) {
  const m = event?.message ?? event?.raw_message ?? ''
  if (typeof m === 'string') return stripCQ(m)
  if (Array.isArray(m)) {
    return m.filter((seg) => seg?.type === 'text').map((seg) => seg.data?.text ?? '').join('').trim()
  }
  return ''
}

/** 把 CQ 码去掉，只留人话 */
export function stripCQ(s) {
  return String(s ?? '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .trim()
}
