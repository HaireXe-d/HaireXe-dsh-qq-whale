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
  // 没有规则实现 → 一律允许（宁可多说话，也别因为找不到配置就装死 ✗）
  if (!rules) {
    return { dm: true, dynamic: true, share: channel === 'bili', why: '没拿到规则实现，按允许处理', known: false }
  }
  try {
    const cap = rules.capabilitiesFor(channel, { shared: rules.normalizeShared(shared), enabled })
    return { dm: cap.dm === true, dynamic: cap.dynamic === true, share: cap.share === true, why: cap.why, known: true }
  } catch (e) {
    return { dm: true, dynamic: true, share: channel === 'bili', why: `规则算不出来（${e?.message ?? e}），按允许处理`, known: false }
  }
}

/** 让调用方自己注入规则实现（index.js 里从 core 取） */
export function makeRuleReader({ dshHome, channel = CHANNEL, rules = null } = {}) {
  return () => readRuntimeRules({ dshHome, channel, rules })
}
