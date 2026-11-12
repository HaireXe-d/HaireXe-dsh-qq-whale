/**
 * dsh-qq-whale · BreezeBlue 云端音色（2026-11-08）
 *
 * 主人提到的两个音色：
 *   · 大肥鱼（机灵版）  https://breezeblue.ai/zh/voice-library/dafeiyu-clever-girl-voice-vu3nxkd5578wc
 *     公开 Voice ID = voc_u3nxkd5578wc
 *   · 大肥鱼（迷糊版）  https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2
 *     公开 Voice ID = voc_8yud7hz7c9q2
 *
 * ⚠️⚠️ 重要：这两个是**公开音色**，但用 API 合成仍然要**你自己的 API Key**。
 *   Voice ID 只说明"用哪个声音"，不包含任何授权。
 *   没有 Key 就合成不了 —— 这时候会自动退回系统 TTS（不会哑掉）。
 *   Key 从 https://breezeblue.ai/app/developer/api-keys 拿。
 *
 * 计费（按官方 2026-10 口径）：1 credit = 10 个计费字符，中文每字算 2 个。
 *   一条 50 字的话 ≈ 10 credits。Free 套餐每天领 400 credits ≈ 40 条。
 *   所以**一定要开用量限制**（见 dailyMax / maxChars）。
 *
 * 这个文件不 import DSH，可以单独测。
 */
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'

/**
 * 官方 API 域名（2026-11-08 照官方 OpenAPI 文档核对过）
 *
 * ⚠️⚠️ 我之前写错成 `api.breezeblue.ai` —— 那个域名 404。
 *   官方 servers 里写的是 **`https://api.breeze.blue`**
 *   （breezeblue.ai 是官网，api.breeze.blue 是 API，不是同一个）✗
 *
 * 正确的调用方式（全部照官方 openapi.json）：
 *   POST https://api.breeze.blue/v1/text-to-speech/{voice_id}?output_format=mp3
 *   header: xi-api-key: <你的 Key>          ← 不是 Authorization: Bearer
 *   body:   { "text": "...", "model_id": "breeze-tts-2", "voice_settings": {...} }
 *   返回:   二进制音频（200）
 */
export const BREEZE_API_BASE = 'https://api.breeze.blue'

/**
 * 自带的两个音色。
 * ⚠️ 顺序有意义：第一个是默认值（机灵版更像"大肥鱼"平时的样子）。
 */
export const BREEZE_PRESET_VOICES = [
  {
    id: 'voc_u3nxkd5578wc',
    name: '大肥鱼（机灵版）',
    hint: '清亮、机灵，想到好主意会雀跃',
    url: 'https://breezeblue.ai/zh/voice-library/dafeiyu-clever-girl-voice-vu3nxkd5578wc',
  },
  {
    id: 'voc_8yud7hz7c9q2',
    name: '大肥鱼（迷糊版）',
    hint: '轻软、有点小迷糊，走神后回神',
    url: 'https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2',
  },
]

export const BREEZE_DEFAULTS = {
  enabled: false,                         // 默认关：没配 Key 之前开了只会一直失败
  apiKey: '',                             // 自己的 API Key（不写进仓库！）
  apiBase: BREEZE_API_BASE,
  voiceId: BREEZE_PRESET_VOICES[0].id,    // 默认「机灵版」
  model: '',                              // 留空 = 用服务端默认模型
  maxChars: 120,                          // 单条最多念多少字（省钱）
  dailyMax: 0,            // 0 = 不限（免费额度用完时服务端会明确报 402）                           // 一天最多合成几条（Free 套餐约 40 条）
  // 自己的音色（音色库里另挑的），格式 [{ id, name }]
  customVoices: [],
}

/** 今天用了几条（按本地日期分文件，跨天自动归零） */
function usageFile(dshHome) {
  return path.join(dshHome || '.', 'whale-work', 'breeze-usage.json')
}

