/**
 * dsh-qq-whale · 二维码渲染（不依赖第三方包）
 *
 * B 站那个包用的是 npm 的 qrcode；QQ 这个包不想再拉一个依赖
 * （link 安装下 pnpm 不会给它建 node_modules，加了也未必找得到 ✗）。
 * 所以这里自己生成 QR —— 只用 Node 自带的 zlib。
 *
 * 范围：字节模式（UTF-8）、纠错等级 M、版本 1–10（最多 213 字节）。
 * QQ 登录二维码 URL 一般 60–90 字节，够用 ✓
 *
 * 输错/超范围的二维码是「扫不出来」而不是「扫出别的东西」，所以宁可抛错也不硬凑 ✓
 */
import zlib from 'node:zlib'

// ── GF(256) 表 ──────────────────────────────────────────────────────
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** 生成多项式 ∏(x - α^i) */
function rsGenerator(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** 算纠错码字 */
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree)
  const rem = new Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem[0]
    rem.shift()
    rem.push(0)
    for (let i = 0; i < degree; i += 1) rem[i] ^= gfMul(gen[i + 1], factor)
  }
  return rem
}

// ── 版本表（纠错等级 M）─────────────────────────────────────────────
// 每行：[该版本总数据码字数, [{块数, 每块数据码字数, 每块纠错码字数}, ...]]
// ⚠️ 2026-11-04 的教训：块数不能瞎填（跟版本对不上），纠错码字数是每块的、不是总数。
//   这两个数错了，二维码图片看着像模像样、就是**扫不出来** ✗（最难发现的那种错）
//   数据取自 ISO/IEC 18004 表 9（M 级），版本 7–20 有 RS 分块，必须分开写。
const VERSIONS_M = {
  1: [16, [{ n: 1, d: 16, e: 10 }]],
  2: [28, [{ n: 1, d: 28, e: 16 }]],
  3: [44, [{ n: 1, d: 44, e: 26 }]],
  4: [64, [{ n: 2, d: 32, e: 18 }]],
  5: [86, [{ n: 2, d: 43, e: 24 }]],
  6: [108, [{ n: 4, d: 27, e: 16 }]],
  7: [124, [{ n: 4, d: 31, e: 18 }]],
  8: [154, [{ n: 2, d: 38, e: 22 }, { n: 2, d: 39, e: 22 }]],
  9: [182, [{ n: 3, d: 36, e: 22 }, { n: 2, d: 37, e: 22 }]],
  10: [216, [{ n: 4, d: 43, e: 26 }, { n: 1, d: 44, e: 26 }]],
  11: [254, [{ n: 1, d: 50, e: 30 }, { n: 4, d: 51, e: 30 }]],
  12: [290, [{ n: 6, d: 36, e: 22 }, { n: 2, d: 37, e: 22 }]],
  13: [334, [{ n: 8, d: 37, e: 22 }, { n: 1, d: 38, e: 22 }]],
  14: [365, [{ n: 4, d: 40, e: 24 }, { n: 5, d: 41, e: 24 }]],
  15: [415, [{ n: 5, d: 41, e: 24 }, { n: 5, d: 42, e: 24 }]],
  16: [453, [{ n: 7, d: 45, e: 28 }, { n: 3, d: 46, e: 28 }]],
  17: [507, [{ n: 10, d: 46, e: 28 }, { n: 1, d: 47, e: 28 }]],
  18: [563, [{ n: 9, d: 43, e: 26 }, { n: 4, d: 44, e: 26 }]],
  19: [627, [{ n: 3, d: 44, e: 26 }, { n: 11, d: 45, e: 26 }]],
  20: [669, [{ n: 3, d: 41, e: 26 }, { n: 13, d: 42, e: 26 }]],
}

function pickVersion(byteLen) {
  for (let v = 1; v <= 20; v += 1) {
    const lenBits = v <= 9 ? 8 : 16
    const needed = 4 + lenBits + byteLen * 8
    if (needed <= VERSIONS_M[v][0] * 8) return v
  }
  throw new Error(`二维码内容太长（${byteLen} 字节）`)
}

/** 按版本展开成逐块的 (数据码字数, 纠错码字数) */
function blockLayout(v) {
  const out = []
  for (const group of VERSIONS_M[v][1]) {
    for (let i = 0; i < group.n; i += 1) out.push({ data: group.d, ec: group.e })
  }
  return out
}

// ── 功能图形的位置（用来留空） ────────────────────────────────────────
function alignmentPositions(v) {
  if (v === 1) return []
  const size = v * 4 + 17
  const step = v < 7 ? 8 : (v < 14 ? 16 : 24)   // 简化：1–10 用这两档
  const count = Math.floor((size - 13) / step) + 1
  const pos = [6]
  for (let i = 1; i < count; i += 1) pos.push(size - 7 - (count - 1 - i) * step)
  return pos
}

function reservedMask(v) {
  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Array(size).fill(false))
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = true }
  // 三个定位图形 + 分隔符
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(r0 + r, c0 + c)
  }
  // 定位线
  for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6) }
  // 校正图形
  const ap = alignmentPositions(v)
  for (const r of ap) for (const c of ap) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc)
  }
  // 格式信息
  for (let i = 0; i < 9; i += 1) { mark(8, i); mark(i, 8) }
  for (let i = 0; i < 8; i += 1) { mark(8, size - 1 - i); mark(size - 1 - i, 8) }
  mark(size - 8, 8)
  // 版本信息（版本 ≥ 7）
  if (v >= 7) {
    for (let i = 0; i < 6; i += 1) for (let j = 0; j < 3; j += 1) {
      mark(size - 11 + j, i)
      mark(i, size - 11 + j)
    }
  }
  return m
}

