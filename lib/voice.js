/**
 * dsh-qq-whale · 声音（2026-11-04 主人：「上限和声音都可以在控制台导入」）
 *
 * 两种出声方式，控制台里选：
 *   ① **系统 TTS**（Windows 自带）—— 想听哪个人声就选哪个
 *   ② **导入自己的音频文件** —— 主人塞一个 wav/mp3/m4a 进来，我就用那个当「我的声音」
 *
 * ⚠️ 这里说的「声音」有两种完全不同的意思，别混：
 *   · 说话的音色（TTS 选谁）
 *   · 一段固定的音频（比如他给我录的、我喜欢的一句）
 *   两个都支持，配置里分开写 ✓
 *
 * 这个文件不 import DSH。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

export const VOICE_DEFAULTS = {
  enabled: true,
  // ⚠️ 2026-11-08 引擎三档：
  //   'preset' = **自带的大肥鱼音色**（系统 TTS + 音调改造，不花钱）← 默认
  //   'tts'    = 系统 TTS 原生声音（自己挑音色/语速）
  //   'file'   = 用你自己导入的一段音频
  engine: 'preset',           // preset | tts | file
  preset: 'clever',           // 大肥鱼预设：clever（机灵版）| dreamy（迷糊版）
  voice: 'Microsoft Huihui Desktop',
  pitch: 0,                   // 音调（-50..50，走 SSML；非 0 才生效）
  rate: 0,                    // 语速 -10 ～ 10
  volume: 100,                // 0 ～ 100
  maxChars: 120,
  customFile: '',             // engine='file' 时要发的那段音频
}

const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.amr'])

/**
 * 大肥鱼的两个音色预设（2026-11-08）
 *
 * ⚠️⚠️ 重要说明：
 *   这是**用 Windows 自带的中文音色（Huihui）改造出来的**，
 *   不是真人声优的音色。
 *
 *   做法：拿这台机器自带的中文朗读声音，用 SSML 调**音调 + 语速**，
 *   做出「机灵」和「迷糊」两种性格感 ✓
 *
 *   差别在哪：
 *     机灵版 —— 音调高、语速快 → 精神、雀跃、爱抢话
 *     迷糊版 —— 音调低、语速慢 → 软、慢、有点走神
 *
 *   想换成别的系统音色（装了其他中文 TTS 的话），
 *   把 `voice` 字段改掉即可，pitch/rate 照样生效 ✓
 */
export const DAILY_PRESETS = {
  clever: {
    id: 'clever',
    name: '大肥鱼（机灵版）',
    hint: '音调偏高、语速偏快 —— 精神、爱抢话',
    voice: 'Microsoft Huihui Desktop',
    pitch: 18,        // 音调 +18%
    rate: 2,          // 语速（SAPI -10..10）
    volume: 100,
  },
  dreamy: {
    id: 'dreamy',
    name: '大肥鱼（迷糊版）',
    hint: '音调偏低、语速偏慢 —— 软、慢、有点走神',
    voice: 'Microsoft Huihui Desktop',
    pitch: -12,       // 音调 -12%
    rate: -3,         // 语速慢一点
    volume: 100,
  },
}

/** 按预设名取一套参数（找不到就用机灵版） */
export function getDailyPreset(id = 'clever') {
  return DAILY_PRESETS[String(id ?? '')] ?? DAILY_PRESETS.clever
}

/** 列出这台机器上能用的 TTS 声音（中文排前面） */
export function listVoices({ psHost = 'powershell.exe', timeoutMs = 20_000 } = {}) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$out = @()
foreach ($v in $s.GetInstalledVoices()) {
  if ($v.Enabled) {
    $out += [pscustomobject]@{ name = $v.VoiceInfo.Name; culture = $v.VoiceInfo.Culture.Name; gender = $v.VoiceInfo.Gender.ToString() }
  }
}
$s.Dispose()
$out | ConvertTo-Json -Compress
`
  const tmp = path.join(os.tmpdir(), `qq-voices-${Date.now()}.ps1`)
  fs.writeFileSync(tmp, '\ufeff' + script, 'utf8')   // PowerShell 5 读 UTF-8 要 BOM
  return new Promise((resolve) => {
    execFile(psHost, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      try { fs.unlinkSync(tmp) } catch {}
      if (err) { resolve([]); return }
      try {
        const parsed = JSON.parse(String(stdout || '[]').trim())
        const arr = Array.isArray(parsed) ? parsed : [parsed]
        // 中文的排前面，其余按名字排 —— 设置页里好挑 ✓
        arr.sort((a, b) => (b.culture?.startsWith('zh') ? 1 : 0) - (a.culture?.startsWith('zh') ? 1 : 0) || String(a.name).localeCompare(String(b.name)))
        resolve(arr)
      } catch { resolve([]) }
    })
  })
}

/** PowerShell 单引号转义：' → '' */
function psQuote(s) { return `'${String(s ?? '').replace(/'/g, "''")}'` }

