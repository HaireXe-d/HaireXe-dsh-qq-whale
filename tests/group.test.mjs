import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGroupOpts, groupAllowed, atTargets, classifyGroupMessage,
  messagePlainText, pickGroupMessages, splitGroupTag, GROUP_DEFAULTS,
  canReplyToGroup, groupInvitedByOwner,
} from '../lib/group.js'
import { createGroupPoller } from '../lib/poller.js'

const ME = '10001'
const OWNER = '20002'
const G1 = '123456789'
const G2 = '987654321'

const opts = (over = {}) => normalizeGroupOpts({
  listen: true,
  groups: [{ id: G1, name: '宿舍群' }, { id: G2, name: '同事群' }],
  ...over,
})

/** 造一条群消息 */
function gm({ id = 1, from = OWNER, nick = '主人', text = '在吗', group = G1, at = [], images = false, time = 1794000000 } = {}) {
  const message = []
  for (const q of at) message.push({ type: 'at', data: { qq: q } })
  message.push({ type: 'text', data: { text } })
  if (images) message.push({ type: 'image', data: { url: 'http://x/y.jpg' } })
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: group,
    message_id: id,
    time,
    sender: { user_id: from, nickname: nick, card: nick },
    message,
  }
}

// ── 配置 ────────────────────────────────────────────────────────────────

test('群配置默认是关的、名单是空的（不默认监听所有群）', () => {
  const g = normalizeGroupOpts({})
  assert.equal(g.listen, false)
  assert.deepEqual(g.groups, [])
  assert.equal(g.needAt, true)
  assert.equal(g.askWhenOthers, true)
  assert.equal(GROUP_DEFAULTS.listen, false)
})

test('群号不合法的条目直接剔掉', () => {
  const g = normalizeGroupOpts({ groups: [{ id: 'abc' }, { id: '123' }, { id: G1 }] })
  assert.deepEqual(g.groups.map((x) => x.id), [G1])
})

test('关掉的群不算在名单里', () => {
  const g = normalizeGroupOpts({ groups: [{ id: G1, enabled: false }, { id: G2 }] })
  assert.equal(groupAllowed(g, G1), false)
  assert.equal(groupAllowed(g, G2), true)
  assert.equal(groupAllowed(g, '111111113'), false)
})

// ── @ 判定 ──────────────────────────────────────────────────────────────

test('@ 段：数字和字符串都认，@全体 不算', () => {
  assert.deepEqual(atTargets({ message: [{ type: 'at', data: { qq: ME } }] }), [ME])
  assert.deepEqual(atTargets({ message: [{ type: 'at', data: { qq: Number(ME) } }] }), [ME])
  assert.deepEqual(atTargets({ message: [{ type: 'at', data: { qq: 'all' } }] }), [])
  // 只给 raw_message 的实现
  assert.deepEqual(atTargets({ raw_message: `[CQ:at,qq=${ME}] 在吗` }), [ME])
  assert.deepEqual(atTargets({ raw_message: '[CQ:at,qq=all] 各位' }), [])
})

test('群消息正文去掉 @ 标记，只留人话', () => {
  assert.equal(messagePlainText(gm({ text: ' 你看看' })), '你看看')
  assert.equal(messagePlainText({ raw_message: `[CQ:at,qq=${ME}] 出来` }), '出来')
})

// ── 分拣（这是主人定的那条规矩）────────────────────────────────────────

