/**
 * dsh-qq-whale · 表情包库（2026-11-04 主人要的）
 *
 * 主人的话：「碰到喜欢的表情包就存（一天最多存一个，没碰到喜欢的就不存），对话想发的时候就发」
 *
 * 规矩（一条条对应他的原话）：
 *   · **一天最多存一个** —— 按自然日算（跟别处的账本一致）
 *   · **没碰到喜欢的就不存** —— 存不下也不难过，不为了凑数硬收 ✓
 *   · **想发的时候就发** —— 发的时候从库里挑，挑不出来就不发（别硬塞）
 *
 * 存的是**文件**（NapCat 给的图片 URL / 本地路径），不是 URL —— URL 会过期 ✗
 * 库里记：id、存进来的时间、从谁那/哪条消息来的、大小、口味标签。
 *
 * 这个文件不 import DSH，也不发网络请求（下载图片由调用方传 download 进来）✓
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const STICKER_DEFAULTS = {
  enabled: true,
  perDay: 1,              // 一天最多存几个（主人定的 1）
  maxBytes: 8 * 1024 * 1024,
  sendChance: 0.15,       // 想发的时候掷一下：15% 的机会用表情包代替一句话
  dirName: 'qq-stickers',
}

const IMAGE_EXT = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function createStickerLibrary({ dshHome, opts = {} } = {}) {
  if (!dshHome) throw new Error('createStickerLibrary 需要 dshHome')
  const v = { ...STICKER_DEFAULTS, ...(opts ?? {}) }
  const root = path.join(dshHome, 'whale-channels', v.dirName)
  const indexFile = path.join(root, 'index.json')

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
      return { version: 1, items: Array.isArray(j.items) ? j.items : [] }
    } catch { return { version: 1, items: [] } }
  }

  function save(db) {
    fs.mkdirSync(root, { recursive: true })
    const tmp = `${indexFile}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, indexFile)
  }

  const today = (d = new Date()) => d.toLocaleDateString('sv-SE')

  /** 今天已经存了几个 */
  function countToday(now = new Date()) {
    const d = today(now)
    return load().items.filter((x) => String(x.at).slice(0, 10) === d).length
  }

  function canSave(now = new Date()) {
    if (!v.enabled) return { ok: false, reason: '表情包功能是关着的' }
    const n = countToday(now)
    if (n >= v.perDay) return { ok: false, reason: `今天已经存了 ${n} 个（一天最多 ${v.perDay} 个），明天再说` }
    return { ok: true }
  }

  /**
   * 存一个表情包。
   * @param {object} p
   * @param {Buffer|string} p.data   图片字节，或者已经落盘的路径
   * @param {string} [p.mime]
   * @param {string} [p.source]      从谁那弄来的（比如「主人发的」「评论区看到的」）
   * @param {string} [p.note]        为什么喜欢它（≥6 字，跟收藏视频一个判据）
   * @param {Date}   [p.now]
   */
  function saveSticker({ data, mime = 'image/gif', source = '', note = '', now = new Date() } = {}) {
    const gate = canSave(now)
    if (!gate.ok) return { ok: false, reason: gate.reason }
    const ext = IMAGE_EXT[String(mime).toLowerCase()] ?? null
    if (!ext) return { ok: false, reason: `不认识的图片类型：${mime}（只收 gif/png/jpg/webp）` }
    let buf
    try { buf = Buffer.isBuffer(data) ? data : fs.readFileSync(String(data)) } catch (e) {
      return { ok: false, reason: `读不到图片：${e?.message ?? e}` }
    }
    if (!buf || buf.length < 100) return { ok: false, reason: '图片太小，多半是坏的' }
    if (buf.length > v.maxBytes) return { ok: false, reason: `图太大了（${(buf.length / 1024 / 1024).toFixed(1)}MB > ${v.maxBytes / 1024 / 1024}MB）` }

    fs.mkdirSync(root, { recursive: true })
    const id = randomBytes(4).toString('hex')
    const file = path.join(root, `${id}.${ext}`)
    fs.writeFileSync(file, buf)

    const db = load()
    const item = {
      id,
      file,
      ext,
      bytes: buf.length,
      at: now.toISOString(),
      source: String(source).slice(0, 120),
      note: String(note).slice(0, 200),
    }
    db.items.push(item)
    save(db)
    return { ok: true, item, remainingToday: v.perDay - countToday(now) }
  }

  function list() { return load().items }

  /** 随机挑一个（挑不出来就返回 null，别硬塞） */
  function pickRandom(rand = Math.random) {
    const items = load().items.filter((x) => { try { return fs.existsSync(x.file) } catch { return false } })
    if (!items.length) return null
    return items[Math.floor(rand() * items.length) % items.length]
  }

  /** 想发的时候该不该用表情包代替一句话 */
  function shouldSend(rand = Math.random) {
    if (!v.enabled) return false
    if (!list().length) return false
    return rand() < v.sendChance
  }

  /** 删掉一个（文件也删） */
  function remove(id) {
    const db = load()
    const hit = db.items.find((x) => x.id === id)
    if (!hit) return null
    try { fs.unlinkSync(hit.file) } catch {}
    db.items = db.items.filter((x) => x.id !== id)
    save(db)
    return hit
  }

  return { root, indexFile, opts: v, canSave, countToday, saveSticker, list, pickRandom, shouldSend, remove }
}

/** 把文件发出去时用的 CQ 码（本地路径） */
export function toCQImage(file) {
  const esc = String(file).replace(/&/g, '&amp;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/,/g, '&#44;')
  return `[CQ:image,file=${esc}]`
}
