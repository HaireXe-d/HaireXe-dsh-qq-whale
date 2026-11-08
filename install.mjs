#!/usr/bin/env node
/**
 * install.mjs -- 把「养鱼 · QQ」装进 DSH
 *
 * 用法：  node install.mjs
 *
 * 这个包可以**单独下载安装**。
 *   它依赖 whale-core（两个鱼共用的框架），脚本会先检查；缺了会告诉你装什么。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = 'dsh-qq-whale'
const DSH = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE = process.env.DSH_PROFILE || 'desktop'
const PLUGIN_DIR = process.env.DSH_PLUGIN_DIR || path.join(DSH, 'plugins')
const PROFILE_DIR = path.join(DSH, 'profiles', PROFILE)

const say = (s = '') => console.log(s)
const die = (s) => { console.error('\n  [X] ' + s + '\n'); process.exit(1) }

// ⚠️ 2026-11-04 晚（主人：「dsh-qq-whale-setup 为什么不放到 dsh-qq-whale 里面」）：
//   NapCat 的安装已经并进本脚本了，那个单独的仓库因此取消。
//   但"下载失败"这种情况总会有（GitHub 连不上、磁盘不够）——
//   以前会让用户去敲另一个仓库；现在改成 `node install.mjs --napcat-only` 就地重试 ✓
const ARGV = process.argv.slice(2)
const NAPCAT_ONLY = ARGV.includes('--napcat-only')

say('')
say('  养鱼 · QQ   ' + (NAPCAT_ONLY ? '只装 NapCat' : '安装'))
say('  ' + '='.repeat('养鱼 · QQ'.length + 12))
say('')

if (!fs.existsSync(PROFILE_DIR)) {
  die(`找不到 DSH profile：${PROFILE_DIR}\n      先启动一次 DeepSeek Harness，它会自己建好`)
}

// ⚠️ --napcat-only：只补装 NapCat（插件已经装好的情况下用它重试）
//   把 1~4 步整个跳过 —— 不然重跑一次会把插件目录删了重建，没必要
if (!NAPCAT_ONLY) {

// ── 1. 自带共用框架 ─────────────────────────────────────────────
// ⚠️ 2026-11-04 晚：主人说「dsh-whale-core 这个库不要，那两个库里分别放一个就行」。
//   所以 core 现在**就在本仓库的 core/ 目录里**，跟着插件一起装，不用再单独装一遍 ✓
const bundledCore = path.join(HERE, 'core')
if (!fs.existsSync(path.join(bundledCore, 'lib', 'index.js'))) {
  say('  [X] 本仓库缺 core/ 目录（共用框架应该在 repo 里自带）')
  say('      可能是解压/克隆不完整，重新 clone 一次这个仓库再来。')
  process.exit(1)
}
say('  [1/3] 自带共用框架 core/ ✓')

// ── 2. 决定装到哪儿 ──────────────────────────────────────────────
// 通道插件放 ~/.dsh/plugins/<包名>（core/ 作为子目录一起过去）
const target = path.join(PLUGIN_DIR, PKG)
fs.mkdirSync(path.dirname(target), { recursive: true })
const samePath = path.resolve(target).toLowerCase() === path.resolve(HERE).toLowerCase()
if (!samePath) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(HERE, target, {
    recursive: true,
    filter: (s) => {
      const n = path.basename(s)
      return n !== 'node_modules' && n !== '.git'
    },
  })
  say('  [2/3] 已放到 ' + target)
} else {
  say('  [2/3] 本来就在目标位置，跳过复制')
}

// ── 3. 装运行时依赖并**验证**（2026-11-04 加固）────────────────
//
// ⚠️ 原来这里是「npm install 失败就打个警告继续」—— 结果装完插件 import 失败，
//   表现成「设置页少了那一节 / 接口 404」，最难查 ✗
//   现在：装不上就 exit(1)，绝不给你一个半成品。
const pkgDeps = Object.keys(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).dependencies ?? {})

/**
 * 把「直接依赖 + 它们的传递依赖」全算进来。
 *
 * ⚠️ 2026-11-04 晚（主人：「养鱼 · QQ 重启后不见了」）：
 *   原来只检查 package.json 里写的**直接**依赖（qrcode）。
 *   但 qrcode 自己又 require('dijkstrajs') / require('pngjs') ——
 *   借过来 qrcode 却没借它的依赖 → 插件 import 时炸 →
 *   **整个设置页从界面上消失了** ✗（这就是主人遇到的那个）
 *
 *   现在顺着每个包的 dependencies 往下爬，一个不漏 ✓
 */
