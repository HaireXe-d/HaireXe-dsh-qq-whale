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
import path from 'node:path'

/** 官方端点（如果改了，改这里一处就行） */
export const BREEZE_API_BASE = 'https://api.breezeblue.ai'

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
  dailyMax: 40,                           // 一天最多合成几条（Free 套餐约 40 条）
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

  // 用量限制（省钱 + 防止被刷）
  const used = readUsage(dshHome)
  if (Number(v.dailyMax ?? 0) > 0 && used.count >= Number(v.dailyMax)) {
    return { ok: false, error: `今天已经合成 ${used.count} 条了（上限 ${v.dailyMax}），明天再来` }
  }

  let res
  try {
    res = await doFetch(`${String(v.apiBase || BREEZE_API_BASE).replace(/\/$/, '')}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // ⚠️ Key 只在 header 里，绝不写进日志/错误消息 ✓
        authorization: `Bearer ${String(v.apiKey).trim()}`,
      },
      body: JSON.stringify({
        input: clean,
        voice: String(v.voiceId || BREEZE_PRESET_VOICES[0].id),
        ...(v.model ? { model: String(v.model) } : {}),
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (e) {
    const code = e?.cause?.code ?? e?.name ?? ''
    return { ok: false, error: `连不上 BreezeBlue（${code || String(e?.message ?? e).slice(0, 80)}）` }
  }

  if (!res.ok) {
    // 错误信息里可能带 key 片段 —— 一定要洗掉
    let detail = ''
    try { detail = await res.text() } catch { /* */ }
    detail = String(detail).replace(/sk_[A-Za-z0-9_-]+/g, 'sk_***').slice(0, 200)
    const hint = res.status === 401 ? '（Key 不对或过期）'
      : res.status === 402 ? '（额度用完了，去后台充值）'
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
