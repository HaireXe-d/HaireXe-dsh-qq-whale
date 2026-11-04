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
  engine: 'tts',              // 'tts' | 'file'
  voice: 'Microsoft Huihui Desktop',
  rate: 0,                    // -10 ～ 10
  volume: 100,                // 0 ～ 100
  maxChars: 120,
  customFile: '',             // engine='file' 时要发的那段音频
}

const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.amr'])

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
 */
export function synthWav({ text, outFile, voice = '', rate = 0, volume = 100, psHost = 'powershell.exe', timeoutMs = 30_000 } = {}) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voice ? `try { $s.SelectVoice(${psQuote(voice)}) } catch { }` : ''}
$s.Rate = ${Number(rate) || 0}
try { $s.Volume = ${Math.max(0, Math.min(100, Number(volume) || 100))} } catch { }
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile(${psQuote(outFile)}, $fmt)
$s.Speak(${psQuote(text)})
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
 * wav → QQ 认的语音格式（amr）
 *
 * ⚠️ 2026-11-04 实测本机：剪映那份 ffmpeg **没有 amr 编码器、也没有 libmp3lame**
 *   （只有 aac / mp3_mf / opus）。QQ 语音条一般只认 silk / amr ✗
 *   所以转不出来就**不发**，并把原因说清楚 —— 宁可不发，也不发一个对方放不出声的文件 ✓
 */
export function toQqAudio({ wavFile, ffmpeg = null, timeoutMs = 30_000 } = {}) {
  const bin = ffmpeg ?? findFfmpeg()
  if (!bin) return Promise.resolve({ ok: false, error: '没找到 ffmpeg，语音发不了（要一个带 amr 编码器的版本）' })
  const amrOut = wavFile.replace(/\.wav$/i, '.amr')
  return new Promise((resolve) => {
    execFile(bin, ['-y', '-i', wavFile, '-ar', '8000', '-ac', '1', '-c:a', 'libopencore_amrnb', '-b:a', '12.2k', amrOut],
      { timeout: timeoutMs, windowsHide: true }, (err) => {
        if (!err && fs.existsSync(amrOut) && fs.statSync(amrOut).size > 100) {
          resolve({ ok: true, file: amrOut, format: 'amr' })
          return
        }
        try { if (fs.existsSync(amrOut)) fs.unlinkSync(amrOut) } catch {}
        resolve({
          ok: false,
          error: '这台机器的 ffmpeg 没带 amr 编码器，转不出 QQ 认的语音格式（wav 发过去对方放不出声）。'
            + '换一个带 libopencore_amrnb 的 ffmpeg，或者先用文字 ✓',
        })
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
export async function makeVoice({ text, outDir, opts = {}, synth = synthWav, ffmpeg = null } = {}) {
  const v = { ...VOICE_DEFAULTS, ...(opts ?? {}) }
  if (!v.enabled) return { ok: false, error: '语音功能是关着的（voice.enabled=false）' }
  if (process.platform !== 'win32') return { ok: false, error: '语音只做了 Windows 的 TTS，这台机器用不了' }

  // ① 用自己导入的音频
  if (v.engine === 'file') {
    if (!v.customFile || !fs.existsSync(v.customFile)) return { ok: false, error: '选了「用我自己的音频」，但还没导入文件（控制台里导一下）' }
    const conv = await toQqAudio({ wavFile: v.customFile.replace(/\.[^.]+$/, '.wav'), ffmpeg })
    // 导入的已经是 amr 就直接用
    if (path.extname(v.customFile).toLowerCase() === '.amr') return { ok: true, file: v.customFile, format: 'amr' }
    return conv.ok ? { ok: true, file: conv.file, format: conv.format } : { ok: false, error: conv.error, wav: v.customFile, spoken: true }
  }

  // ② TTS 现念
  const clean = String(text ?? '').trim()
  if (!clean) return { ok: false, error: '没有要念的文字' }
  if (clean.length > v.maxChars) return { ok: false, error: `太长（${clean.length} 字 > ${v.maxChars}），语音只念短的` }

  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const wavFile = path.join(outDir, `voice-${stamp}-${Math.random().toString(36).slice(2, 6)}.wav`)
  try {
    await synth({ text: clean, outFile: wavFile, voice: v.voice, rate: v.rate, volume: v.volume })
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
  const conv = await toQqAudio({ wavFile, ffmpeg })
  if (conv.ok) {
    try { fs.unlinkSync(wavFile) } catch {}
    return { ok: true, file: conv.file, format: conv.format }
  }
  return { ok: false, error: conv.error, wav: wavFile, spoken: true }
}

/** 发出去用的 CQ 码 */
export function toCQRecord(file) {
  const esc = String(file).replace(/&/g, '&amp;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/,/g, '&#44;')
  return `[CQ:record,file=${esc}]`
}