function collectDeps(root, names) {
  const out = new Set()
  const queue = [...names]
  const seen = new Set()
  while (queue.length) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    out.add(name)
    const pj = path.join(root, 'node_modules', name, 'package.json')
    if (!fs.existsSync(pj)) continue
    try {
      const meta = JSON.parse(fs.readFileSync(pj, 'utf8'))
      for (const dep of Object.keys(meta.dependencies ?? {})) queue.push(dep)
    } catch { /* 读不了就不往下爬 */ }
  }
  return [...out]
}

const allDeps = collectDeps(target, pkgDeps)
let missingDeps = allDeps.filter((d) => !fs.existsSync(path.join(target, 'node_modules', d, 'package.json')))

// ⚠️ 2026-11-04 晚：**先试着从 B站 那边借**，借不到再走 npm。
//   为什么：二维码改用 qrcode 库之后，QQ 包第一次有了运行时依赖。
//   而这台机器上 npm registry 返回 404（装不上），如果先走 npm 就会卡住/失败 ✗
//   两边装的依赖完全一样，借过来直接能用 ✓
if (missingDeps.length) {
  const borrowFrom = path.join(DSH, 'plugins', 'dsh-bili-whale', 'node_modules')
  if (fs.existsSync(borrowFrom)) {
    // ⚠️ 借的时候也要连着传递依赖一起借（qrcode → dijkstrajs/pngjs）
    const fromBili = collectDeps(path.join(DSH, 'plugins', 'dsh-bili-whale'), missingDeps)
      .filter((d) => fs.existsSync(path.join(borrowFrom, d, 'package.json')))
    for (const d of fromBili) {
      const dst = path.join(target, 'node_modules', d)
      if (fs.existsSync(path.join(dst, 'package.json'))) continue
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.cpSync(path.join(borrowFrom, d), dst, { recursive: true })
        say(`        （从 B站 借来了 ${d}）`)
      } catch { /* 借不到就走 npm */ }
    }
    missingDeps = allDeps.filter((d) => !fs.existsSync(path.join(target, 'node_modules', d, 'package.json')))
  }
}

if (missingDeps.length) {
  say('  [2.5] 装依赖：' + missingDeps.join(', ') + ' ...')
  // ⚠️ 2026-11-04 晚（代码审查 + 实测）：新用户装依赖**必失败**，两个原因：
  //   ① package.json 里原来有 peerDependencies.dsh-whale-core ——
  //      npm 上没有这个包，三个 runner 全 404 ✗（那条声明已删）
  //   ② shell:true 让 npm 走 cmd.exe，**中文/空格路径**被 8.3 短名 + GBK
  //      重新编码 → ENOENT ...\package.json ✗
  //      本机 HOME 就是「ZhuanZ（无密码）」，正是会中招的路径。
  //   现在：不用 shell（Windows 上直接调 npm.cmd）+ --legacy-peer-deps 兜底 ✓
  const isWin = process.platform === 'win32'
  const runners = [
    { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--omit=dev', '--no-audit', '--no-fund', '--legacy-peer-deps'] },
    { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['install', '--prod'] },
    { cmd: isWin ? 'corepack.cmd' : 'corepack', args: ['npm', 'install', '--omit=dev', '--legacy-peer-deps'] },
  ]
  let ok = false
  let tried = []
  for (const r of runners) {
    try {
      execFileSync(r.cmd, r.args, { cwd: target, stdio: 'inherit', timeout: 180000 })
      ok = true
      break
    } catch (e) {
      tried.push(r.cmd)
      // 把真实错误说出来 —— 原来只记命令名，用户完全不知道为啥失败
      const msg = String(e?.stderr ?? e?.message ?? '')
        .split(/\r?\n/).filter((l) => /error|404|ENOENT/i.test(l)).slice(0, 2).join(' | ')
      if (msg) say('        ' + r.cmd + ' 失败：' + msg.slice(0, 160))
    }
  }
  if (!ok) {
    console.error('')
    console.error('  [X] 装不上依赖（试过：' + tried.join(' / ') + '）')
    console.error('      这个插件必须有 ' + missingDeps.join(', ') + ' 才能加载，')
    console.error('      装不上就会表现为「设置页少了这一节」或者「接口 404」。')
    console.error('')
    console.error('      手动修：')
    console.error('        cd "' + target + '"')
    console.error('        npm install')
    console.error('')
    process.exit(1)
  }
}

// ⚠️ 硬校验：不只是"命令跑完了"，而是**真的能解析到**
// ⚠️ 校验也要查**传递依赖** —— 只查直接依赖的话，
//   qrcode 在、dijkstrajs 不在，照样 "验证通过" 但插件起不来 ✗
const finalDeps = collectDeps(target, pkgDeps)
const stillMissing = finalDeps.filter((d) => !fs.existsSync(path.join(target, 'node_modules', d, 'package.json')))

if (stillMissing.length) {
  console.error('')
  console.error('  [X] 依赖装了但找不到：' + stillMissing.join(', '))
  console.error('      手动修：cd "' + target + '" && npm install')
  console.error('')
  process.exit(1)
}
say('  [2.5] 依赖就位并已验证 ✓')

// ── 4. 登记到 profile + 建链接 ───────────────────────────────────
const pkgFile = path.join(PROFILE_DIR, 'package.json')
let manifest
try { manifest = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) } catch { die(`读不了 ${pkgFile}`) }
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []

