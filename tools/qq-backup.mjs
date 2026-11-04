#!/usr/bin/env node
/**
 * dsh-qq-whale · 备份 / 复活
 *
 * 2026-11-04 主人：「还有 QQ 养鱼的记忆备份复活功能和定期换上下文功能」
 *
 * 照着 B 站 tools/commands/backup.mjs 的做法（白名单 + 原结构 + 不删不覆盖），
 * 但**多考虑一件事**：一条鱼两个入口共用同一份记忆 ——
 *   日记 ~/.dsh/whale-diary.md
 *   人设 ~/.bili-ai/persona.md
 *   对话全文 ~/.dsh/sessions/
 * 所以 QQ 这份备份**必须把共用的东西也带上**，否则在另一台机器上「复活」出来的是个失忆的她 ✓
 *
 * 用法：
 *   node tools/qq-backup.mjs                 备份（默认到桌面「邦邦的备份」）
 *   node tools/qq-backup.mjs --to <目录>     指定目录
 *   node tools/qq-backup.mjs --dry           只列要拷什么
 *   node tools/qq-backup.mjs --restore --from <目录> --dry|--go
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || '/'
const DSH = process.env.DSH_HOME || path.join(HOME, '.dsh')
const AI = path.join(HOME, '.bili-ai')

/**
 * 白名单：源 → 备份包里的相对路径
 * 恢复时按同一张表反过来拷回去，所以两边永远对得上 ✓
 */
const FILES = [
  // ── 她是谁（两个入口共用，**必须带**）──
  [path.join(AI, 'persona.md'), 'bili-ai/persona.md'],

  // ── 记忆（两个入口共用）──
  [path.join(DSH, 'whale-diary.md'), 'dsh/whale-diary.md'],
  [path.join(DSH, 'whale-diary-private.md'), 'dsh/whale-diary-private.md'],
  [path.join(DSH, 'whale-rules.md'), 'dsh/whale-rules.md'],

  // ── 共享的设置和"她现在在哪个对话"（2026-11-04 晚补）──
  //   ⚠️ 这两个不带上，恢复之后会出现：
  //     · 作息/口味回到默认（B站 改过的没了）
  //     · 换了个新对话 id → 她"忘了刚才聊到哪"
  //   都属于"复活了但不像原来那个人" ✗
  [path.join(DSH, 'whale-habits.json'), 'dsh/whale-habits.json'],
  [path.join(DSH, 'whale-body.json'), 'dsh/whale-body.json'],
  [path.join(DSH, 'whale-session.json'), 'dsh/whale-session.json'],

  // ── B 站那边的（两个入口一起用时才有，没有就跳过）──
  //   主人问「和哔站养鱼在桌面创建一个备份」——
  //   既然一份备份代表"整条鱼"，B 站的登录状态和设置也得在里面 ✓
  [path.join(DSH, 'bili-whale.config.json'), 'dsh/bili-whale.config.json'],
  [path.join(AI, 'credentials.json'), 'bili-ai/credentials.json'],
  [path.join(AI, 'quota.json'), 'bili-ai/quota.json'],
  [path.join(AI, 'dm-await-state.json'), 'bili-ai/dm-await-state.json'],

  // ── QQ 自己的设置 ──
  //   ⚠️ 2026-11-04 修：备份包的相对路径必须和源路径结构**完全一致**，
  //     否则恢复时会拷到错的位置（这里原来少了 channels/ 这一层，
  //     结果 QQ 设置"复活丢了"，而日记好好的 —— 最难查的那种 ✗）
  [path.join(DSH, 'whale-channels', 'channels', 'qq.json'), 'dsh/whale-channels/channels/qq.json'],
  [path.join(DSH, 'whale-channels', 'index.json'), 'dsh/whale-channels/index.json'],
  [path.join(DSH, 'whale-channels', 'shared.json'), 'dsh/whale-channels/shared.json'],

  // ── QQ 的运行时状态（换机器后接着用，不用重新登录）──
  [path.join(DSH, 'whale-channels', 'qq-state.json'), 'dsh/whale-channels/qq-state.json'],
  [path.join(DSH, 'whale-channels', 'qq-wake-state.json'), 'dsh/whale-channels/qq-wake-state.json'],
  [path.join(DSH, 'whale-channels', 'qq-night-state.json'), 'dsh/whale-channels/qq-night-state.json'],
  [path.join(DSH, 'whale-channels', 'qq-pending.json'), 'dsh/whale-channels/qq-pending.json'],

  // ── 她写过的东西 ──
  //   ⚠️ 2026-11-04：whale-work 里还会混进调试脚本（atcheck/check-* 这些 .mjs），
  //     那是排查时留下的垃圾，**不该进备份包** —— 所以这里按扩展名和白名单过滤，
  //     只备她真正写的东西（回复草稿、临时图、语音草稿）✓
  [path.join(DSH, 'whale-work'), 'dsh/whale-work'],
]

