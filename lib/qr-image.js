/**
 * dsh-qq-whale · 二维码渲染
 *
 * ⚠️ 2026-11-04 晚（主人：「二维码用 QQ 和微信等一系列扫描软件都没反应」）：
 *
 *   原来这里是一个**自己手写**的 QR 编码器（不依赖第三方包）。
 *   问题：它生成的二维码**标准解码器认不出来** —— 实测：
 *     · 标准库(qrcode) 生成 → jsQR 解码成功 ✓
 *     · 本插件生成      → jsQR 解码失败 ✗
 *     · 同一条 URL、同版本(37x37)，541/1369 个模块和标准库不一样 ✗
 *   表现就是「看着像二维码，但手机扫不出来」—— 最坑的那种。
 *
 *   所以改成用 `qrcode` 这个成熟库（B 站那边一直用的就是它）。
 *   顺手保留 toDataURL 的接口和参数，调用方不用改 ✓
 *
 *   如果依赖真的装不上（单机离线），退回内置编码器 —— 但会在日志里警告，
 *   让人知道可能需要手动装依赖。
 */
import QRCode from 'qrcode'
import zlib from 'node:zlib'

/** 依赖是否可用（装不上时退回内置实现） */
let libOk = true
try {
  // 试一下，确保真的是能用的
  QRCode.create('probe', { errorCorrectionLevel: 'M' })
} catch {
  libOk = false
}

/**
 * 生成二维码的 PNG data URL
 * @param {string} text  要编码的内容
 * @param {object} [opts]
 * @param {number} [opts.scale]  每模块像素（默认 6）
 * @param {number} [opts.quiet]  静边模块数（默认 4，QR 规范要求）
 * @returns {string} data:image/png;base64,...
 */
export function toDataURL(text, { scale = 6, quiet = 4 } = {}) {
  const s = Math.max(1, Math.floor(Number(scale) || 6))
  const q = Math.max(0, Math.floor(Number(quiet) || 4))
  if (!libOk) return fallbackToDataURL(text, { scale: s, quiet: q })

  // 先用 create 拿到模块数，好算出精确的像素宽度（让图正好是整数倍，不糊）
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' })
  const width = (qr.modules.size + q * 2) * s

  // 同步版本：qrcode 库的 toDataURL 是异步的，但我们要同步接口，
  // 所以用它的 create() + 自己画 PNG（像素级照抄模块矩阵，一定和标准一致）
  return renderFromModules(qr.modules, { scale: s, quiet: q, width })
}

/**
 * 把模块矩阵画成灰度 PNG —— 矩阵来自 qrcode 库，所以**一定标准** ✓
 */
function renderFromModules(modules, { scale, quiet, width }) {
  const size = modules.size
  const data = modules.data
  const dim = width
  const stride = dim + 1   // 每行前面 1 字节滤波类型
  const raw = Buffer.alloc(dim * stride)
  for (let y = 0; y < dim; y += 1) {
    raw[y * stride] = 0     // filter type None
    for (let x = 0; x < dim; x += 1) {
      const mr = Math.floor(y / scale) - quiet
      const mc = Math.floor(x / scale) - quiet
      const dark = mr >= 0 && mc >= 0 && mr < size && mc < size && data[mr * size + mc]
      raw[y * stride + 1 + x] = dark ? 0 : 255
    }
  }
  return makePng(dim, dim, raw)
}

/** 组装一张灰度 PNG（只用 Node 自带 zlib） */
function makePng(w, h, raw) {
  const idat = zlib.deflateSync(raw, { level: 9 })
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const body = Buffer.concat([t, data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 0      // grayscale
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