manifest.dependencies[PKG] = 'link:' + target.replace(/\\/g, '/')
if (!manifest.dsh.profile.bundles.includes(PKG)) manifest.dsh.profile.bundles.push(PKG)

// ⚠️⚠️ 2026-11-08（独立使用自检抓到的）：
//   原来只登记了 dsh-qq-whale，**没登记 core** ——
//   插件启动时会自己挂一次 core（日志里有「已挂上自带的 core」），所以能用，
//   但那是**兜底路径**，不是正规路径：
//     · core 提供的 /dsh-whale/api/* 依赖单例锁，两个入口都装时可能让位给 B站 那份
//     · profile 里没登记 → 卸载/升级时清理不干净
//     · DSH 的插件管理界面看不到它
//   现在一起登记，顺序放在 qq **前面**（core 先加载，qq 挂上去才有地方）✓
const CORE_PKG = 'dsh-whale-core'
manifest.dependencies[CORE_PKG] = 'link:' + path.join(target, 'core').replace(/\\/g, '/')
if (!manifest.dsh.profile.bundles.includes(CORE_PKG)) {
  const i = manifest.dsh.profile.bundles.indexOf(PKG)
  if (i >= 0) manifest.dsh.profile.bundles.splice(i, 0, CORE_PKG)
  else manifest.dsh.profile.bundles.push(CORE_PKG)
}

fs.writeFileSync(pkgFile, JSON.stringify(manifest, null, 2) + '\n')
say('  [3/3] 已登记到 profile bundles  ✓')

const linkPath = path.join(PROFILE_DIR, 'node_modules', PKG)
fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  // ⚠️ 2026-11-04 晚（代码审查 + 实测）：原来用 execFileSync('cmd', ['/c','mklink','/J', ...])
  //   参数是**用空格拼起来**交给 cmd 的，路径一带空格就被拆成多个参数 ✗
  //   本机 HOME「ZhuanZ（无密码）」里就有空格 —— 必然踩。
  //   改用 Node 原生 symlinkSync：Windows 上指定 'junction' 不需要管理员，
  //   而且完全不经过 cmd 的参数解析 ✓
  let linked = false
  try {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true })
    if (fs.existsSync(linkPath)) {
      try { fs.rmSync(linkPath, { recursive: true, force: true }) } catch { /* */ }
    }
    fs.symlinkSync(target, linkPath, 'junction')
    linked = true
    say(`        链接好了：${path.basename(linkPath)}`)
  } catch (e) {
    // 没有权限建链接 → 直接拷一份（慢一点，但能跑）
    try {
      fs.cpSync(target, linkPath, { recursive: true })
      linked = true
      say(`        没有建链接权限，改成直接拷了一份：${path.basename(linkPath)}`)
    } catch (e2) {
      say(`        [!] 链接失败：${String(e2?.message ?? e2).slice(0, 120)}`)
    }
  }
  if (!linked) {
    // ⚠️ 这次必须真的报错退出 —— 原来只打一行警告就继续，
    //   结果 package.json 里登记了但模块不存在 → DSH 跳过整个 bundle →
    //   **设置页整节消失**，而脚本还说"装好了" ✗
    console.error('  [X] 插件装好了，但没有链进 profile —— DSH 会加载不到它')
    console.error('      请手动把 ' + target + ' 链接到 ' + linkPath)
    process.exit(1)
  }