/**
 * whale-work 里**只备份她真正写的东西**（白名单比黑名单靠谱）。
 *
 * 之前用"排除调试脚本"的黑名单，结果还剩 dm-dump / dmcheck / dyn1 / wbi 这些没排掉 ✗
 * 改成白名单：只留文档、图片、语音、数据，其它（.mjs/.ps1/.bat 这类工具脚本）一律不备 ✓
 */
const WORK_KEEP = [
  /\.(md|txt|json)$/i,          // 草稿、笔记、清单
  /\.(png|jpe?g|gif|webp)$/i,   // 她存的图
  /\.(wav|mp3|silk|amr|ogg)$/i, // 语音草稿
]

/** 目录型条目：整份拷（但排除缓存/临时文件） */
const DIRS = [
  { src: path.join(DSH, 'sessions'), rel: '记忆/sessions', note: '对话全文', exclude: [] },
]

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[argv[i].slice(2)] = true
    else { opt[argv[i].slice(2)] = v; i += 1 }
  }
}

const DRY = !!opt.dry
const GO = !!opt.go
const FROM = opt.from ? path.resolve(String(opt.from)) : null
const TO = opt.to ? path.resolve(String(opt.to)) : path.join(HOME, 'Desktop', '邦邦的备份')

const log = (s = '') => console.log(s)

function sizeOf(p) {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return st.size
    let n = 0
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name)
      n += e.isDirectory() ? sizeOf(f) : (fs.statSync(f).size || 0)
    }
    return n
  } catch { return 0 }
}

const human = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** 目录拷贝（带白名单）：whale-work 那种混杂目录用它，只留她真正写的东西 */
function copyDirFiltered(src, dst, keep) {
  fs.mkdirSync(dst, { recursive: true })
  let n = 0
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) {
      n += copyDirFiltered(path.join(src, e.name), path.join(dst, e.name), keep)
      continue
    }
    if (!keep.some((re) => re.test(e.name))) continue
    // 回复草稿发出去就没用了，留着只是噪音
    if (/^dm-reply.*\.txt$/i.test(e.name)) continue
    fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name))
    n += 1
  }
  return n
}

function doBackup() {
  log(`[backup] 备份到：${TO}${DRY ? '   (只看不拷)' : ''}`)
  log('')
  log('  她是谁（两个入口共用）：')
  log('  记忆（两个入口共用）：')
  log('  QQ 自己的：')
  log('')
  let n = 0
  let miss = 0
  let bytes = 0

  log('  ── 她是谁 / 记忆 ──')
  for (const [src, rel] of FILES.slice(0, 4)) {
    if (!fs.existsSync(src)) { log(`    –  ${rel}（还没有，跳过）`); miss += 1; continue }
    const dst = path.join(TO, rel)
    const sz = sizeOf(src)
    bytes += sz
    if (!DRY) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true }) }
    log(`    ✓  ${rel}   ${human(sz)}`)
    n += 1
  }

  log('  ── QQ 自己的设置与状态 ──')
  for (const [src, rel] of FILES.slice(4)) {
    if (!fs.existsSync(src)) {
      // ⚠️ 2026-11-04：qq.json 是**第一次保存设置**时才写盘的（core 读取时用默认值兜底，
      //   所以设置页照样能看，但文件不存在）。
      //   全新机器上"装完就备份"会遇到这种情况 —— 那就**现场写一份默认的进去**，
      //   别让恢复出来的人发现 QQ 设置整个丢了 ✓
      if (path.basename(src) === 'qq.json' && !DRY) {
        const dst = path.join(TO, rel)
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.writeFileSync(dst, JSON.stringify({
          note: '这是备份时补的默认配置（原机还没保存过设置）',
          owner: { uin: '', nickname: '' },
          self: { uin: '', nickname: '' },
        }, null, 2) + '\n', 'utf8')
        log(`    +  ${rel}（原本不存在，补了一份默认的）`)
        n += 1
        continue
      }
      log(`    –  ${rel}（还没有，跳过）`); miss += 1; continue
    }
    const dst = path.join(TO, rel)
    const sz = sizeOf(src)
    bytes += sz
    const isWorkDir = path.basename(src) === 'whale-work'
    if (!DRY) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      // ⚠️ 2026-11-04 晚（主人：「不要改动邦邦的备份，直接使用邦邦的备份」）：
      //   现在 QQ 备份写进的是**同一个**「邦邦的备份」目录 —— 那里已经有内容了。
      //   覆盖前先把旧的留一份到 .previous/ ，万一新备份有问题还能找回 ✓
      if (fs.existsSync(dst) && fs.statSync(dst).isFile()) {
        const prevDir = path.join(TO, '.previous', new Date().toISOString().slice(0, 10))
        fs.mkdirSync(prevDir, { recursive: true })
        try { fs.copyFileSync(dst, path.join(prevDir, rel.replace(/[\\/]/g, '__'))) } catch { /* 留不下就算了 */ }
      }
      if (isWorkDir && fs.statSync(src).isDirectory()) copyDirFiltered(src, dst, WORK_KEEP)
      else fs.cpSync(src, dst, { recursive: true })
    }
    log(`    ✓  ${rel}   ${human(sz)}${isWorkDir ? '   （已滤掉调试脚本）' : ''}`)
    n += 1
  }

  for (const d of DIRS) {
    if (!fs.existsSync(d.src)) { log(`    –  ${d.rel}（${d.note}，还没有）`); miss += 1; continue }
    const dst = path.join(TO, d.rel)
    const sz = sizeOf(d.src)
    bytes += sz
    if (!DRY) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(d.src, dst, { recursive: true }) }
    log(`    ✓  ${d.rel}   ${human(sz)}   ← ${d.note}`)
    n += 1
  }

  // 写一份说明，别人拿到这个目录也知道怎么复活
  if (!DRY) {
    const readme = path.join(TO, '怎么复活她.md')
    fs.mkdirSync(TO, { recursive: true })
    fs.writeFileSync(readme, `# 怎么复活她

> 最后备份：${new Date().toLocaleString('zh-CN')}

## 这是什么

一条鱼的完整备份 —— 包括她是谁、记得什么、QQ 这边怎么配的。

## 怎么复活

1. 装好 DSH 和 NapCat（QQ 那边需要）
2. 装插件：

   \`\`\`
   git clone https://github.com/HaireXe-d/dsh-qq-whale
   cd dsh-qq-whale && node install.mjs
   \`\`\`

3. 把这份备份恢复回去：

   \`\`\`
   node tools/qq-backup.mjs --restore --from "<这个目录>" --dry   # 先看要动哪些
   node tools/qq-backup.mjs --restore --from "<这个目录>" --go    # 真恢复
   \`\`\`

4. 启动 NapCat，再启动 DSH

## 里面是什么

| 路径 | 是什么 |
|---|---|
| \`bili-ai/persona.md\` | 她是谁（**两个入口共用这一份**） |
| \`dsh/whale-diary.md\` | 日记（**两个入口共用**） |
| \`dsh/whale-diary-private.md\` | 私密日记（同上） |
| \`dsh/whale-rules.md\` | 规则和改动记录 |
| \`dsh/whale-channels/qq.json\` | QQ 的设置 |
| \`dsh/whale-channels/*-state.json\` | 运行时状态（登录、待审、作息计数） |
| \`dsh/whale-work/\` | 她写过的东西 |
| \`记忆/sessions/\` | 对话全文 |

> ⚠️ 这份备份里有你的 QQ 登录状态和她的日记，**别传到公开的地方**。
`, 'utf8')
    log('')
    log(`    ✓  怎么复活她.md（说明书）`)
  }

  log('')
  log(`[backup] ${DRY ? '预演完成（什么都没拷）' : '完成'}：${n} 项 · ${human(bytes)}${miss ? ` · 缺 ${miss} 项（见上面 – 的）` : ''}`)
  if (!DRY) {
    log('')
    log(`  备份位置：${TO}`)
    log('  ⚠️ 里面有登录状态和日记，别传到公开的地方')
  }
}

