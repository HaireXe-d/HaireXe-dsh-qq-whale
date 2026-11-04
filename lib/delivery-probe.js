/**
 * 2026-11-04 18:27 · 投递自检探针
 *
 * 背景：QQ 私信走到 `controller.prompt()` 一律 `session/agent-busy`，
 *   而错误真因被 DSH 包成 `prompt rejected` 吃掉了，光看日志推不出来。
 *
 * 这个文件由插件在**启动时**跑一次：拿自己的 controller 往当前会话投一条**无害的自检文本**
 * （只发给模型，不产生任何对外动作），把完整错误原样写到
 * `~/.dsh/whale-channels/qq-delivery-probe.txt`。
 *
 * 为什么放在插件里跑：只有插件手里才有真正的 sessionController，
 * 命令行里拿不到 —— 这也是之前所有「本地复现」都失败的原因。
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {object} p
 * @param {object} p.controller  DSH 的 sessionController（有 create/prompt）
 * @param {string} p.dshHome
 * @param {string} p.sessionId   目标会话
 * @param {string} p.cwd
 * @param {Function} [p.log]
 * @param {Function} [p.now]
 */
export async function runDeliveryProbe({ controller, dshHome, sessionId, cwd, log = () => {}, now = () => Date.now() } = {}) {
  const file = path.join(dshHome, 'whale-channels', 'qq-delivery-probe.txt')
  const write = (lines) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, lines.join('\n') + '\n')
    } catch (e) { log(`[qq] 探针写不进去：${e?.message ?? e}`) }
  }

  const started = new Date(now()).toISOString()
  if (!controller || typeof controller.prompt !== 'function') {
    write([`时间：${started}`, '结果：没有 sessionController（连探针都跑不了）'])
    return { ok: false, why: 'no-controller' }
  }

  // 尽量少的字段：只放一条文本，不碰文件/图片/附件 —— 把变量降到最低
  const req = {
    sessionId,
    mode: 'queue',
    // ⚠️ 2026-11-04 18:30：**必须带 requestId**。不给的话 DSH 把 `rpcId: undefined`
    //   写进 source，序列化 `agent/inbox/spliced` 事件时炸
    //   （`session event … carries non-JSON-serializable data`）✗
    requestId: `probe-${sessionId}-${now()}`,
    content: [{ type: 'text', text: '【自检】这是一条投递自检消息，看到就说明 QQ 通道能叫醒我了。不用回应。' }],
  }
  const signal = AbortSignal.timeout(30 * 1000)
  try {
    await controller.prompt(req, signal)
    write([`时间：${started}`, `结果：投递成功 ✓`, `sessionId=${sessionId}`])
    log('[qq] 投递自检：成功 ✓')
    return { ok: true }
  } catch (e) {
    const dump = {
      时间: started,
      结果: '投递失败',
      message: e?.message ?? String(e),
      code: e?.code ?? null,
      name: e?.name ?? null,
      data: e?.data ?? null,
      cause: e?.cause ? (e.cause.message ?? String(e.cause)) : null,
      stack: String(e?.stack ?? '').split('\n').slice(0, 12).join('\n'),
      请求: req,
    }
    let json = ''
    try { json = JSON.stringify(dump, null, 2) } catch { json = String(dump) }
    write([json])
    log(`[qq] 投递自检：失败 —— ${e?.message ?? e}（详情见 qq-delivery-probe.txt）`)
    return { ok: false, why: 'failed', error: e }
  }
}