// ⚠️⚠️ 2026-11-08（独立使用自检抓到的第二个问题）：
//   core 的 node_modules 链接**从来没建过** ——
//   只靠插件启动时自己挂一次兜底，profile 里找不到 dsh-whale-core 模块 ✗
//   现在一起链上（core 就在 plugins/…/core，链接指向它）✓
try {
  const coreLink = path.join(PROFILE_DIR, 'node_modules', CORE_PKG)
  const coreSrc = path.join(target, 'core')
  if (fs.existsSync(coreSrc)) {
    fs.mkdirSync(path.dirname(coreLink), { recursive: true })
    try { if (fs.existsSync(coreLink)) fs.rmSync(coreLink, { recursive: true, force: true }) } catch { /* */ }
    try {
      fs.symlinkSync(coreSrc, coreLink, 'junction')
      say(`        链接好了：${CORE_PKG}`)
    } catch {
      try { fs.cpSync(coreSrc, coreLink, { recursive: true }); say(`        没有链接权限，拷了一份：${CORE_PKG}`) } catch { /* */ }
    }
  }
} catch { /* core 链接失败不影响插件本体（插件会自己挂） */ }

} // ← 结束「!NAPCAT_ONLY」那一段（插件本体装完了）

// ── 5. 装 NapCat（2026-11-04 晚并入，主人要求「给个地址就能自动配好直接扫码」）──
//
// 以前 NapCat 是**另一个仓库**（dsh-qq-whale-setup）里的一键脚本，用户得先 clone 那个再双击 bat。
// 主人问「为什么不放到 dsh-qq-whale 里面」—— 对，已经并进来了：
// 跑完 install.mjs 就直接有 NapCat，DSH 里点「扫码登录」就能出二维码 ✓
// 下载失败的话，就地重试：`node install.mjs --napcat-only`
//
//   · 已经装过（C:\NapCat\app\node.exe 在）→ 只修配置，不重新下载
//   · Windows 自动装；其它系统给出提示（NapCat 目前只有 Windows shell 版好用）
//   · 装不上**不算失败** —— 插件本身照样能用，只是扫码之前得自己装 NapCat
// ⚠️ 2026-11-04 晚（代码审查抓到）：原来装在「当前盘符的根目录」，
//   用户从 D 盘运行就装到 D:\NapCat，而插件 ensureNapcat() 找的是 C:\NapCat →
//   **装好了但插件永远找不到它** ✗（表现为"连不上 NapCat WebUI"）
//   现在：两边都用 C:\NapCat（可用 NAPCAT_HOME 覆盖），插件侧读同一个变量 ✓
const NAPCAT_DIR = process.env.NAPCAT_HOME || 'C:\\NapCat'
const NAPCAT_VER = 'v4.18.42'
const NAPCAT_ZIP = 'NapCat.Shell.Windows.Node.zip'
const NAPCAT_URL = `https://github.com/NapNeko/NapCatQQ/releases/download/${NAPCAT_VER}/${NAPCAT_ZIP}`
const WEBUI_TOKEN = process.env.NAPCAT_WEBUI_SECRET_KEY || 'napcat_webui'

function napcatInstalled() {
  return fs.existsSync(path.join(NAPCAT_DIR, 'app', 'node.exe')) || fs.existsSync(path.join(NAPCAT_DIR, 'app', 'index.js'))
}