function doRestore() {
  if (!FROM) { console.error('用法：node tools/qq-backup.mjs --restore --from <备份目录> --dry|--go'); process.exit(2) }
  if (!fs.existsSync(FROM)) { console.error('备份目录不存在：' + FROM); process.exit(2) }
  if (!DRY && !GO) {
    console.error('[restore] 为安全起见必须加 --go 才会真的写文件。\n          先跑一次 --dry 看看会动哪些：')
    console.error(`          node tools/qq-backup.mjs --restore --from "${FROM}" --dry`)
    process.exit(2)
  }

  log(`[restore] 从：${FROM}`)
  log(`[restore] 到：${HOME}${DRY ? '   (只看不写)' : ''}`)
  log('')

  let n = 0
  let skip = 0
  for (const [target, rel] of FILES) {
    const src = path.join(FROM, rel)
    if (!fs.existsSync(src)) { log(`    –  ${rel}（备份里没有，跳过）`); skip += 1; continue }
    const exists = fs.existsSync(target)
    if (!DRY) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(src, target, { recursive: true, force: true }) }
    log(`    ✓  ${rel} → ${target}${exists ? '   （覆盖）' : '   （新建）'}`)
    n += 1
  }

  // 对话全文：默认**不覆盖** —— 目标机器上可能已经有一份更新的
  const sessSrc = path.join(FROM, '记忆', 'sessions')
  if (fs.existsSync(sessSrc)) {
    log('')
    log('    ·  记忆/sessions/（对话全文）**不自动覆盖**')
    log(`       目标机器上可能已经有更新的记录，硬拷会丢东西 ✗`)
    log(`       确实要的话手动拷：${sessSrc}`)
    log(`                    → ${path.join(DSH, 'sessions')}`)
  }

  log('')
  log(`[restore] ${DRY ? '预演完成' : '完成'}：${n} 项${skip ? ` · 跳过 ${skip} 项` : ''}`)
  if (!DRY && n > 0) {
    log('')
    log('下一步：')
    log('  1) 完整退出 DSH（托盘也要退）再启动')
    log('  2) 打开 设置 →「养鱼 · QQ」，确认还是登着的（不是就点「扫码登录」）')
    log('  3) 跟她聊一句，看她记不记得以前的事')
  }
}

if (FROM || opt.restore) doRestore()
else doBackup()
