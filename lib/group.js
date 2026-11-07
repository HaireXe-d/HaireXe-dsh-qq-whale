/**
 * dsh-qq-whale · 群聊（2026-11-07）
 *
 * 主人的原话：
 *   「把你拉进群聊，主人 @ 你就回答主人，别人 @ 你就先问主人再回」
 *
 * 所以这个文件只管**认**，不管发：
 *   · 哪天群在不在管（`groups[].enabled`）
 *   · 谁 @ 我了、@ 的是不是主人、要不要带上前面几句当上下文
 *   · 别人找我 → 走待审队列（跟私信那条路一样的规矩，主人点头才回）
 *
 * ⚠️ 为什么单独一个文件：
 *   poller.js 现在只认私信（`message_type === 'private'`），群消息根本没进来过。
 *   群聊一进来，最怕的是**每个群都要一份状态**，全塞进 poller 会越来越乱 ✗
 *   所以拆开：poller 负责「拉历史」，这里负责「这堆历史里哪条是给我的」✓
 *
 * 这个文件不 import DSH，也不发网络请求 —— 好测 ✓
 */

export const GROUP_DEFAULTS = {
  // listen: 要不要听群消息（总开关）
  // 空 groups：没配群就不听任何群 —— **不默认监听所有群** ✗
  //   她进的群不止主人一个，默认全听等于把她扔进一堆没同意过的场合里
  listen: false,
  groups: [],          // [{ id, name, enabled }]
  // ⚠️ 2026-11-07 主人补的：「群聊只有我能邀请你，你不能乱进」
  //   → 群名单**只认主人加进来的**。没经过主人点头的群，就算她人在里面也不听 ✗
  //   （`invitedBy` 记是谁放进去的；不是主人的一律不认，连带 [群:xxx] 那个回话标记也不认）
  ownerOnly: true,
  needAt: true,        // true = 只有 @ 我 才理；false = 群里说话就理（太吵，默认关）
  askWhenOthers: true, // 别人 @ 我 → 先问主人（他 2026-11-07 定的）
  quoteContext: 3,     // 别人 @ 我的时候，带上前几句（帮他判断该不该回）
  maxPerPoll: 6,       // 一次轮询最多处理几条群消息（别一开就刷屏）
  replyToGroup: true,  // 回在群里（false = 只私信告诉主人，不去群里说）
}

/**
 * 「这个群是谁放进名单的」—— 只认主人（2026-11-07）
 *
 * 为什么要记得这么细：
 *   主人说「群聊只有我能邀请你，你不能乱进」。
 *   那么判断标准就不能只是「配置里有这个群号」——
 *   得能说出**谁放的**。配置里没记来源的老数据，按主人自己配的处理（备份里就是主人配的）。
 *
 * @returns {boolean} 这个群能不能算「主人真的把我请进来的」
 */
export function groupInvitedByOwner(g, entry) {
  if (!entry) return false
  if (g?.ownerOnly === false) return true          // 主人自己关掉这条限制
  if (!entry.invitedBy) return true                 // 老配置：主人自己填的
  return String(entry.invitedBy) === 'owner'
}

/** 配置没写全时，按默认值补（配置里可能只有一半） */
export function normalizeGroupOpts(g = {}) {
  const o = { ...GROUP_DEFAULTS, ...(g ?? {}) }
  o.groups = (Array.isArray(o.groups) ? o.groups : [])
    .map((x) => ({
      id: String(x?.id ?? '').trim(),
      name: String(x?.name ?? '').trim(),
      enabled: x?.enabled !== false,
      // 谁放进来的：'owner' = 主人（唯一认的）；别的一律不算
      invitedBy: String(x?.invitedBy ?? '').trim(),
      at: String(x?.at ?? '').trim(),
    }))
    .filter((x) => /^\d{5,16}$/.test(x.id))
  o.quoteContext = Math.max(0, Math.min(10, Number(o.quoteContext) || 0))
  o.maxPerPoll = Math.max(1, Math.min(30, Number(o.maxPerPoll) || 6))
  return o
}

/**
 * 这个群该不该听
 *
 * ⚠️ 2026-11-07：光「在名单里」不算 —— 还得是**主人放进去的**。
 *   主人原话：「群聊只有我能邀请你，你不能乱进」。
 *   要是哪条路把群号写进了名单（别的程序、我自己的工具、手滑），
 *   `ownerOnly` 开着就不认 ✗
 */
export function groupAllowed(g, groupId) {
  const id = String(groupId ?? '').trim()
  if (!id) return false
  const entry = g.groups.find((x) => x.id === id && x.enabled)
  if (!entry) return false
  return groupInvitedByOwner(g, entry)
}

