/**
 * 2026-11-04 18:42 · 图片落地（把主人发的图下载到本地，交给我看）
 *
 * 为什么单独一个模块：
 *   `poller.js` 要保持**纯解析**（不发网络请求，好测）。
 *   而图片必须下载下来才能看 —— 这一步单独放这儿，注入一个 fetch 实现就能测 ✓
 *
 * 三条规矩：
 *   ① **下载失败不能把消息弄丢** —— 文字照常投，只在末尾注明「图没下下来」
 *   ② 文件名要防冲突，也防路径穿越（NapCat 给的 file 名不可信）
 *   ③ 落盘之后要能被 read_image 认出来 —— **按文件头判真实格式**，
 *      不信扩展名（18:38 那张就是 .jpg 名字、GIF89a 头 ✗）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** 按文件头判图片格式（不信扩展名） */
export function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return null
  const b = buf
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  // GIF: 47 49 46 38
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  // WebP: RIFF .... WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  // BMP
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  return null
}

/**
 * 把一条消息里的图片下载到 outDir。
 *
 * @param {object} p
 * @param {Array<{url:string,file:string,summary:string}>} p.images
 * @param {string} p.outDir
 * @param {Function} [p.fetchImpl]  注入（默认用全局 fetch）
 * @param {number} [p.maxBytes]     单张上限（默认 8MB，跟表情包库一致）
 * @param {Function} [p.log]
 * @returns {Promise<Array<{ok:boolean, path?:string, ext?:string, summary?:string, error?:string}>>}
 */
export async function saveIncomingImages({
  images = [],
  outDir,
  fetchImpl = globalThis.fetch,
  maxBytes = 8 * 1024 * 1024,
  log = () => {},
} = {}) {
  const out = []
  if (!Array.isArray(images) || images.length === 0) return out
  fs.mkdirSync(outDir, { recursive: true })

  for (const img of images) {
    try {
      if (!img?.url) { out.push({ ok: false, error: '没有可下载的 url', summary: img?.summary }); continue }
      const r = await fetchImpl(img.url)
      if (!r || r.ok === false) { out.push({ ok: false, error: `下载失败 HTTP ${r?.status ?? '?'}`, summary: img.summary }); continue }
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 32) { out.push({ ok: false, error: '图太小，多半是坏的', summary: img.summary }); continue }
      if (buf.length > maxBytes) { out.push({ ok: false, error: `图太大 ${(buf.length / 1048576).toFixed(1)}MB`, summary: img.summary }); continue }

      const ext = sniffImageExt(buf) ?? 'bin'
      // ⚠️ 文件名只用随机串 —— NapCat 给的 file 不可信（可能有路径分隔符）
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
      const file = path.join(outDir, name)
      fs.writeFileSync(file, buf)
      out.push({ ok: true, path: file, ext, bytes: buf.length, summary: img.summary ?? '' })
    } catch (e) {
      log(`[qq] 图片下载出错：${e?.message ?? e}`)
      out.push({ ok: false, error: String(e?.message ?? e).slice(0, 120), summary: img?.summary })
    }
  }
  return out
}
