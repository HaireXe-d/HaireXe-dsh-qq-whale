/**
 * dsh-qq-whale · 运行时读共用规则（2026-11-04）
 *
 * ⚠️ 发现的真问题：`shared.json` 里的规则**之前只有控制台看得见**，
 *   调度器运行时根本不看 —— 于是「私聊只能给一个」在界面上成立、在行为上不成立 ✗
 *   两个都开着的时候，两边会同时叫醒她，说的话互相打架。
 *
 * 这个文件只做一件事：**告诉通道「现在该不该我说话」**。
 *   · 读 ~/.dsh/whale-channels/shared.json 和 index.json
 *   · 用 core 的同一套规则算（不重写 ✗）
 *   · 读不到/算不出 → **返回允许**（不能因为读不到配置就把自己关死）
 *
 * 不 import DSH；规则从 core 动态取。
 */
import fs from 'node:fs'
import path from 'node:path'

const CHANNEL = 'qq'

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * 现在这个通道能不能做某件事。
 * @param {object} p
 * @param {string} p.dshHome
 * @param {string} [p.channel]  'qq' | 'bili'
 * @param {Function} [p.rules]  测试注入：{ capabilitiesFor, normalizeShared }
 * @returns {{ dm: boolean, dynamic: boolean, share: boolean, why: string, known: boolean }}
 */
export function readRuntimeRules({ dshHome, channel = CHANNEL, rules = null } = {}) {
  const sharedFile = path.join(dshHome, 'whale-channels', 'shared.json')
  const indexFile = path.join(dshHome, 'whale-channels', 'index.json')
  const shared = readJson(sharedFile) ?? {}
  const idx = readJson(indexFile) ?? null
  const enabled = {
    bili: idx?.channels?.bili?.enabled !== false,
    qq: idx?.channels?.qq?.enabled !== false,
  }
  // ⚠️ 2026-11-07 晚（trace-message-flow 抓到的致命 bug）：
  //   这里原来没传 configured，于是「装了谁」这个信息丢了 ——
  //   只装 QQ 的用户 shared.json 不存在 → dm 默认 'bili' → QQ 算出 dm=false
  //   → 收到消息「规则拦下」→ 一条都不投递 ✗
  //
  //   判断「装了谁」：
  //     · **自己这个通道**：能跑到这段代码 = 装了 ✓（永远 true）
  //     · **对面那个通道**：看插件目录在不在
  //   注意：不能因为目录查不到就说"没装" —— 宁可认为装了（保守），
  //   否则又会退回「dm 归一个不存在的通道」那个坑 ✗
  const pluginsDir = path.join(dshHome, 'plugins')
  const dirHas = (name) => {
    try { return fs.existsSync(path.join(pluginsDir, name)) } catch { return false }
  }
  const configured = {
    // 自己一定装了
    qq: channel === 'qq' ? true : dirHas('dsh-qq-whale'),
    bili: channel === 'bili' ? true : dirHas('dsh-bili-whale'),
  }

  // 没有规则实现 → 一律允许（宁可多说话，也别因为找不到配置就装死 ✗）
  if (!rules) {
    return { dm: true, dynamic: true, share: channel === 'bili', why: '没拿到规则实现，按允许处理', known: false }
  }
  try {
    const cap = rules.capabilitiesFor(channel, {
      shared: rules.normalizeShared(shared, { configured }),
      enabled,
      configured,
    })
    return { dm: cap.dm === true, dynamic: cap.dynamic === true, share: cap.share === true, why: cap.why, known: true }
  } catch (e) {
    return { dm: true, dynamic: true, share: channel === 'bili', why: `规则算不出来（${e?.message ?? e}），按允许处理`, known: false }
  }
}

/** 让调用方自己注入规则实现（index.js 里从 core 取） */
export function makeRuleReader({ dshHome, channel = CHANNEL, rules = null } = {}) {
  return () => readRuntimeRules({ dshHome, channel, rules })
}
