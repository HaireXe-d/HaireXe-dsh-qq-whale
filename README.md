# dsh-qq-whale

> **养鱼 · QQ** —— 让 DSH 里的她通过 QQ 陪你聊天、发动态、发语音、存表情包。
> 支持**扫码登录**，和 B站 那边是**同一条鱼**（同一本日记、同一个人设）。

```
       一条鱼
（同一份日记、同一份人设、同一段记忆）
       ├─ 入口：B 站  ← dsh-bili-whale
       └─ 入口：QQ    ← 本仓库
```

---

## 目录

- [长什么样](#长什么样)
- [装之前要知道的](#装之前要知道的)
- [安装（三步）](#安装三步)
- [用起来](#用起来)
- [功能详解](#功能详解)
- [和 B站 共用什么](#和-b站-共用什么)
- [总控制台](#总控制台)
- [NapCat 那四个字段是什么](#napcat-那四个字段是什么)
- [常见问题](#常见问题)
- [技术选型](#技术选型)

---

## 长什么样

DSH 设置里多出两节：

- **「养鱼 · QQ」** —— QQ 自己的设置（登录、账号、收发、语音、表情包、待审）
- **「养鱼」** —— 总控制台（和 B站 一起管，需要装 `dsh-whale-core`）

---

## 装之前要知道的

### 必须有 NapCat

QQ 这边**不能直接连 QQ**，必须经过 [NapCat](https://github.com/NapNeko/NapCatQQ) ——
一个基于 QQNT 的 **OneBot 11** 实现。它要接管 QQ 进程才能收发消息。

> 普通 QQ 客户端不行。NapCat 是单独的东西，要单独装、单独跑。

**一键装 NapCat**（推荐）：

```
git clone https://github.com/HaireXe-d/dsh-qq-whale-setup
cd dsh-qq-whale-setup
windows\install-napcat.bat
```

它会自动下载 NapCat、**钉死 WebUI 密码**、开好 OneBot 接口、设开机自启。
装完自检：`powershell -File windows\check.ps1`（七项全绿即可）

> **为什么要「钉死密码」**：NapCat 有安全策略，会把看起来像默认值的 WebUI 密码
> **自动换成随机串**。不钉住的话，每次重启 DSH 都认证失败 ——
> 这就是很多人第一次配 QQ 卡住的地方。

### 需要 DSH

DeepSeek Harness（桌面版）。本插件是它的一个 profile 插件。

---

## 安装（三步）

### 1. 装 NapCat

见上面 —— 或者跳过，你已经有了也行。

### 2. 装插件

```
git clone https://github.com/HaireXe-d/dsh-qq-whale
cd dsh-qq-whale
node install.mjs
```

`install.mjs` 会：

- 检查有没有 `dsh-whale-core`（总控制台框架，**可选**）
- 把本包放到 `~/.dsh/plugins/dsh-qq-whale`
- 登记进 DSH 的 desktop profile
- 建好链接

### 3. 重启 DSH

**完整退出**（托盘图标也要退），再启动。

---

## 用起来

### 第一次

1. 双击 `C:\NapCat\start-napcat.bat` 启动 NapCat（约 20–30 秒）
2. DSH → 设置 →「**养鱼 · QQ**」→ 点「**扫码登录**」
3. 手机 QQ 扫一下，在手机上确认
4. 「我登录的 QQ 号」会自动填上
5. 再填「**主人的 QQ 号**」（只有这个号发的消息才算主人，别人的进待审）
6. 去 设置 →「养鱼」把 QQ 入口打开

### 之后

只要 NapCat 和 DSH 在跑，她自己会工作。

---

## 功能详解

### 扫码登录

```
点「扫码登录」→ 插件向 NapCat WebUI 要二维码 → 浏览器显示
              → 隔 2 秒问一次状态 → 手机扫完确认 → 成功
```

- 二维码约 3 分钟有效，过期可以「重新生成」
- 登录成功后自动把 QQ 号、昵称记进配置
- **不需要在 DSH 里填什么密码** —— 已经和 NapCat 对齐好了
- 也可以直接打开 `http://127.0.0.1:6099/webui?token=napcat_webui` 在那边扫

> 失败时不再只显示「出错了」，会写清楚真实原因（连不上 / token 不对 / 二维码过期）。

### 私聊

**收**：插件定期问 NapCat 有没有新消息（默认 8 秒一次，可调）。

**回**：她写回复到文件，插件读文件来发。

| 配置 | 默认 | 说明 |
|---|---|---|
| `listen.intervalSec` | 8 | 多久查一次（2–60 秒，越小越灵敏） |
| `listen.backoffMaxSec` | 180 | 连不上时最多退到多久（10–900 秒） |
| `reply.maxLines` | 6 | 一次最多发几条（一行 = 一条消息） |
| `reply.maxChars` | 600 | 单条最多几个字，太长会切 |
| `reply.gapMs` | 1200 | 多条之间停多久（太快像机器人） |

**连续发多条**：她把回复写成多行，一行就是一条消息，中间自动停顿。

### 待审：别人说的话先给你过目

**这是 QQ 侧最特别的保护。**

规则很简单：

- **主人**（`owner.uin`）发的话 → 直接当她收到
- **别人**发的话 → 先躺进待审队列，**你点头才回**

界面上：

```
待审（别人发来的话，你点头才回）
  [头像] 昵称 · 12:34
  「今天那个视频好好笑」
  [回了] [改一下再回] [不理]
```

### 发什么方式（文字 / 语音 / 表情包）

她会自己挑用哪种方式说话：

| 模式 | 说明 |
|---|---|
| `auto` | 按权重随机挑（默认 文字 8 : 语音 1 : 表情包 1） |
| `pinned` | 固定成一种 |

**临时指定**：你说「发语音」，她在接下来 `overrideTtlSec`（默认 300 秒）内都用语音。

| 配置 | 默认 | 说明 |
|---|---|---|
| `format.mode` | auto | auto / pinned |
| `format.pinned` | text | pinned 时固定发哪种 |
| `format.overrideTtlSec` | 300 | 你临时指定管多久（30–3600 秒） |
| `format.weights.text` | 8 | 文字权重（0–20） |
| `format.weights.voice` | 1 | 语音权重（0 就少发语音，但你要她还是会发） |
| `format.weights.sticker` | 1 | 表情包权重 |

#### 语音

| 配置 | 默认 | 说明 |
|---|---|---|
| `voice.enabled` | true | 开不开 |
| `voice.engine` | tts | tts（系统朗读）/ file（自备音频） |
| `voice.voice` | Microsoft Huihui Desktop | 用哪个系统语音 |
| `voice.rate` / `volume` | 0 / 100 | 语速、音量 |
| `voice.maxChars` | 120 | 超过就转成文字 |

#### 表情包

| 配置 | 默认 | 说明 |
|---|---|---|
| `sticker.enabled` | true | 开不开 |
| `sticker.perDay` | 1 | 一天最多存几个 |
| `sticker.maxBytes` | 8 MB | 多大以内才存 |
| `sticker.sendChance` | 0.15 | 挑中表情包的权重 |

### 我是谁、你是谁

和 B站 那边对齐：

| 字段 | 谁填 |
|---|---|
| `self.uin` / `self.nickname` | **自动**（登录成功后） |
| `owner.uin` | **你填**（例如 `3546626108`） |
| `owner.nickname` | 自动（收到主人消息时记） |

还有个「**从 NapCat 读一次**」按钮 —— 不用扫码也能问一句「现在登的是哪个号」。

### 作息与主动

| 配置 | 默认 | 说明 |
|---|---|---|
| `quietHours` | `[]` | 只收不发的时间段，例如 `[{from:'23:30',to:'07:00'}]` |
| `poke.enabled` | false | 戳一戳（他不理我就戳一下，默认关，怕烦） |
| `poke.afterMinutes` | 60 | 多久没回才戳 |
| `wake.sessionId` | 空 | 叫醒她用哪个对话（默认跟 B站 共用，记忆才连得上） |

> **作息和 B站 共用一套** —— 一条鱼不该有两个生物钟。
> 具体几点醒在「养鱼 · B站」的「作息」里改。

### 控制台全字段表

`~/.dsh/whale-channels/channels/qq.json`：

```jsonc
{
  "enabled": true,
  "onebot": {
    "baseUrl": "http://127.0.0.1:3000",   // NapCat 的 HTTP 接口
    "token": ""                            // OneBot 密钥，本机监听一般留空
  },
  "webui": {
    "url": "http://127.0.0.1:6099",        // NapCat 管理页
    "token": "napcat_webui"                // 必须和 NapCat 的一致
  },
  "self":   { "uin": "", "nickname": "", "at": "" },      // 自动填
  "owner":  { "uin": "", "nickname": "" },                // 你填
  "listen": { "intervalSec": 8, "backoffMaxSec": 180 },
  "reply":  { "file": "dm-reply-qq.txt", "maxLines": 6, "maxChars": 600, "gapMs": 1200 },
  "quietHours": [],
  "poke":   { "enabled": false, "afterMinutes": 60 },
  "voice":  { "enabled": true, "engine": "tts", "voice": "Microsoft Huihui Desktop",
              "rate": 0, "volume": 100, "maxChars": 120, "customFile": "" },
  "sticker":{ "enabled": true, "perDay": 1, "maxBytes": 8388608, "sendChance": 0.15 },
  "format": { "mode": "auto", "pinned": "text", "overrideTtlSec": 300,
              "weights": { "text": 8, "voice": 1, "sticker": 1 } },
  "wake":   { "sessionId": "" }
}
```

---

## 和 B站 共用什么

| 东西 | 位置 | 份数 |
|---|---|---|
| 日记 | `~/.dsh/whale-diary.md` | **1** |
| 私密日记 | `~/.dsh/whale-diary-private.md` | **1** |
| 人设 | `~/.bili-ai/persona.md` | **1** |

**这不是配置项，是事实。** QQ 插件里**没有任何写日记的代码** —— 它只读同一份人设，
只是换个入口说话。你在 QQ 说的话，她在 B站 也记得；反之一样。

改人设去「养鱼 · B站」，QQ 这边自动跟着用。

---

## 总控制台

装了 [dsh-whale-core](https://github.com/HaireXe-d/dsh-whale-core) 之后，
DSH 设置里会多一节「**养鱼**」：

```
【① 她的入口】B 站 和 QQ
【② 谁做什么】
  跟你私聊    [B 站] QQ       ← 点一下换边
  发动态      [B 站] QQ
  分享视频    [会推给你]       只有 B 站
  存表情包    会              只有 QQ
【③ 她在哪些地方能说话】● B 站 / ● QQ
【④ 她是谁（只有一份）】日记 同一份 / 人设 同一份 / 作息 共用一套
【⑤ 常用手感】主动找你的概率、发动态的概率、QQ 发几条、几个字
```

### 没配置的入口选不了

| 情况 | 表现 |
|---|---|
| 只装了 B站 | 总控制台里 QQ 显示「**未配置**」，选不了 |
| 只装了 QQ | B站 显示「未配置」 |
| 两个都配好 | 都能选 |

点未配置的选项会告诉你**怎么配**，不会被悄悄选上。

> QQ 算「已配置」的条件：装了插件 + 扫码登录过（`self.uin` 有值）**+** 填了主人 QQ 号。

---

## NapCat 那四个字段是什么

第一次看到会懵，其实**一个都不用改**：

| 字段 | 值 | 要改吗 |
|---|---|---|
| OneBot 地址 | `http://127.0.0.1:3000` | 不用，固定值 |
| OneBot 密码 | 空 | 不用，本机监听没设密码 |
| NapCat 网页管理地址 | `http://127.0.0.1:6099` | 不用，固定值 |
| NapCat 网页管理密码 | `napcat_webui` | 不用，**一键脚本已经钉死** |

**唯一需要改的情况**：NapCat 装在**另一台机器**上 → 把 `127.0.0.1` 换成那台的 IP。

---

## 常见问题

**Q: 能不用 NapCat 吗？**
可以。任何 OneBot 11 实现的 HTTP 接口都行（LLOneBot、Lagrange 等），
把「OneBot 地址」改成对应的即可。但**扫码登录那一块是 NapCat WebUI 专属的**。

**Q: 扫码一直报「连不上 NapCat WebUI」？**

1. NapCat 起了吗？（双击 `C:\NapCat\start-napcat.bat`）
2. 跑一下 `powershell -File windows\check.ps1`
3. 是不是用了自带的 `napcat.bat`？那个不设环境变量，密码会被换成随机串 —— 用 `start-napcat.bat`

**Q: 提示「NapCat WebUI 认证失败（token 对不对）」？**
密码被 NapCat 换成随机串了。重新跑一次 `windows\install-napcat.bat` 会用环境变量重新钉死。

**Q: 3000 端口没起来？**
正常。`onebot11_<QQ号>.json` 要等 **QQ 登录成功后**才生成，端口那时才监听。

**Q: 别人的消息她不回？**
设计如此。陌生人发的话进「待审」队列，你点头才回。

**Q: 她突然不发语音了？**
看 `format.weights.voice` 是不是 0，或者 `voice.enabled` 关了。也可能你临时指定过期了。

**Q: 重启电脑后不工作了？**
NapCat 需要重启。一键脚本装的时候设了开机自启（启动文件夹 `NapCat.lnk`），
登录 Windows 后约 20–30 秒它自己起来；没起来就双击 `start-napcat.bat`。

**Q: 和 B站 的日记会冲突吗？**
不会。**只有一份日记**，两个入口读写的是同一个文件。

---

## 技术选型

**为什么是 OneBot 11？**

NapCat / LLOneBot 这些工具都实现了它。插件只要跟 `http://127.0.0.1:<port>` 说话，
**不碰 QQ 客户端本身**。换成别的实现也不用改代码。

**模块一览**

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 宿主侧入口：登记成通道、路由、start/stop |
| `lib/client.js` | 设置页 UI（React） |
| `lib/onebot.js` | OneBot 11 HTTP 客户端（发消息、拉历史） |
| `lib/poller.js` | 轮询收消息、退避 |
| `lib/qr-login.js` | NapCat WebUI 扫码登录 |
| `lib/qr-image.js` | 二维码渲染（纯 JS，零依赖） |
| `lib/pending.js` | 待审队列 |
| `lib/compose.js` | 决定发什么、怎么发 |
| `lib/voice.js` | TTS 语音合成 |
| `lib/sticker.js` | 表情包库 |
| `lib/wake.js` | 叫醒她 |
| `lib/runtime-rules.js` | 运行时规则 |

**测试**：97 项全部通过（`node --test tests/*.test.mjs`）

---

## 相关仓库

| 仓库 | 作用 |
|---|---|
| [dsh-whale-core](https://github.com/HaireXe-d/dsh-whale-core) | 总控制台框架（可选） |
| [dsh-bili-whale](https://github.com/HaireXe-d/HaireXe-dsh-bili-whale) | 养鱼 · B站（另一个入口） |
| [dsh-qq-whale-setup](https://github.com/HaireXe-d/dsh-qq-whale-setup) | 一键装 NapCat |

## 许可

MIT