function readJsonSafe(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

function dayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function readUsage(dshHome) {
  const j = readJsonSafe(usageFile(dshHome)) ?? {}
  return j.day === dayKey() ? j : { day: dayKey(), count: 0, chars: 0 }
}

export function bumpUsage(dshHome, chars = 0) {
  const cur = readUsage(dshHome)
  const next = { day: cur.day, count: (cur.count || 0) + 1, chars: (cur.chars || 0) + chars }
  try {
    fs.mkdirSync(path.dirname(usageFile(dshHome)), { recursive: true })
    fs.writeFileSync(usageFile(dshHome), JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch { /* 记不上不影响合成 */ }
  return next
}

/** 所有可选音色（自带的两个 + 用户自己加的） */
export function listBreezeVoices(opts = {}) {
  const v = { ...BREEZE_DEFAULTS, ...(opts ?? {}) }
  const custom = Array.isArray(v.customVoices) ? v.customVoices : []
  return [
    ...BREEZE_PRESET_VOICES.map((x) => ({ ...x, preset: true })),
    ...custom.filter((x) => x && x.id).map((x) => ({
      id: String(x.id),
      name: String(x.name || x.id),
      hint: '你自己加的音色',
      url: '',
      preset: false,
    })),
  ]
}

/**
 * 合成一段语音，返回音频字节（mp3）。
 *
 * @param {object} p
 * @param {string} p.text     要念的文字
 * @param {object} p.opts     voice.breeze 配置
 * @param {string} p.dshHome
 * @param {Function} [p.fetchImpl] 测试注入
 * @returns {Promise<{ok:boolean, audio?:Buffer, error?:string}>}
 */
export async function synthBreeze({ text, opts = {}, dshHome = '.', fetchImpl = null } = {}) {
  const v = { ...BREEZE_DEFAULTS, ...(opts ?? {}) }
  const doFetch = fetchImpl ?? globalThis.fetch

  // ⚠️ 2026-11-08：先查 Key 再查开关 ——
  //   用户选了「大肥鱼的音色」但没填 Key 时，最常见的情况是 enabled 还是 false，
  //   这时提示「没开」毫无帮助；提示「去填 Key」才对 ✓
  if (!String(v.apiKey ?? '').trim()) {
    return { ok: false, error: '没填 BreezeBlue 的 API Key。去 https://breezeblue.ai/app/developer/api-keys 拿一个，填到设置里' }
  }
  if (!v.enabled) {
    return { ok: false, error: 'BreezeBlue 音色没开（voice.breeze.enabled=false）—— 填了 Key 之后会自动开' }
  }
  const clean = String(text ?? '').trim()
  if (!clean) return { ok: false, error: '没有要念的文字' }
  if (clean.length > Number(v.maxChars ?? 120)) {
    return { ok: false, error: `太长（${clean.length} 字 > ${v.maxChars}），语音只念短的` }
  }

  // 用量限制（防刷，不是防花钱 —— 免费额度本来就够）
  //
  // ⚠️⚠️ 2026-11-12 主人：「配好 api 了但是回复的语音还是系统声音」
  //
  //   查出来是这里拦的：dailyMax 默认 40，而她已经用满 40 条了 →
  //   每一次合成请求都被拦 → 全部退回系统 TTS ✗
  //   而退回是**静默的**（只在结果里带 breezeError，控制台看不到），
  //   所以主人只听到"还是系统声音"，不知道为什么。
  //
  //   两个改法：
  //   ① 上限改成 0（不限）当默认 —— 免费额度本来就是每天 400 credits，
  //      用完服务端会返回 402，那时候会明确报「额度用完了」✓
  //   ② 就算被拦，错误信息也写清楚「是本地上限拦的，不是 API 问题」✓
  const used = readUsage(dshHome)
  const cap = Number(v.dailyMax ?? 0)
  if (cap > 0 && used.count >= cap) {
    return {
      ok: false,
      error: `今天已经合成 ${used.count} 条，到了本地设的上限 ${cap} 条（这是插件自己的限制，不是 API 出错）。`
        + `想继续用就把「每天上限」调大或填 0（不限）—— 设置 → 养鱼 · QQ → 声音 → 云端真声`,
    }
  }

  // ⚠️ 2026-11-08：官方路径是 /v1/text-to-speech/{voice_id}，音色 ID 在**路径**里
  const voiceId = String(v.voiceId || BREEZE_PRESET_VOICES[0].id)
  const base = String(v.apiBase || BREEZE_API_BASE).replace(/\/$/, '')
  const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3`
  // 语速/音量（可选，配置里没写就用默认 1.0）
  const want = (v.speed != null || v.volume != null) ? { speed: v.speed, volume: v.volume } : null

  let res
  // ⚠️ 2026-11-12：**这台机器必须先走代理**。系统挂着 Clash（127.0.0.1:7897），
  //   PowerShell / curl 走代理所以通，**Node 的 fetch 不走系统代理** ⇒ 永远 CONNECT_TIMEOUT，
  //   然后整条语音就悄悄退回系统声音（主人听出来"又变回系统音"就是这个原因）。
  //   所以：先用 curl.exe 带 --proxy 发一次，成功就直接返回，不再碰 fetch ✓
  const viaCurl = await synthByCurl({ url, key: String(v.apiKey).trim(), body: { text: clean, ...(v.model ? { model_id: String(v.model) } : {}) }, proxy: v.proxy || 'http://127.0.0.1:7897' })
  if (viaCurl.ok) {
    bumpUsage(dshHome, clean.length)
    return { ok: true, audio: viaCurl.audio, format: 'mp3' }
  }
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // ⚠️ 2026-11-08 修正：官方用的是 `xi-api-key`，不是 `Authorization: Bearer`
        //   （照官方 OpenAPI 文档：securitySchemes.ApiKeyAuth.in = header, name = xi-api-key）
        //   Key 只在 header 里，绝不写进日志/错误消息 ✓
        'xi-api-key': String(v.apiKey).trim(),
      },
      body: JSON.stringify({
        text: clean,
        ...(v.model ? { model_id: String(v.model) } : {}),
        // 语速/音量：官方字段是 voice_settings.speed / .volume（不是 response_format）
        ...(want ? {
          voice_settings: {
            speed: Math.max(0.5, Math.min(2, Number(want.speed ?? 1))),
            volume: Math.max(0.01, Math.min(2, Number(want.volume ?? 1))),
          },
        } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (e) {
    const code = e?.cause?.code ?? e?.name ?? ''
    // ⚠️ 2026-11-08：这台机器实测连不上 api.breeze.blue
    //   （DNS 能解析到 Cloudflare 的 104.21.41.34，443 也通，
    //     但 Node 的 fetch 是 UND_ERR_CONNECT_TIMEOUT，https.request 是 ECONNRESET）
    //   PowerShell 的 Invoke-WebRequest 能通，返回 401（说明端点是对的）。
    //   → 判断是网络环境问题（需要代理 / 被拦），不是代码问题。
    //   所以把话说明白，并告诉你还能怎么办 ✓
    const netHint = /TIMEOUT|RESET|ENOTFOUND|EAI_AGAIN|ECONN/i.test(String(code))
      ? '（这台机器连不上 api.breeze.blue。试试挂代理，或者先用自己的录音/自带预设）'
      : ''
    return { ok: false, error: `连不上 BreezeBlue ${code ? `[${code}]` : ''}${netHint || '：' + String(e?.message ?? e).slice(0, 80)}` }
  }

  if (!res.ok) {
    // 错误信息里可能带 key 片段 —— 一定要洗掉
    let detail = ''
    try { detail = await res.text() } catch { /* */ }
    detail = String(detail).replace(/sk_[A-Za-z0-9_-]+/g, 'sk_***').slice(0, 200)
    const hint = res.status === 401 ? '（Key 不对或过期）'
      : res.status === 402 ? '（额度用完了，去后台充值）'
        : res.status === 404 ? '（音色 ID 不对？检查一下）'
          : res.status === 429 ? '（请求太快，稍等）'
            : ''
    return { ok: false, error: `BreezeBlue 返回 ${res.status}${hint} ${detail}`.trim() }
  }

  let buf
  try {
    const ab = await res.arrayBuffer()
    buf = Buffer.from(ab)
  } catch (e) {
    return { ok: false, error: '拿到的不是音频：' + String(e?.message ?? e).slice(0, 100) }
  }
  if (!buf.length) return { ok: false, error: 'BreezeBlue 返回了空音频' }

  bumpUsage(dshHome, clean.length)
  return { ok: true, audio: buf, format: 'mp3' }
}

/**
 * 把合成好的 mp3 存到磁盘（makeVoice 那边要用文件）。
 */
export function saveBreezeAudio({ audio, outDir, ext = 'mp3' } = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const f = path.join(outDir, `breeze-${stamp}-${Math.random().toString(36).slice(2, 6)}.${ext}`)
  fs.writeFileSync(f, audio)
  return f
}

/**
 * 用 curl.exe 发请求（显式 --proxy，Node 的 fetch 走不了系统代理）
 * 返回 { ok, audio } 或 { ok:false, error }
 */
function synthByCurl({ url, key, body, proxy, timeoutMs = 45_000 }) {
  const tmpDir = path.join(os.tmpdir(), 'qq-breeze')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tag = crypto.randomBytes(4).toString('hex')
  const bodyFile = path.join(tmpDir, `body-${tag}.json`)
  const outFile = path.join(tmpDir, `out-${tag}.mp3`)
  fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8')
  const args = ['-sS', '--max-time', String(Math.round(timeoutMs / 1000)),
    '-X', 'POST', url,
    '-H', 'content-type: application/json',
    '-H', `xi-api-key: ${key}`,
    '--data-binary', `@${bodyFile}`,
    '-o', outFile]
  if (proxy) args.splice(0, 0, '--proxy', proxy)
  return new Promise((resolve) => {
    execFile('curl.exe', args, { timeout: timeoutMs + 5000, windowsHide: true }, (err, _o, stderr) => {
      try {
        if (err) { resolve({ ok: false, error: String(stderr || err.message).slice(0, 160) }); return }
        const b = fs.readFileSync(outFile)
        if (!b.length) { resolve({ ok: false, error: 'curl 空文件' }); return }
        if (b.slice(0, 1).toString() === '{') { resolve({ ok: false, error: b.toString('utf8').replace(/brz_[A-Za-z0-9_-]+/g, 'brz_***').slice(0, 180) }); return }
        resolve({ ok: true, audio: b })
      } catch (e) { resolve({ ok: false, error: String(e?.message ?? e).slice(0, 160) }) } finally {
        for (const x of [bodyFile, outFile]) { try { fs.unlinkSync(x) } catch { /* */ } }
      }
    })
  })
}