/**
 * 念一段话，落成 wav。
 * ⚠️ 必须走**脚本文件**，不能把文字拼进命令行 —— 我要念的话里有引号、括号、分号 ✗
 *
 * ⚠️⚠️ 2026-11-08 加 `pitch`（音调）：
 *   主人要「用系统自带的音色改造成大肥鱼那种感觉」。
 *   但 .NET 4.x 的 SpeechSynthesizer **没有 SetPitch()**（实测报
 *   "does not contain a method named 'SetPitch'"），只有 .NET 5+ 才有 ✗
 *
 *   能用的办法是 **SSML** —— `<prosody pitch='+18%'>`，这个 System.Speech 认 ✓
 *   所以：pitch 非 0 时走 SpeakSsml，否则走原来的 Speak（老路不改变行为）。
 */
export function synthWav({ text, outFile, voice = '', rate = 0, volume = 100, pitch = 0, psHost = 'powershell.exe', timeoutMs = 30_000 } = {}) {
  const rateNum = Number(rate) || 0
  const pitchNum = Number(pitch) || 0
  const vol = Math.max(0, Math.min(100, Number(volume) || 100))

  // SSML 里 rate 用百分比（-10..10 的滑杆值 → -50%..+50%）
  const ratePct = rateNum === 0 ? '0%' : `${rateNum > 0 ? '+' : ''}${Math.round(rateNum * 5)}%`
  // SSML 里 pitch 也是百分比（我们的 pitch 是 -50..50 的"音分"概念，直接当百分比用）
  const pitchPct = `${pitchNum > 0 ? '+' : ''}${Math.round(pitchNum)}%`

  // 文字里的 XML 特殊字符必须转义，否则 SSML 解析失败
  const escXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

  const useSsml = pitchNum !== 0
  const ssml = useSsml
    ? `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${escXml(voice || 'Microsoft Huihui Desktop')}"><prosody rate="${ratePct}" pitch="${pitchPct}" volume="${vol}">${escXml(text)}</prosody></voice></speak>`
    : ''

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voice ? `try { $s.SelectVoice(${psQuote(voice)}) } catch { }` : ''}
$s.Rate = ${rateNum}
try { $s.Volume = ${vol} } catch { }
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile(${psQuote(outFile)}, $fmt)
${useSsml ? `$s.SpeakSsml(${psQuote(ssml)})` : `$s.Speak(${psQuote(text)})`}
$s.Dispose()
`
  const tmpScript = path.join(os.tmpdir(), `qq-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`)
  fs.writeFileSync(tmpScript, '\ufeff' + script, 'utf8')
  return new Promise((resolve, reject) => {
    execFile(psHost, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpScript], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpScript) } catch {}
      if (err) { reject(new Error(`TTS 失败：${String(stderr || err.message).slice(0, 300)}`)); return }
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 100) { reject(new Error('TTS 没产出音频文件')); return }
      resolve({ file: outFile, bytes: fs.statSync(outFile).size })
    })
  })
}

/** 找 ffmpeg：配置 → 环境变量 → PATH → 剪映自带那份 */
export function findFfmpeg({ hint = '' } = {}) {
  if (hint && fs.existsSync(hint)) return hint
  const candidates = []
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH)
  try {
    const jy = path.join(process.env.LOCALAPPDATA || '', 'JianyingPro', 'Apps')
    if (fs.existsSync(jy)) {
      for (const ver of fs.readdirSync(jy)) {
        const p = path.join(jy, ver, 'ffmpeg.exe')
        if (fs.existsSync(p)) candidates.push(p)
      }
    }
  } catch { /* 没有就算了 */ }
  for (const name of ['ffmpeg', 'ffmpeg.exe']) {
    const dirs = (process.env.PATH || '').split(path.delimiter)
    for (const d of dirs) {
      const p = path.join(d, name)
      try { if (fs.statSync(p).isFile()) { candidates.push(p); break } } catch { /* 继续找 */ }
    }
  }
  return candidates[0] ?? null
}

/**
 * 转成 QQ 认的语音格式。
 *
 * ⚠️ 2026-11-04 18:47 **这条路的结论反过来了**（以前一直哑着就是因为这里）：
 *
 *   旧判断：本机 ffmpeg 没有 amr 编码器 → **不发** ✗ 语音功能因此从来没通过。
 *
 *   今天实测：**NapCat 自己带着 ffmpeg**（`C:\NapCat\app\napcat\native\ffmpeg\`），它能自己转。
 *   直接把 wav 用 `[CQ:record,file=xxx.wav]` 发过去，NapCat 当场转成语音，
 *   落到 `nt_data\Ptt\...`，回读 `message[0].type === 'record'` ✓
 *
 *   所以现在：
 *     · 本机能转 amr 就转（更省事）
 *     · **转不了就把 wav 直接交给 NapCat** —— 它自己转，不比本地差 ✓
 *   只有连 NapCat 都不收的时候才真的没辙。
 */
export function toQqAudio({ wavFile, ffmpeg = null, timeoutMs = 30_000 } = {}) {
  const bin = ffmpeg ?? findFfmpeg()
  // ⚠️ 连 ffmpeg 都没有也不慌：原样交给 NapCat
  if (!bin) return Promise.resolve({ ok: true, file: wavFile, format: 'wav', converted: false })
  const amrOut = wavFile.replace(/\.wav$/i, '.amr')
  return new Promise((resolve) => {
    execFile(bin, ['-y', '-i', wavFile, '-ar', '8000', '-ac', '1', '-c:a', 'libopencore_amrnb', '-b:a', '12.2k', amrOut],
      { timeout: timeoutMs, windowsHide: true }, (err) => {
        if (!err && fs.existsSync(amrOut) && fs.statSync(amrOut).size > 100) {
          resolve({ ok: true, file: amrOut, format: 'amr', converted: true })
          return
        }
        try { if (fs.existsSync(amrOut)) fs.unlinkSync(amrOut) } catch {}
        // 本机转不了 → 交给 NapCat 转（实测可行）
        resolve({ ok: true, file: wavFile, format: 'wav', converted: false })
      })
  })
}

/** 导入一段自己的音频（控制台用） */
export function importVoiceFile({ from, dshHome, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!from) throw new Error('没有给文件路径')
  const src = String(from)
  if (!fs.existsSync(src)) throw new Error(`文件不存在：${src}`)
  const st = fs.statSync(src)
  if (!st.isFile()) throw new Error('给的不是文件')
  if (st.size > maxBytes) throw new Error(`文件太大（${(st.size / 1024 / 1024).toFixed(1)}MB）`)
  const ext = path.extname(src).toLowerCase()
  if (!AUDIO_EXT.has(ext)) throw new Error(`不认的音频格式：${ext}（支持 ${[...AUDIO_EXT].join(' ')}）`)
  const dir = path.join(dshHome, 'whale-channels', 'qq-voice')
  fs.mkdirSync(dir, { recursive: true })
  const dst = path.join(dir, `custom${ext}`)
  fs.copyFileSync(src, dst)
  return { file: dst, bytes: st.size, ext }
}

/** 发一条语音的完整流程 */
export async function makeVoice({ text, outDir, opts = {}, synth = synthWav, ffmpeg = null, dshHome = '' } = {}) {
  const v = { ...VOICE_DEFAULTS, ...(opts ?? {}) }
  if (!v.enabled) return { ok: false, error: '语音功能是关着的（voice.enabled=false）' }

  // ── ① 用自己导入的音频 ────────────────────────────────
  if (v.engine === 'file') {
    if (!v.customFile || !fs.existsSync(v.customFile)) return { ok: false, error: '选了「用我自己的音频」，但还没导入文件（控制台里导一下）' }
    const conv = await toQqAudio({ wavFile: v.customFile.replace(/\.[^.]+$/, '.wav'), ffmpeg })
    // 导入的已经是 amr 就直接用
    if (path.extname(v.customFile).toLowerCase() === '.amr') return { ok: true, file: v.customFile, format: 'amr' }
    return conv.ok ? { ok: true, file: conv.file, format: conv.format } : { ok: false, error: conv.error, wav: v.customFile, spoken: true }
  }

  const clean = String(text ?? '').trim()

  // ── ② 系统 TTS 现念 ──────────────────────────────────
  if (process.platform !== 'win32') return { ok: false, error: '语音只做了 Windows 的 TTS，这台机器用不了' }
  if (!clean) return { ok: false, error: '没有要念的文字' }
  if (clean.length > v.maxChars) return { ok: false, error: `太长（${clean.length} 字 > ${v.maxChars}），语音只念短的` }

  // ⚠️ 2026-11-08：如果有「预设」（大肥鱼机灵/迷糊版），
  //   用预设里的音色 + 音调 + 语速覆盖掉配置里的 —— 这样用户选一个就行 ✓
  const preset = v.preset ? getDailyPreset(v.preset) : null
  const useVoice = preset?.voice || v.voice
  const usePitch = preset ? Number(preset.pitch) : Number(v.pitch ?? 0)
  const useRate = preset ? Number(preset.rate) : Number(v.rate ?? 0)
  const useVolume = preset ? Number(preset.volume ?? v.volume) : Number(v.volume ?? 100)

  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const wavFile = path.join(outDir, `voice-${stamp}-${Math.random().toString(36).slice(2, 6)}.wav`)
  try {
    await synth({ text: clean, outFile: wavFile, voice: useVoice, rate: useRate, volume: useVolume, pitch: usePitch })
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
  const conv = await toQqAudio({ wavFile, ffmpeg })
  if (conv.ok) {
    // ⚠️ 2026-11-04 18:47：转成 amr 了才删 wav；**没转成功时要留着 wav** ——
    //   因为要原样交给 NapCat 转（它自己带 ffmpeg），删了就没得发了 ✗
    if (conv.converted) { try { fs.unlinkSync(wavFile) } catch {} }
    return { ok: true, file: conv.file, format: conv.format }
  }
  return { ok: false, error: conv.error, wav: wavFile, spoken: true }
}

/** 发出去用的 CQ 码 */
export function toCQRecord(file) {
  const esc = String(file).replace(/&/g, '&amp;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/,/g, '&#44;')
  return `[CQ:record,file=${esc}]`
}