/**
 * 某条群消息里有没有 @ 某人。
 *
 * 为什么要看 `message` 数组而不是 `raw_message` 里的 CQ 码：
 *   ① 数组里是 `{ type:'at', data:{ qq } }`，qq 是数字还是字符串要看实现，统一转字符串
 *   ② **@全体成员** 的 qq 是 `'all'` —— 那不是指我，不能当成「有人喊她」✗
 *      （不然群里随便一个 @全体 就把她叫出来了）
 */
export function atTargets(m) {
  const segs = Array.isArray(m?.message) ? m.message : null
  if (segs) {
    return segs
      .filter((s) => s?.type === 'at')
      .map((s) => String(s.data?.qq ?? '').trim())
      .filter((q) => q && q !== 'all')
  }
  // 有些实现只给 raw_message：退化到 CQ 码里抠
  const raw = String(m?.raw_message ?? '')
  const out = []
  for (const mm of raw.matchAll(/\[CQ:at,qq=([^,\]]+)/g)) {
    const q = String(mm[1] ?? '').trim()
    if (q && q !== 'all') out.push(q)
  }
  return out
}

/**
 * 把一条群消息判成「给我看的」还是「不关我事」。
 *
 * @param {object} m    OneBot 群消息原始对象
 * @param {object} p
 * @param {string} p.selfId    我自己
 * @param {string} p.ownerId   主人
 * @param {object} p.opts      normalizeGroupOpts() 的结果
 * @param {boolean} [p.selfMentionFallback] 实现不给 at 段时，正文里有「@我昵称」也算
 * @param {string} [p.selfNickname]
 * @returns {{ hit: boolean, reason: string, kind?: 'owner'|'other', groupId?: string, userId?: string }}
 */
export function classifyGroupMessage(m, { selfId = '', ownerId = '', opts = GROUP_DEFAULTS, selfNickname = '' } = {}) {
  const me = String(selfId ?? '')
  if (!me) return { hit: false, reason: '不知道我是哪个号（self.uin 没填）' }
  // ⚠️ 只认群消息：私信混进来不算（2026-11-07 写测试时抓到的 ——
  //   私信没有 group_id，会一路走到末尾被当成「另一个群也没有群号」，最后落到别的群头上 ✗）
  if (m?.message_type && m.message_type !== 'group') return { hit: false, reason: '不是群消息' }
  if (m?.post_type === 'message_sent' || m?.message_sent_type) return { hit: false, reason: '我自己发的' }
  if (String(m?.sender?.user_id ?? '') === me) return { hit: false, reason: '我自己发的' }

  const groupId = String(m?.group_id ?? m?.group?.group_id ?? '').trim()
  if (!groupId) return { hit: false, reason: '没有群号' }
  if (!groupAllowed(opts, groupId)) {
    // 两种原因分开说：没配 / 配了但不是主人放的
    const entry = (opts?.groups ?? []).find((x) => x.id === groupId)
    if (entry && !groupInvitedByOwner(opts, entry)) {
      return { hit: false, reason: '这个群不是主人邀请她进的 → 不理' }
    }
    return { hit: false, reason: '这个群没在名单里（或关掉了）' }
  }

  const userId = String(m?.sender?.user_id ?? '')
  if (userId === me) return { hit: false, reason: '我自己发的' }

  const ats = atTargets(m)
  const text = messagePlainText(m)
  const atMentioned = ats.includes(me)
    || (opts.selfMentionFallback !== false && selfNickname && text.includes(`@${selfNickname}`))

  const needAt = opts.needAt !== false
  if (!atMentioned) {
    // 别人 @ 的是主人，不是她 → 不关她事
    if (ats.includes(String(ownerId ?? ''))) return { hit: false, reason: '别人 @ 的是主人' }
    if (needAt) return { hit: false, reason: '没 @ 我' }
  }

  // 到这儿就是「喊我了」 → 看是谁喊的
  const kind = userId === String(ownerId ?? '') ? 'owner' : 'other'
  return { hit: true, reason: kind === 'owner' ? '主人 @ 我' : '别人 @ 我', kind, groupId, userId }
}

