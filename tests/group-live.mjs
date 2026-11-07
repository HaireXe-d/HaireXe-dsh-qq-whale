/**
 * 2026-11-07 · 群聊端到端（假 OneBot，不连网）
 *
 * 要走通的就是主人那两句话：
 *   「主人 @ 你就回答主人，别人 @ 你就先问主人再回」
 *
 * 这里连着验四件事：
 *   ① 别人 @ 我 → 进待审 + 给他推一条提醒（**不许自己回**）
 *   ② 他点头 → 发到**那个群**，不是发私信给他
 *   ③ 名单外的群 → 一个字都不碰
 *   ④ 回话文件里的 [群:xxx] → 走 sendGroup
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGroupPoller } from '../lib/poller.js'
import { normalizeGroupOpts } from '../lib/group.js'
import { createPendingStore } from '../lib/pending.js'
import { createReplySender } from '../lib/reply-sender.js'

const ME = '10001'
const OWNER = '20002'
const G = '123456789'

function tmpHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-group-e2e-'))
  fs.mkdirSync(path.join(d, 'whale-channels'), { recursive: true })
  fs.mkdirSync(path.join(d, 'whale-work'), { recursive: true })
  return d
}

const gm = (over = {}) => ({
  post_type: 'message', message_type: 'group',
  group_id: over.group_id ?? over.groupId ?? G,     // ⚠️ 同一个测试里两种写法都用过，别踩自己 ✗
  message_id: over.id ?? 1,
  time: 1794000000, sender: { user_id: over.from ?? '111', nickname: over.nick ?? '室友' },
  message: [
    ...(over.at ?? []).map((q) => ({ type: 'at', data: { qq: q } })),
    { type: 'text', data: { text: over.text ?? '在吗' } },
  ],
})

test('别人在群里 @ 我 → 进待审队列，并给他推一条提醒', async () => {
  const dshHome = tmpHome()
  const sent = []
  const ob = {
    getGroupHistory: async () => ({ messages: [gm({ at: [ME] })] }),
    sendPrivate: async (to, text) => { sent.push({ to, text }); return { message_id: 1 } },
  }
  const opts = normalizeGroupOpts({ listen: true, groups: [{ id: G, name: '宿舍群' }] })
  const gp = createGroupPoller({ ob, groups: opts.groups, selfId: ME, ownerId: OWNER, opts })
  const r = await gp.pollOnce()
  assert.equal(r.fresh.length, 1)
  assert.equal(r.fresh[0].kind, 'other')

  const store = createPendingStore({ dshHome })
  const added = store.add({ ...r.fresh[0], kind: 'group', groupId: r.fresh[0].groupId, groupName: '宿舍群' })
  assert.equal(added.duplicate, false)
  assert.equal(added.item.kind, 'group')
  assert.equal(added.item.groupId, G)

  const notice = store.summaryFor(added.item)
  assert.match(notice, /群里有人 @ 我/)
  assert.match(notice, /宿舍群/)
  await ob.sendPrivate(OWNER, notice)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /等你点头/)
})

test('同一个人在群里说两遍同一句：只进一次队', () => {
  const dshHome = tmpHome()
  const store = createPendingStore({ dshHome })
  const a = store.add({ userId: '111', messageId: 9, nickname: '室友', text: '在吗', kind: 'group', groupId: G })
  const b = store.add({ userId: '111', messageId: 9, nickname: '室友', text: '在吗', kind: 'group', groupId: G })
  assert.equal(a.duplicate, false)
  assert.equal(b.duplicate, true)
  // 同一个 messageId，换一个群 → 是另一条消息
  const c = store.add({ userId: '111', messageId: 9, nickname: '室友', text: '在吗', kind: 'group', groupId: '987654321' })
  assert.equal(c.duplicate, false)
})

test('他点头 → 发回那个群（不是发私信给主人）', async () => {
  const dshHome = tmpHome()
  const store = createPendingStore({ dshHome })
  const { item } = store.add({ userId: '111', messageId: 3, nickname: '室友', text: '你在吗', kind: 'group', groupId: G, draft: '在的' })

  const toGroup = []
  const toPrivate = []
  const ob = {
    sendGroup: async (gid, text) => { toGroup.push({ gid, text }); return { message_id: 10 } },
    sendPrivate: async (uid, text) => { toPrivate.push({ uid, text }); return { message_id: 11 } },
  }
  // 跟 /pending/approve 那段一模一样的判断
  const data = item.kind === 'group'
    ? await ob.sendGroup(item.groupId, item.draft)
    : await ob.sendPrivate(item.userId, item.draft)
  assert.equal(data.message_id, 10)
  assert.deepEqual(toGroup, [{ gid: G, text: '在的' }])
  assert.equal(toPrivate.length, 0)
  store.take(item.id)
  assert.equal(store.list().length, 0)
})

test('名单外的群：一条都不交出来', async () => {
  // ⚠️ 只问名单里的群（不在名单里的群**根本不会被轮询到**）。
  //   这里模拟「历史里混着别的群」这种更讨厌的情况：即使翻到了，也不认 ✓
  const ob = { getGroupHistory: async () => ({
    messages: [
      gm({ group_id: '555555555', at: [ME] }),     // 别的群（就算被翻到）
      (() => { const m = gm({ id: 2, at: [ME] }); m.message_type = 'private'; delete m.group_id; return m })(),
    ],
  }) }
  const opts = normalizeGroupOpts({ listen: true, groups: [{ id: G }] })
  const gp = createGroupPoller({ ob, groups: opts.groups, selfId: ME, ownerId: OWNER, opts })
  const r = await gp.pollOnce()
  assert.equal(r.fresh.length, 0)
})

test('回话文件里写 [群:xxx] → 走 sendGroup；没写 → 走私信', async () => {
  const dshHome = tmpHome()
  const workDir = path.join(dshHome, 'whale-work')
  const file = path.join(workDir, 'dm-reply-qq.txt')
  fs.writeFileSync(file, `[群:${G}] 群里回一句\n私下再跟你说一句\n`, 'utf8')

  const toGroup = []
  const toPrivate = []
  const ob = {
    sendGroup: async (gid, text) => { toGroup.push({ gid, text }); return { message_id: 20 } },
    sendPrivate: async (uid, text) => { toPrivate.push({ uid, text }); return { message_id: 21 } },
  }
  const sender = createReplySender({
    ob, ownerId: OWNER, workDir, fileName: 'dm-reply-qq.txt',
    // ⚠️ 2026-11-07：这个群得是**主人邀请的**，不然会被拦下（规矩：群聊只有主人能邀请）
    readConfig: () => ({ reply: { maxLines: 6, gapMs: 0 }, group: { listen: true, groups: [{ id: G, invitedBy: 'owner' }] } }),
    log: () => {},
  })
  const r = await sender.tick()
  assert.equal(r.sent, 2)
  assert.deepEqual(toGroup, [{ gid: G, text: '群里回一句' }])
  assert.deepEqual(toPrivate, [{ uid: OWNER, text: '私下再跟你说一句' }])
  assert.equal(fs.readFileSync(file, 'utf8'), '')   // 发完清空
})

test('群号写错了（不是 5–16 位）→ 当成普通文字，不乱发', async () => {
  const dshHome = tmpHome()
  const workDir = path.join(dshHome, 'whale-work')
  fs.writeFileSync(path.join(workDir, 'dm-reply-qq.txt'), '[群:12] 这句不该去群里\n', 'utf8')
  const toGroup = []
  const ob = {
    sendGroup: async (gid) => { toGroup.push(gid); return { message_id: 1 } },
    sendPrivate: async () => ({ message_id: 2 }),
  }
  const sender = createReplySender({
    ob, ownerId: OWNER, workDir, readConfig: () => ({ reply: { gapMs: 0 } }), log: () => {},
  })
  await sender.tick()
  assert.equal(toGroup.length, 0)
})


test('回复文件写了名单外的群 → 一条都不发到群里，改成私信告诉他', async () => {
  const dshHome = tmpHome()
  const workDir = path.join(dshHome, 'whale-work')
  const file = path.join(workDir, 'dm-reply-qq.txt')
  fs.writeFileSync(file, `[群:555555555] 我不该去这个群\n群里说一句\n`, 'utf8')

  const toGroup = []
  const toPrivate = []
  const ob = {
    sendGroup: async (gid, text) => { toGroup.push({ gid, text }); return { message_id: 1 } },
    sendPrivate: async (uid, text) => { toPrivate.push({ uid, text }); return { message_id: 2 } },
  }
  const sender = createReplySender({
    ob, ownerId: OWNER, workDir,
    // 名单里只有 G，而且是主人邀请的
    readConfig: () => ({ reply: { gapMs: 0 }, group: { listen: true, groups: [{ id: G, invitedBy: 'owner' }] } }),
    log: () => {},
  })
  const r = await sender.tick()
  // 名单外那条被拦下 → 只有私信那句真的发出去
  assert.equal(r.sent, 1)
  assert.equal(r.blocked, 1)
  assert.equal(toGroup.length, 0, '名单外的群一个字都不许发')
  assert.equal(toPrivate.length, 2)   // ① 拦截通知 ② 那句正常私信
  assert.match(toPrivate[0].text, /没发出去/)
  assert.match(toPrivate[0].text, /555555555/)
  assert.equal(toPrivate[1].text, '群里说一句')
})

test('群不是主人邀请的 → 也拦（就算在名单里）', async () => {
  const dshHome = tmpHome()
  const workDir = path.join(dshHome, 'whale-work')
  fs.writeFileSync(path.join(workDir, 'dm-reply-qq.txt'), `[群:${G}] 想说一句\n`, 'utf8')
  const toGroup = []
  const toPrivate = []
  const ob = {
    sendGroup: async (gid) => { toGroup.push(gid); return { message_id: 1 } },
    sendPrivate: async (uid, text) => { toPrivate.push({ uid, text }); return { message_id: 2 } },
  }
  const sender = createReplySender({
    ob, ownerId: OWNER, workDir,
    readConfig: () => ({ reply: { gapMs: 0 }, group: { listen: true, groups: [{ id: G, invitedBy: 'someone-else' }] } }),
    log: () => {},
  })
  const r = await sender.tick()
  assert.equal(r.sent, 0)
  assert.equal(r.blocked, 1)
  assert.equal(toGroup.length, 0)
  assert.match(toPrivate[0].text, /不是主人邀请/)
})

test('群聊总开关关着 → 群回话一条也不发（私信照旧）', async () => {
  const dshHome = tmpHome()
  const workDir = path.join(dshHome, 'whale-work')
  fs.writeFileSync(path.join(workDir, 'dm-reply-qq.txt'), `[群:${G}] 群里\n私信一句\n`, 'utf8')
  const toGroup = []
  const toPrivate = []
  const ob = {
    sendGroup: async (gid) => { toGroup.push(gid); return { message_id: 1 } },
    sendPrivate: async (uid, text) => { toPrivate.push({ uid, text }); return { message_id: 2 } },
  }
  const sender = createReplySender({
    ob, ownerId: OWNER, workDir,
    readConfig: () => ({ reply: { gapMs: 0 }, group: { listen: false, groups: [{ id: G, invitedBy: 'owner' }] } }),
    log: () => {},
  })
  const r = await sender.tick()
  assert.equal(toGroup.length, 0)
  assert.equal(r.sent, 1)
  assert.equal(toPrivate[toPrivate.length - 1].text, '私信一句')
})