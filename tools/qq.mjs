/**
 * qq.mjs —— QQ 通道的命令行（不经过 DSH 也能用）
 *
 * 为什么要有它：插件里的功能一旦只能从浏览器点，出事的时候就只能靠猜 ✗
 * 这里跟插件走**同一份** lib/onebot.js，所以「命令行能通 = 插件里的发消息也能通」✓
 *
 * 用法：
 *   node qq.mjs status                        OneBot 活着吗、登的是哪个号
 *   node qq.mjs send <QQ号> <文字>             发一条私信
 *   node qq.mjs poke <QQ号>                    戳一戳
 *   node qq.mjs history <QQ号> [条数]          拉最近的私信
 *   node qq.mjs config                         看当前配置（token 打码）
 *
 * 退出码：0 成功 / 1 失败 / 2 参数不对
 */
import fs from 'node:fs'
import path from 'node:path'
import { createOneBot, OneBotError } from '../lib/onebot.js'

const DSH_HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
const CFG_FILE = path.join(DSH_HOME, 'whale-channels', 'channels', 'qq.json')

const DEFAULTS = {
  onebot: { baseUrl: 'http://127.0.0.1:3000', token: '' },
  owner: { uin: '' },
}

function readCfg() {
  let onDisk = {}
  try { onDisk = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) } catch {}
  return {
    ...DEFAULTS,
    ...onDisk,
    onebot: { ...DEFAULTS.onebot, ...(onDisk.onebot ?? {}) },
    owner: { ...DEFAULTS.owner, ...(onDisk.owner ?? {}) },
  }
}

function usage() {
  console.error([
    '用法：',
    '  node qq.mjs status',
    '  node qq.mjs send <QQ号> <文字>',
    '  node qq.mjs poke <QQ号>',
    '  node qq.mjs history <QQ号> [条数]',
    '  node qq.mjs config',
  ].join('\n'))
  process.exit(2)
}

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) usage()

const cfg = readCfg()
const mk = () => createOneBot({ baseUrl: cfg.onebot.baseUrl, token: cfg.onebot.token, timeoutMs: 8000 })

try {
  if (cmd === 'status') {
    const ob = mk()
    console.log(`OneBot：${ob.baseUrl}`)
    try {
      const info = await ob.getLoginInfo()
      console.log(`✓ 已登录：${info?.nickname ?? '?'}（${info?.user_id ?? '?'}）`)
    } catch (e) {
      console.log(`✗ ${e.message}`)
      process.exit(1)
    }
    const st = await ob.getStatus().catch(() => null)
    if (st) console.log(`状态：online=${st.online ?? '?'} good=${st.good ?? '?'}`)
  } else if (cmd === 'send') {
    const [uin, ...rest] = args
    const text = rest.join(' ').trim()
    if (!uin || !text) usage()
    const data = await mk().sendPrivate(uin, text)
    console.log(`✓ 已发（message_id=${data?.message_id ?? '?'}）`)
  } else if (cmd === 'poke') {
    const [uin] = args
    if (!uin) usage()
    await mk().sendPoke(uin)
    console.log('✓ 戳了一下')
  } else if (cmd === 'history') {
    const [uin, n] = args
    if (!uin) usage()
    const data = await mk().getPrivateHistory(uin, { count: Number(n) || 10 })
    console.log(JSON.stringify(data, null, 2))
  } else if (cmd === 'config') {
    const safe = JSON.parse(JSON.stringify(cfg))
    if (safe.onebot?.token) safe.onebot.token = '******'
    console.log(`配置：${CFG_FILE}`)
    console.log(JSON.stringify(safe, null, 2))
  } else {
    usage()
  }
} catch (e) {
  if (e instanceof OneBotError) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
  console.error(`✗ ${e?.message ?? e}`)
  process.exit(1)
}