/** 群消息的纯文本（去掉 CQ 码、去掉 @ 标记，只留人话） */
export function messagePlainText(m) {
  const segs = Array.isArray(m?.message) ? m.message : null
  if (segs) {
    return segs
      .filter((s) => s?.type === 'text')
      .map((s) => s.data?.text ?? '')
      .join('')
      .replace(/^[\s@]+/, '')
      .trim()
  }
  return String(m?.raw_message ?? '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/^[\s@]+/, '')
    .trim()
}

/**
 * 把一批群历史拆成「给我的」和「顺手当上下文的前几句」。
 *
 * 群聊跟私信不一样的地方：私信里每一条都是给我的，群里**大部分不是**。
 * 所以这里两件事一起做：
 *   ① 遍历整页，把命中的挑出来（按发生顺序）
 *   ② 每条命中，回头带上前 quoteContext 句别人说的话 ——
 *      主人审的时候才知道「他们在聊什么」，不然只看到一句「你怎么看」没法判 ✓
 *
 * @returns {{ items: Array<{ raw, groupId, userId, nickname, text, kind, context, at, messageId }>, stats: object }}
 */
export function pickGroupMessages(rawList, { selfId = '', ownerId = '', opts = GROUP_DEFAULTS, selfNickname = '', seen = null } = {}) {
  const list = Array.isArray(rawList) ? rawList : (rawList?.messages ?? rawList?.message_list ?? [])
  if (!Array.isArray(list)) return { items: [], stats: { total: 0, hit: 0, skipped: 0 } }

  const items = []
  let skipped = 0
  list.forEach((m, i) => {
    const v = classifyGroupMessage(m, { selfId, ownerId, opts, selfNickname })
    if (!v.hit) { skipped += 1; return }
    const messageId = m?.message_id ?? m?.real_id ?? null
    const key = `${v.groupId}:${v.userId}:${messageId ?? messagePlainText(m)}`
    if (seen && seen.has(key)) return
    // 前面几句（只取同一个群里的，且不越过整页开头）
    const ctx = []
    for (let j = Math.max(0, i - (opts.quoteContext ?? 0)); j < i; j += 1) {
      const p = list[j]
      const g = String(p?.group_id ?? p?.group?.group_id ?? '')
      if (g !== v.groupId) continue
      const who = String(p?.sender?.card || p?.sender?.nickname || p?.sender?.user_id || '')
      const t = messagePlainText(p)
      const imgs = Array.isArray(p?.message) && p.message.some((s) => s?.type === 'image')
      if (!t && !imgs) continue
      ctx.push(`${who}：${t || '[图]'}`)
    }
    items.push({
      key,
      raw: m,
      messageId,
      groupId: v.groupId,
      groupName: String(m?.group_name ?? m?.group?.group_name ?? ''),
      userId: v.userId,
      nickname: String(m?.sender?.card || m?.sender?.nickname || v.userId),
      text: messagePlainText(m),
      kind: v.kind,
      context: ctx,
      at: Number(m?.time ?? 0) * 1000 || Date.now(),
    })
  })
  return { items, stats: { total: list.length, hit: items.length, skipped } }
}

/** 回话文件里怎么写「这条发到哪个群」：行首 `[群:123456789] 正文` */
export const GROUP_TAG_RE = /^\[群[:：]\s*(\d{5,16})\]\s*([\s\S]*)$/

/**
 * 把回话文件的一整行拆成 `{ groupId, line }`。
 * 没写标记 → groupId 为 null（走私信，照旧）✓
 * 这样回话文件还是一条一行，只是行首多一个标记 —— **不改文件格式**，
 * 老的习惯、老的发送器都不用动 ✓
 *
 * ⚠️ 2026-11-07：这里只管「认得出标记」，**不发出去**。
 *   「这个群能不能发」要另外过 `groupAllowed()`（主人只让我进他邀请的群）。
 *   两件事分开：认标记是纯文本活，准不准发要看名单 ✓
 */
export function splitGroupTag(line) {
  const raw = String(line ?? '')
  const m = GROUP_TAG_RE.exec(raw.trim())
  if (!m) return { groupId: null, line: raw }
  return { groupId: m[1], line: m[2] ?? '' }
}

/**
 * 她这条回话能不能发到那个群（2026-11-07，主人：「群聊只有我能邀请你，你不能乱进」）
 *
 * 三道闸，一道都不能少：
 *   ① 这个群在名单里，而且**是主人放进来的**（`groupAllowed`）
 *   ② 总开关 `listen` 开着（关了就是「她不管群消息」，那也别在群里说话）
 *   ③ 这个群自己没被单独关掉（`enabled: false`）
 *
 * @returns {{ ok: boolean, reason: string }}
 */
export function canReplyToGroup(g, groupId) {
  const id = String(groupId ?? '').trim()
  if (!id) return { ok: false, reason: '没有群号' }
  if (g?.listen === false) return { ok: false, reason: '群聊总开关是关的（group.listen = false）' }
  const entry = (g?.groups ?? []).find((x) => x.id === id)
  if (!entry) return { ok: false, reason: `群 ${id} 不在名单里 —— 只有主人邀请她进的群才回` }
  if (entry.enabled === false) return { ok: false, reason: `群 ${id} 被单独关掉了` }
  if (!groupInvitedByOwner(g, entry)) return { ok: false, reason: `群 ${id} 不是主人邀请她进的 → 不回` }
  return { ok: true, reason: 'ok' }
}
