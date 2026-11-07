/**
 * dsh-qq-whale · 待审队列（别人发来的话，先给我过一遍，主人点头才回）
 *
 * 为什么要有这个：主人 2026-11-04 说「其他人发信息通知主人再回答」。
 * B 站那边已经有这套（tools/commands/reply-draft.mjs + pending-replies.json），
 * 这里照着做一份 —— **格式刻意保持同构**，以后想统一管理不用重写 ✓
 *
 * 规矩（跟 B 站那边一致，别自己发明）：
 *   · **主人自己发的** → 不进队，直接当私信处理 ✓
 *   · **别人发来的** → 一律进队，`status: 'pending'`
 *   · 进队的同时**报给主人**（推一条私信，告诉我「谁说了什么，我打算怎么回」）
 *   · 主人回「发」→ 真的发出去；回「不发」→ 丢掉；改一版 → 先用他改的
 *   · 同一个人的同一句话不重复进队 ✓
 *   · 队列**不自动过期**：宁可留着等主人拍板，也不能悄悄丢掉（丢了就等于我没告诉他）✗
 *
 * 这个文件不 import DSH，也不发网络请求 —— 好测 ✓
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const PENDING_FILE = 'qq-pending-replies.json'

export function createPendingStore({ dshHome } = {}) {
  if (!dshHome) throw new Error('createPendingStore 需要 dshHome')
  const file = path.join(dshHome, 'whale-channels', PENDING_FILE)

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { version: 1, items: Array.isArray(j.items) ? j.items : [] }
    } catch {
      return { version: 1, items: [] }
    }
  }

  function save(db) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)   // 先写临时文件再改名：写到一半断电不会留半截 ✗
  }

  /**
   * 一条别人的消息进队。
   * @returns {{ ok: true, item, duplicate?: false } | { ok: true, duplicate: true, item }}
   */
  function add({
    userId, messageId, nickname, text, draft,
    at = new Date().toISOString(),
    // ⚠️ 2026-11-07 群聊：别人在群里 @ 我，也走这条队。
    //   跟私信的区别只有一个 —— **回的时候要回到哪个群**。
    //   所以多存两个字段（groupId / groupName），私信那条老路完全不变 ✓
    kind = 'private',
    groupId = null,
    groupName = '',
    context = [],
  }) {
    if (!userId) throw new Error('进待审队列要有 userId')
    const db = load()
    const src = String(text ?? '').trim()
    // 群消息可以只有图（没文字），所以群聊允许空正文，私信不行
    if (!src && kind !== 'group') throw new Error('空消息不该进队列')
    // 同一句话（同一个人 + 同一条 messageId）不重复排队 ✓
    //   群聊要带上群号：同一个人的 messageId 在不同群里是两回事
    const key = kind === 'group'
      ? `g:${groupId}:${userId}:${messageId ?? src}`
      : `${userId}:${messageId ?? src}`
    const dup = db.items.find((x) => x.key === key)
    if (dup) return { ok: true, duplicate: true, item: dup }
    const item = {
      id: randomBytes(4).toString('hex'),
      at,
      key,
      kind: kind === 'group' ? 'group' : 'private',
      ...(kind === 'group' ? {
        groupId: String(groupId ?? ''),
        groupName: String(groupName ?? '').slice(0, 60),
        // 他审的时候得知道他们在聊什么 —— 只给一句「你怎么看」没法判
        context: (Array.isArray(context) ? context : []).slice(-5).map((x) => String(x).slice(0, 200)),
      } : {}),
      userId: String(userId),
      messageId: messageId ?? null,
      who: String(nickname ?? '').slice(0, 60) || String(userId),
      src: src.slice(0, 500),
      draft: String(draft ?? '').slice(0, 500),
      status: 'pending',
    }
    db.items.push(item)
    save(db)
    return { ok: true, duplicate: false, item }
  }

  function list({ status = 'pending' } = {}) {
    const db = load()
    return status ? db.items.filter((x) => (x.status ?? 'pending') === status) : db.items
  }

  /** 只读地看一条（不删） */
  function get(id) {
    return load().items.find((x) => x.id === id) ?? null
  }

  /** 取出并从队列删掉 —— 只有「真的发出去之后」才该调它 ✓ */
  function take(id) {
    const db = load()
    const hit = db.items.find((x) => x.id === id)
    if (!hit) return null
    db.items = db.items.filter((x) => x.id !== id)
    save(db)
    return hit
  }

  /** 不同意/不回了 → 标记掉，保留记录（以后能翻「我拒过什么」） */
  function drop(id, { reason = '' } = {}) {
    const db = load()
    const hit = db.items.find((x) => x.id === id)
    if (!hit) return null
    hit.status = 'dropped'
    hit.droppedAt = new Date().toISOString()
    hit.dropReason = String(reason).slice(0, 200)
    save(db)
    return hit
  }

  /** 主人改了一版 → 更新草稿，但仍要等他点头 */
  function revise(id, draft) {
    const db = load()
    const hit = db.items.find((x) => x.id === id)
    if (!hit) return null
    hit.draft = String(draft ?? '').slice(0, 500)
    hit.revisedAt = new Date().toISOString()
    save(db)
    return hit
  }

  /** 报给主人时用的一段话（跟 B 站那边同一个腔调） */
  function summaryFor(item) {
    if (item?.kind === 'group') {
      const gname = item.groupName ? `${item.groupName}（${item.groupId}）` : String(item.groupId ?? '')
      return [
        `【群里有人 @ 我，等你点头才回】群：${gname}`,
        ...(Array.isArray(item.context) && item.context.length
          ? ['前面他们说的：', ...item.context.map((x) => `  ${x}`)]
          : []),
        `${item.who} 说：${item.src || '（只有图）'}`,
        item.draft ? `我打算回：${item.draft}` : '（还没想好怎么回，你说了算）',
        '回我「发」就发到那个群 ✓ 回「不发」就撤掉 ✓（也可以直接给我改一版）',
      ].join('\n')
    }
    return [
      `【等你审核 1 条 QQ 回复】→ ${item.who}`,
      `他说：${item.src}`,
      item.draft ? `我打算回：${item.draft}` : '（还没想好怎么回，你说了算）',
      '回我「发」就发 ✓ 回「不发」就撤掉 ✓（也可以直接给我改一版）',
    ].join('\n')
  }

  return { file, load, add, list, get, take, drop, revise, summaryFor }
}

/**
 * 判断一句话该不该自动回：
 *   · 主人自己说的 → 直接回 ✓
 *   · 别人说的 → 进队等审核 ✓
 * 这里只做判断，不做动作。
 */
export function shouldAutoReply({ fromUserId, ownerId } = {}) {
  const from = String(fromUserId ?? '')
  const owner = String(ownerId ?? '')
  if (!owner) return { auto: false, reason: 'no-owner' }
  return from === owner ? { auto: true, reason: 'owner' } : { auto: false, reason: 'other' }
}