test('主人 @ 我 → owner，直接回', () => {
  const v = classifyGroupMessage(gm({ at: [ME] }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, true)
  assert.equal(v.kind, 'owner')
})

test('别人 @ 我 → other，要走待审', () => {
  const v = classifyGroupMessage(gm({ from: '111', nick: '室友', at: [ME] }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, true)
  assert.equal(v.kind, 'other')
})

test('没 @ 我 → 不理（needAt = true）', () => {
  const v = classifyGroupMessage(gm({ from: '111', text: '今天谁洗碗' }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, false)
  assert.match(v.reason, /没 @ 我/)
})

test('别人 @ 的是主人，不是我 → 不理', () => {
  const v = classifyGroupMessage(gm({ from: '111', at: [OWNER] }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, false)
  assert.match(v.reason, /@ 的是主人/)
})

test('@全体成员 不把我叫出来', () => {
  const v = classifyGroupMessage(gm({ from: '111', text: '全体注意' , at: ['all'] }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, false)
})

test('名单外的群一律不理', () => {
  const v = classifyGroupMessage(gm({ group: '555555555', at: [ME] }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, false)
  assert.match(v.reason, /没在名单里/)
})

test('我自己在群里说的话不算来信（2026-11-04 刷屏那个坑的群版）', () => {
  const v1 = classifyGroupMessage(gm({ from: ME, at: [ME] }), { selfId: ME, ownerId: OWNER, opts: opts() })
  assert.equal(v1.hit, false)
  const m = gm({ from: OWNER, at: [ME] })
  m.post_type = 'message_sent'
  assert.equal(classifyGroupMessage(m, { selfId: ME, ownerId: OWNER, opts: opts() }).hit, false)
})

test('不知道自己是哪个号时，什么都不认（宁可不理也别乱认）', () => {
  const v = classifyGroupMessage(gm({ at: [ME] }), { selfId: '', ownerId: OWNER, opts: opts() })
  assert.equal(v.hit, false)
})

test('needAt 关掉 → 群里说话就理', () => {
  const v = classifyGroupMessage(gm({ from: '111', text: '随便说说' }), { selfId: ME, ownerId: OWNER, opts: opts({ needAt: false }) })
  assert.equal(v.hit, true)
  assert.equal(v.kind, 'other')
})

// ── 带上下文 ────────────────────────────────────────────────────────────

test('带前几句：@ 我的时候把前面他们聊的也带上', () => {
  const list = [
    gm({ id: 1, from: '111', nick: '阿甲', text: '今晚吃啥' }),
    gm({ id: 2, from: '222', nick: '阿乙', text: '火锅吧' }),
    gm({ id: 3, from: '111', nick: '阿甲', text: '你觉得呢', at: [ME] }),
  ]
  const { items } = pickGroupMessages(list, { selfId: ME, ownerId: OWNER, opts: opts({ quoteContext: 3 }) })
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].context, ['阿甲：今晚吃啥', '阿乙：火锅吧'])
  assert.equal(items[0].text, '你觉得呢')
})

test('只带同一个群里的上下文（别群的别混进来）', () => {
  const list = [
    gm({ id: 1, group: G2, from: '111', nick: '别的群的人', text: '这个不该出现' }),
    gm({ id: 2, group: G1, from: '222', nick: '阿乙', text: '本群的' }),
    gm({ id: 3, group: G1, from: '111', nick: '阿甲', text: '你呢', at: [ME] }),
  ]
  const { items } = pickGroupMessages(list, { selfId: ME, ownerId: OWNER, opts: opts({ quoteContext: 3 }) })
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].context, ['阿乙：本群的'])
})

test('quoteContext = 0 就不带', () => {
  const list = [
    gm({ id: 1, from: '111', nick: '阿甲', text: '前一句' }),
    gm({ id: 2, from: '111', nick: '阿甲', text: '你呢', at: [ME] }),
  ]
  const { items } = pickGroupMessages(list, { selfId: ME, ownerId: OWNER, opts: opts({ quoteContext: 0 }) })
  assert.deepEqual(items[0].context, [])
})

// ── 回话标记 ────────────────────────────────────────────────────────────

test('回话行首的 [群:xxx] 能认出来；没有就是私信', () => {
  assert.deepEqual(splitGroupTag(`[群:${G1}] 好啊`), { groupId: G1, line: '好啊' })
  assert.deepEqual(splitGroupTag(`[群：${G1}] 好啊`), { groupId: G1, line: '好啊' })   // 中文冒号也认
  assert.deepEqual(splitGroupTag('好啊'), { groupId: null, line: '好啊' })
  assert.deepEqual(splitGroupTag('[群:123]'), { groupId: null, line: '[群:123]' })   // 3 位不是群号，原样当文字
})

test('标记只认行首，句中的 [群:xxx] 不动它', () => {
  const r = splitGroupTag('他说[群:123]这个')
  assert.equal(r.groupId, null)
  assert.equal(r.line, '他说[群:123]这个')
})

// ── 轮询 ────────────────────────────────────────────────────────────────

test('群轮询：没配群就一次都不问', async () => {
  let calls = 0
  const ob = { getGroupHistory: async () => { calls += 1; return { messages: [] } } }
  const p = createGroupPoller({ ob, groups: [], selfId: ME, ownerId: OWNER, opts: opts({ groups: [] }) })
  const r = await p.pollOnce()
  assert.equal(calls, 0)
  assert.deepEqual(r.fresh, [])
})

test('群轮询：多个群轮着问，一次问一个', async () => {
  const asked = []
  const ob = { getGroupHistory: async (id) => { asked.push(id); return { messages: [] } } }
  const p = createGroupPoller({ ob, groups: opts().groups, selfId: ME, ownerId: OWNER, opts: opts() })
  await p.pollOnce(); await p.pollOnce(); await p.pollOnce()
  assert.deepEqual(asked, [G1, G2, G1])
})

test('群轮询：同一条 @ 只交一次，第二轮不再报', async () => {
  const ob = { getGroupHistory: async () => ({ messages: [gm({ id: 7, at: [ME] })] }) }
  const seen = { keys: [] }
  const p1 = createGroupPoller({ ob, groups: [{ id: G1 }], selfId: ME, ownerId: OWNER, opts: opts(), seen })
  const r1 = await p1.pollOnce()
  assert.equal(r1.fresh.length, 1)
  // 用同一份 seen 再建一个（模拟下一轮）→ 不该再报
  const p2 = createGroupPoller({ ob, groups: [{ id: G1 }], selfId: ME, ownerId: OWNER, opts: opts(), seen })
  const r2 = await p2.pollOnce()
  assert.equal(r2.fresh.length, 0)
})

test('群轮询：接口不支持（retcode 1404）要标出来，不是当成空', async () => {
  const ob = { getGroupHistory: async () => { throw new Error('OneBot 拒绝了 get_group_msg_history：retcode=1404 不支持的 Api') } }
  const p = createGroupPoller({ ob, groups: [{ id: G1 }], selfId: ME, ownerId: OWNER, opts: opts() })
  const r = await p.pollOnce()
  assert.equal(r.ok, false)
  assert.equal(r.unsupported, true)
})


// ── 主人 2026-11-07：「群聊只有我能邀请你，你不能乱进」──────────────────

test('名单里的群如果不是主人邀请的 → 她不理', () => {
  const g = normalizeGroupOpts({
    listen: true,
    groups: [{ id: G1, invitedBy: 'owner' }, { id: G2, invitedBy: 'someone-else' }],
  })
  assert.equal(groupAllowed(g, G1), true)
  assert.equal(groupAllowed(g, G2), false)
  // 老配置没记来源 → 当主人自己配的处理（备份里就是他配的）
  const legacy = normalizeGroupOpts({ listen: true, groups: [{ id: G1 }] })
  assert.equal(groupAllowed(legacy, G1), true)
})

test('ownerOnly 关掉 = 只要在名单里就认（保险解除）', () => {
  const g = normalizeGroupOpts({
    listen: true, ownerOnly: false,
    groups: [{ id: G2, invitedBy: 'someone-else' }],
  })
  assert.equal(groupAllowed(g, G2), true)
})

test('别人 @ 我，但那个群不是主人邀请的 → 不理（带上准确原因）', () => {
  const g = normalizeGroupOpts({ listen: true, groups: [{ id: G2, invitedBy: 'someone-else' }] })
  const v = classifyGroupMessage(gm({ group: G2, from: '111', at: [ME] }), { selfId: ME, ownerId: OWNER, opts: g })
  assert.equal(v.hit, false)
  assert.match(v.reason, /不是主人邀请/)
})

test('回话想发到名单外的群 → canReplyToGroup 拒绝', () => {
  const g = normalizeGroupOpts({ listen: true, groups: [{ id: G1, invitedBy: 'owner' }] })
  const r1 = canReplyToGroup(g, G1)
  assert.equal(r1.ok, true)
  const r2 = canReplyToGroup(g, G2)
  assert.equal(r2.ok, false)
  assert.match(r2.reason, /不在名单里/)
  const r3 = canReplyToGroup(g, '')
  assert.equal(r3.ok, false)
})

test('回话想发到「不是主人邀请」的群 → 拒绝', () => {
  const g = normalizeGroupOpts({ listen: true, groups: [{ id: G1, invitedBy: 'someone-else' }] })
  const r = canReplyToGroup(g, G1)
  assert.equal(r.ok, false)
  assert.match(r.reason, /不是主人邀请/)
})

test('群聊总开关关着 → 一条都不往群里发', () => {
  const g = normalizeGroupOpts({ listen: false, groups: [{ id: G1, invitedBy: 'owner' }] })
  const r = canReplyToGroup(g, G1)
  assert.equal(r.ok, false)
  assert.match(r.reason, /总开关/)
})

test('群被单独关掉 → 不往那儿发', () => {
  const g = normalizeGroupOpts({ listen: true, groups: [{ id: G1, invitedBy: 'owner', enabled: false }] })
  assert.equal(canReplyToGroup(g, G1).ok, false)
})

test('groupInvitedByOwner：没有来源的老条目算主人，有的照实算', () => {
  assert.equal(groupInvitedByOwner({ ownerOnly: true }, { invitedBy: '' }), true)
  assert.equal(groupInvitedByOwner({ ownerOnly: true }, { invitedBy: 'owner' }), true)
  assert.equal(groupInvitedByOwner({ ownerOnly: true }, { invitedBy: 'x' }), false)
  assert.equal(groupInvitedByOwner({ ownerOnly: false }, { invitedBy: 'x' }), true)
})