/** 写 westui/onebot 配置（pin 密码 + 开 OneBot HTTP）—— 和 bat 里那套完全一样 */
function writeNapcatConfig() {
  const cfgDir = path.join(NAPCAT_DIR, 'app', 'napcat', 'config')
  fs.mkdirSync(cfgDir, { recursive: true })
  const write = (file, obj) => {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8')
    // ⚠️ NapCat 读到 BOM 会 SyntaxError 起不来 —— 去掉（bat 里那段 [IO.File] 就是在干这个）
    const b = fs.readFileSync(file)
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) fs.writeFileSync(file, b.subarray(3))
  }
  // WebUI：密码钉死，不然 NapCat 会把"像默认值"的 token 换成随机串
  const webuiFile = path.join(cfgDir, 'webui.json')
  let webui = {}
  try { webui = JSON.parse(fs.readFileSync(webuiFile, 'utf8')) } catch { /* 新建 */ }
  write(webuiFile, {
    host: webui.host ?? '0.0.0.0',
    port: webui.port ?? 6099,
    token: WEBUI_TOKEN,
    loginRate: webui.loginRate ?? 10,
    // ⚠️ 2026-11-04 晚（主人：「我不想用这个号登录啊，怎么每次重启都会出问题」）：
    //   autoLoginAccount 一旦被填过，NapCat 每次启动都会**自动登那个号** ——
    //   于是「重启后又是那个号」，而且页面上的扫码/快登都被抢跑 ✗
    //   这个字段通常是 NapCat WebUI 自己写进去的，属于历史遗留。
    //   这里**强制清空**：要登哪个号，由用户在 DSH 里点 ✓
    autoLoginAccount: '',
    disableWebUI: webui.disableWebUI ?? false,
    accessControlMode: webui.accessControlMode ?? 'none',
    ipWhitelist: webui.ipWhitelist ?? [],
    ipBlacklist: webui.ipBlacklist ?? [],
    enableXForwardedFor: webui.enableXForwardedFor ?? false,
    enable2FA: webui.enable2FA ?? false,
    totpSecret: webui.totpSecret ?? '',
  })
  // OneBot：开 HTTP 服务在 127.0.0.1:3000（插件默认连这个）
  write(path.join(cfgDir, 'onebot11.json'), {
    network: {
      httpServers: [{
        name: 'dsh-whale', enable: true, port: 3000, host: '127.0.0.1',
        enableCors: true, enableWebsocket: false, messagePostFormat: 'array', token: '', debug: false,
      }],
      httpSseServers: [], httpClients: [], websocketServers: [], websocketClients: [], plugins: [],
    },
    musicSignUrl: '',
    enableLocalFile2Url: false,
    parseMultMsg: false,
  })
  // 启动脚本：**必须带 NAPCAT_WEBUI_SECRET_KEY**，否则密码又被换掉
  //
  // ⚠️ 2026-11-04 晚（主人：「我重启了，你是不是在耍我」）：
  //   这里原来**每次都无条件覆盖** start-napcat.bat。
  //   而那个文件里有自动重启循环（NapCat 偶尔起来就退出，没循环就一直是死的）——
  //   我一跑 install.mjs 就把它覆盖成"跑一次就结束"的简版 ✗
  //   于是重启后 NapCat 起不来，界面上就是「连不上 NapCat WebUI」。
  //
  //   现在：**已经有就不动它**（用户手里的那份可能被改过、有循环）；
  //         没有才生成，而且生成的版本自带重试 ✓
  const batFile = path.join(NAPCAT_DIR, 'start-napcat.bat')
  if (!fs.existsSync(batFile)) {
    fs.writeFileSync(batFile, [
      '@echo off',
      'setlocal',
      `cd /d "${NAPCAT_DIR}\\app"`,
      `set NAPCAT_WEBUI_SECRET_KEY=${WEBUI_TOKEN}`,
      // 循环：NapCat 偶尔启动即退出，没重试就一直是死的
      ':loop',
      `"${NAPCAT_DIR}\\app\\node.exe" "${NAPCAT_DIR}\\app\\index.js" %*`,
      'if errorlevel 1 timeout /t 5 /nobreak >nul & goto loop',
      '',
    ].join('\r\n'), 'ascii')
  }
}

