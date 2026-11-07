/**
 * dsh-whale-core · 自动备份（2026-11-04 晚）
 *
 * 主人要求：「别人下载这两个库之后运行、新建一个人格后，桌面会出现一个备份」
 *
 * 之前备份**只能手动点按钮 / 敲命令**。新用户装完、写了人格，
 * 桌面上什么都没有 —— 万一那台机器出问题，刚写的人格就没了 ✗
 *
 * 这个模块做的事：
 *   · 第一次检测到"有人格了"（~/.bili-ai/persona.md 有内容）
 *     且桌面上还没有备份 → **自动创建一份**
 *   · 之后人格再改，也只是**更新**那份备份（不新建目录）
 *   · 节流：同一份内容不重复备份（比较 persona 的 mtime + 大小）
 *
 * 设计上刻意保守：
 *   · 只在**内容真的变了**的时候写
 *   · 目录固定「邦邦的备份」，和手动备份同一个地方（一条鱼一份备份）✓
 *   · 失败不抛错（备份失败不该影响插件本身）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BACKUP_DIR_NAME = '邦邦的备份'

/**
 * 备份目录叫什么。
 *
 * ⚠️ 2026-11-04 晚（主人：「不需要『邦邦的备份』，直接是他创建那个人格名字的备份就行」）：
 *   原来固定叫「邦邦的备份」——那是主人这条鱼的名字，别人装了会跟着叫邦邦 ✗
 *   现在：**用这个人格自己的名字**。
 *     · 人格名字 = 设置里 persona.name（B站 / 共享习惯里那个）
 *     · 拿不到名字 → 退回「她的备份」（而不是硬编码某条鱼的名字）
 *   主人那条鱼名字就叫"邦邦"，所以他的目录仍然叫「邦邦的备份」✓
 */
export function backupDirName({ home = os.homedir(), name = '' } = {}) {
  const n = String(name ?? '').trim()
  // 名字里不能有路径分隔符之类的字符（Windows 文件名规则）
  const safe = n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
  if (safe) return `${safe}的备份`
  return '她的备份'
}

/** 备份到哪儿（桌面） */
export function backupDir(home = os.homedir(), name = '') {
  return path.join(home, 'Desktop', backupDirName({ home, name }))
}

/**
 * 白名单：源（相对 HOME）→ 备份包里的相对路径
 * ⚠️ 和 B站/QQ 各自的手动备份保持一致 —— 一处改了要同步改那边
 */
export const AUTO_BACKUP_FILES = [
  ['.bili-ai/persona.md', 'bili-ai/persona.md'],
  ['.dsh/whale-diary.md', 'dsh/whale-diary.md'],
  ['.dsh/whale-diary-private.md', 'dsh/whale-diary-private.md'],
  ['.dsh/whale-rules.md', 'dsh/whale-rules.md'],
  ['.dsh/whale-habits.json', 'dsh/whale-habits.json'],
  ['.dsh/whale-body.json', 'dsh/whale-body.json'],
  ['.dsh/bili-whale.config.json', 'dsh/bili-whale.config.json'],
  ['.bili-ai/credentials.json', 'bili-ai/credentials.json'],
  ['.dsh/whale-channels/channels/qq.json', 'dsh/whale-channels/channels/qq.json'],
  ['.dsh/whale-channels/index.json', 'dsh/whale-channels/index.json'],
  ['.dsh/whale-channels/shared.json', 'dsh/whale-channels/shared.json'],
]

/** 备份目录里的"上次备份标记" —— 用来判断要不要再备一次 */
const STAMP = '.last-auto-backup.json'