// ── 主函数 ──────────────────────────────────────────────────────────
export function encodeQR(text, { mask = null } = {}) {
  const data = Buffer.from(String(text), 'utf8')
  const v = pickVersion(data.length)
  const size = v * 4 + 17

  // 1. 比特流
  const bits = []
  const push = (value, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1) }
  push(0b0100, 4)                       // 字节模式
  push(data.length, v <= 9 ? 8 : 16)
  for (const b of data) push(b, 8)

  const capacity = VERSIONS_M[v][0] * 8
  const terminator = Math.min(4, capacity - bits.length)
  push(0, terminator)
  while (bits.length % 8 !== 0) bits.push(0)
  const dataBytes = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j]
    dataBytes.push(byte)
  }
  for (let pad = 0; dataBytes.length < VERSIONS_M[v][0]; pad += 1) dataBytes.push(pad % 2 === 0 ? 0xec : 0x11)

  // 2. 分块 + 纠错 + 交织
  const layout = blockLayout(v)
  const blocks = []
  let offset = 0
  for (const spec of layout) {
    const chunk = dataBytes.slice(offset, offset + spec.data)
    offset += spec.data
    blocks.push({ data: chunk, ec: rsRemainder(chunk, spec.ec) })
  }
  const final = []
  const maxData = Math.max(...blocks.map((b) => b.data.length))
  for (let i = 0; i < maxData; i += 1) for (const b of blocks) if (i < b.data.length) final.push(b.data[i])
  const maxEc = Math.max(...blocks.map((b) => b.ec.length))
  for (let i = 0; i < maxEc; i += 1) for (const b of blocks) if (i < b.ec.length) final.push(b.ec[i])

  // 3. 放图形
  const reserved = reservedMask(v)
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFunction = (r, c) => reserved[r][c]

  // 定位图形
  const drawFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) {
      const rr = r0 + r; const cc = c0 + c
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
      modules[rr][cc] = inRing || inCore
    }
  }
  drawFinder(0, 0); drawFinder(0, size - 7); drawFinder(size - 7, 0)

  // 校正图形
  for (const r of alignmentPositions(v)) for (const c of alignmentPositions(v)) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
      const ring = Math.max(Math.abs(dr), Math.abs(dc))
      modules[r + dr][c + dc] = ring !== 1
    }
  }

  // 定位线
  for (let i = 8; i < size - 8; i += 1) {
    modules[6][i] = i % 2 === 0
    modules[i][6] = i % 2 === 0
  }

  // 暗模块
  modules[size - 8][8] = true

  // 4. 数据位
  let bitIndex = 0
  const nextBit = () => {
    if (bitIndex >= final.length * 8) return 0
    const byte = final[bitIndex >> 3]
    const bit = (byte >>> (7 - (bitIndex & 7))) & 1
    bitIndex += 1
    return bit
  }
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1        // 跳过定位线那一列
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i
      for (let k = 0; k < 2; k += 1) {
        const c = col - k
        if (isFunction(row, c)) continue
        modules[row][c] = nextBit() === 1
      }
    }
    upward = !upward
  }

  // 5. 掩码（固定掩码 0，格式信息里写清楚，扫得出来）
  const chosen = mask ?? 0
  const applyMask = (m) => {
    for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
      if (isFunction(r, c)) continue
      const on = maskFn(chosen, r, c)
      if (on) m[r][c] = !m[r][c]
    }
  }
  applyMask(modules)

  // 6. 格式信息（纠错等级 M = 00，掩码 3 位）
  const ecBits = 0b00
  const fmtData = (ecBits << 3) | chosen
  let rem = fmtData
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537)
  const fmt = ((fmtData << 10) | rem) ^ 0x5412
  const bitAt = (n) => ((fmt >>> n) & 1) === 1

  // 左上
  const fmtPosA = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  fmtPosA.forEach(([r, c], i) => { modules[r][c] = bitAt(14 - i) })
  // 右上 + 左下
  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bitAt(14 - i)
  for (let i = 0; i < 7; i += 1) modules[size - 1 - i][8] = bitAt(6 - i)
  modules[size - 8][8] = true

  // 7. 版本信息（版本 ≥ 7）
  if (v >= 7) {
    let vr = v
    for (let i = 0; i < 12; i += 1) vr = (vr << 1) ^ (((vr >>> 11) & 1) * 0x1f25)
    const ver = (v << 12) | vr
    for (let i = 0; i < 18; i += 1) {
      const bit = ((ver >>> i) & 1) === 1
      const r = Math.floor(i / 3)
      const c = i % 3
      modules[size - 11 + c][r] = bit
      modules[r][size - 11 + c] = bit
    }
  }

  return { size, modules, version: v }
}

function maskFn(id, r, c) {
  switch (id) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }
}

/**
 * 渲染成 PNG data URL（前端直接塞 <img src>）。
 * 不引第三方库：手写最小的 PNG 编码 + Node 自带 zlib ✓
 */
export function toDataURL(text, { scale = 6, quiet = 4, mask = null } = {}) {
  const { size, modules } = encodeQR(text, { mask })
  const dim = (size + quiet * 2) * scale
  // 灰度 8 位：黑 = 0，白 = 255
  const raw = Buffer.alloc((dim + 1) * dim)
  for (let y = 0; y < dim; y += 1) {
    raw[y * (dim + 1)] = 0        // filter type 0
    for (let x = 0; x < dim; x += 1) {
      const mr = Math.floor(y / scale) - quiet
      const mc = Math.floor(x / scale) - quiet
      const black = mr >= 0 && mc >= 0 && mr < size && mc < size && modules[mr][mc]
      raw[y * (dim + 1) + 1 + x] = black ? 0 : 255
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 })

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(dim, 0)
  ihdr.writeUInt32BE(dim, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 0      // grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