async function setupNapcat() {
  if (process.platform !== 'win32') {
    say('  [4/4] 装 NapCat')
    say('        [!] 目前只有 Windows 有现成的一键安装。')
    say('            其它系统：从 https://github.com/NapNeko/NapCatQQ/releases 自己装，')
    say('            然后确认 OneBot HTTP 开在 127.0.0.1:3000。插件本身已经装好了。')
    return { ok: false, reason: '非 Windows' }
  }

  say('  [4/4] 装 NapCat（扫码登录要用它）')

  if (napcatInstalled()) {
    say('        已经装过了 → 只修一下配置')
    writeNapcatConfig()
    say('        配置已就绪 ✓')
    return { ok: true, reused: true }
  }

  // 下载（约 118 MB）
  say(`        下载 NapCat ${NAPCAT_VER}（约 118 MB，慢的话等一会儿）…`)
  fs.mkdirSync(NAPCAT_DIR, { recursive: true })
  const zipPath = path.join(NAPCAT_DIR, NAPCAT_ZIP)
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${NAPCAT_URL}' -OutFile '${zipPath}' -UseBasicParsing;` +
      `if ((Get-Item '${zipPath}').Length -lt 50000000) { throw 'download incomplete' }`,
    ], { stdio: 'pipe' })
    say('        下载完成')
  } catch (e) {
    say('        [!] 下载失败（GitHub 连不上 / 磁盘不够）')
    say('            插件已经装好了，NapCat 可以稍后再装。就地重试：')
    say('')
    say('              node install.mjs --napcat-only')
    say('')
    say('            （不需要再下载别的东西，本仓库里就有）')
    return { ok: false, reason: '下载失败' }
  }

  // 解压
  say('        解压…')
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${path.join(NAPCAT_DIR, 'app')}' -Force`,
    ], { stdio: 'pipe' })
    try { fs.rmSync(zipPath, { force: true }) } catch { /* 删不掉留着 */ }
    say('        解压完成')
  } catch (e) {
    say('        [!] 解压失败：' + String(e?.message ?? e).slice(0, 120))
    return { ok: false, reason: '解压失败' }
  }

  writeNapcatConfig()
  say('        配置已就绪（WebUI 密码钉死为 ' + WEBUI_TOKEN + '）')

  // 开机自启（失败不影响使用）
  try {
    const startup = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    if (fs.existsSync(startup)) {
      const lnk = path.join(startup, 'NapCat.lnk')
      execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut('${lnk}');` +
        `$l.TargetPath='${path.join(NAPCAT_DIR, 'start-napcat.bat')}';` +
        `$l.WorkingDirectory='${path.join(NAPCAT_DIR, 'app')}'; $l.WindowStyle=7; $l.Save()`,
      ], { stdio: 'pipe' })
      say('        已设为开机自启')
    }
  } catch { say('        （开机自启没设上，不影响使用）') }

  return { ok: true }
}

let napcat = { ok: false, skipped: true }
try { napcat = await setupNapcat() } catch (e) {
  say('        [!] 装 NapCat 时出错：' + String(e?.message ?? e).slice(0, 160))
  say('            插件本身已经装好，NapCat 可以之后再装。')
}

say('  装好了')
say('  ' + '='.repeat('养鱼 · QQ'.length + 12))
say('')
if (napcat.ok) {
  say('  NapCat 也装好了 —— 接下来：')
  say('')
  say('  1. 启动 NapCat（第一次要手动点一下；之后开机自启）')
  say(`       ${path.join(path.parse(process.cwd()).root, 'NapCat', 'start-napcat.bat')}`)
  say('       等 20~30 秒，看到 WebUI 就绪')
  say('  2. 完整退出 DSH（托盘也要退）再启动')
  say('  3. DSH → 设置 →「养鱼 · QQ」→ 点「扫码登录」')
  say('  4. 手机 QQ 扫一下，在手机上确认')
  say('  5. 填上「主人的 QQ 号」')
} else if (napcat.skipped) {
  say('  接下来：')
  say('  1. 完整退出 DSH（托盘也要退）再启动')
  say('  2. DSH → 设置 →「养鱼 · QQ」→ 扫码登录')
} else {
  say('  插件装好了，但 NapCat 没装成。扫码之前要先有它。')
  say('')
  say('  在这个目录里重试一次就行（不用下别的东西）：')
  say('')
  say('      node install.mjs --napcat-only')
  say('')
  say('  装完再：完整退出 DSH → 重启 → 设置 →「养鱼 · QQ」→ 扫码登录')
}
say('')