function readJsonSafe(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

/**
 * 人格的指纹：mtime + 大小。变了才备份。
 *
 * ⚠️⚠️ 2026-11-04 19:33 **今晚把主人人设覆盖掉的那次就是从这里来的**：
 *
 *   17:31:34 有人把 persona.md 写成了 12 字节（就四个字「测试人格」）。
 *   这个模块看见「人格改过了」，就把那份 **12 字节**的当成新人格，
 *   覆盖进了桌面的备份 —— 于是「活文件」和「备份」两边一起变成坏的 ✗
 *
 *   备份的职责是**防丢**，不是**跟着改**。人格被别人（或自己）误写成垃圾时，
 *   备份应该**挡住**它，而不是陪着一起烂。
 *
 *   现在加了保命闸：
 *     · 小于 MIN_PERSONA_BYTES 的 —— **不算人格**，拒绝备份，并保留旧备份 ✓
 *     · 比上一份少了 MAX_SHRINK_RATIO 以上 —— 大概率是被清空/截断，同样拒绝 ✓
 *       （真想大幅改人设时，先手动备份一次，或者删掉 .last-auto-backup.json 再让它备）
 */
const MIN_PERSONA_BYTES = 200
const MAX_SHRINK_RATIO = 0.5     // 比上次少了一半以上就当成事故

function personaStamp(home) {
  const p = path.join(home, '.bili-ai', 'persona.md')
  try {
    const st = fs.statSync(p)
    if (!st.isFile()) return null
    return { mtime: st.mtimeMs, size: st.size }
  } catch { return null }
}

/**
 * 该不该自动备份？
 * @param {object} p
 * @param {string} [p.home]
 * @param {string} [p.name]  人格名字（决定目录名）
 * @returns {{ needed: boolean, reason: string, exist: boolean, dir: string }}
 */
export function autoBackupState({ home = os.homedir(), name = '' } = {}) {
  const dir = backupDir(home, name)
  const stamp = personaStamp(home)
  if (!stamp) return { needed: false, reason: '还没有人格（persona.md 不存在）', exist: false, dir }
  const exist = fs.existsSync(dir)
  const last = readJsonSafe(path.join(dir, STAMP))
  if (!exist) {
    // ⚠️ 2026-11-04：连脏数据都不放过 —— 桌面上没备份时才建，
    //   但如果人格本身小得不像话（被误写成几个字），宁可**不建**，也别拿垃圾开局 ✓
    if (stamp.size < MIN_PERSONA_BYTES) {
      return { needed: false, reason: `人格只有 ${stamp.size} 字节，太小了不像人设，先不备份（防误写）`, exist: false, dir }
    }
    return { needed: true, reason: `桌面上还没有「${path.basename(dir)}」`, exist: false, dir }
  }
  if (!last) return { needed: true, reason: '有备份目录但没有标记（可能是手动备份留下的）', exist: true, dir }
  if (last.personaMtime !== stamp.mtime || last.personaSize !== stamp.size) {
    // ⚠️ 2026-11-04 19:33 保命闸：这就是今晚人设被覆盖的那条路。
    //   备份要**挡住**被误写的垃圾，不能陪着一起烂 ✗
    if (stamp.size < MIN_PERSONA_BYTES) {
      return {
        needed: false,
        reason: `人格被改成了 ${stamp.size} 字节（正常至少 ${MIN_PERSONA_BYTES}），像是被误写 —— 拒绝覆盖备份`,
        exist: true,
        dir,
        blocked: true,
      }
    }
    const prevSize = Number(last.personaSize) || 0
    if (prevSize > 0 && stamp.size < prevSize * MAX_SHRINK_RATIO) {
      return {
        needed: false,
        reason: `人格从 ${prevSize} 字节掉到 ${stamp.size}（少了一半以上），像是被截断 —— 拒绝覆盖备份`,
        exist: true,
        dir,
        blocked: true,
      }
    }
    return { needed: true, reason: '人格改过了', exist: true, dir }
  }
  return { needed: false, reason: '人格没变，不用重复备份', exist: true, dir }
}

/**
 * 真的做一次自动备份。
 *
 * ⚠️ 只**新增/更新**白名单里的文件，不删除备份目录里任何已有的东西 ——
 *   主人那个目录里还有 插件修复/、约定速查.md 等，
 *   绝不能被这条自动逻辑弄丢 ✗
 *
 * @returns {{ ok: boolean, dir: string, copied: number, reason: string }}
 */
export function runAutoBackup({ home = os.homedir(), name = '', log = () => {} } = {}) {
  const state = autoBackupState({ home, name })
  if (!state.needed) return { ok: true, dir: state.dir, copied: 0, reason: state.reason }

  const dir = state.dir
  let copied = 0
  try {
    fs.mkdirSync(dir, { recursive: true })
    for (const [srcRel, dstRel] of AUTO_BACKUP_FILES) {
      const src = path.join(home, srcRel)
      if (!fs.existsSync(src)) continue
      const dst = path.join(dir, dstRel)
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      // 目录（whale-work）整份拷；文件直接拷
      const st = fs.statSync(src)
      if (st.isDirectory()) fs.cpSync(src, dst, { recursive: true })
      else fs.copyFileSync(src, dst)
      copied += 1
    }
    // 记标记，下次同样内容就不再重复
    const stamp = personaStamp(home)
    fs.writeFileSync(path.join(dir, STAMP), JSON.stringify({
      at: new Date().toISOString(),
      personaMtime: stamp?.mtime ?? 0,
      personaSize: stamp?.size ?? 0,
      copied,
      reason: state.reason,
    }, null, 2) + '\n', 'utf8')
    log(`[whale] 已自动备份 ${copied} 项到 ${dir}（${state.reason}）`)
    return { ok: true, dir, copied, reason: state.reason }
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 200)
    log(`[whale] 自动备份失败（不影响使用）：${msg}`)
    return { ok: false, dir, copied, reason: msg }
  }
}
