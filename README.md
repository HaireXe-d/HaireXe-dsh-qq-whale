# dsh-qq-whale

> 养鱼的 QQ 通道。跟 [dsh-bili-whale](../dsh-bili-whale)即哔站养鱼 可以**同时开**，也能**单独关**。
>
> 依赖 [dsh-whale-core](../whale-core)即总控制台 提供通道框架。

> ## 🆕 2026-11-04 更新：QQ 可以独立用了
>
> 主人：「QQ养鱼如果独立出来用好像做不到哔站养鱼的效果，像作息、人格、醒来时间设置啥的，
> 你照着哔站养鱼的功能改好」
>
> **以前 QQ 只有一个被动反应**：收到消息就把话投给她。她不会自己想起主人，
> 也就是没有「作息」——那不叫养鱼，叫对话框。
>
> 这一版补齐了这些，全部对齐 B 站：
>
> | 补上的能力 | 原来 | 现在 |
> |---|---|---|
> | **作息（几点醒）** | ❌ 完全没有 | ✅ `night.windows` 时段，支持跨零点 |
> | **定时醒来** | ❌ 只回消息 | ✅ 每分钟检查，到点自己醒 |
> | **主动找你** | ❌ 从不主动 | ✅ `proactive.chance`，有每日上限 |
> | **人格注入** | ⚠️ 只说"人设在哪" | ✅ 首次带**完整人设正文**，改了就重新注入 |
> | **日记恢复** | ❌ 不提日记 | ✅ 醒来时带日记恢复指引 |
> | **会话轮换** | ❌ 一条道走到黑 | ✅ 按自然日换新对话，旧的不删 |
> | **口味** | ❌ 没有 | ✅ `preferences.like/dislike` |
>
> **总控制台现在只管「用 QQ 还是哔站」**：私聊归谁、动态归谁、入口开没开。
> 她是谁、几点醒、怎么说话，全部回到本插件的设置页 —— 两处不再打架。
>
> 新增模块：`lib/schedule.js`（作息，纯函数可测）、`lib/proactive.js`（主动 + 人格注入）
>
> ---
>
> ## 安装
>
> ```
> git clone https://github.com/HaireXe-d/dsh-qq-whale
> cd dsh-qq-whale
> node install.mjs
> ```
>
> 前置：需要 [NapCat](https://github.com/NapNeko/NapCatQQ)（一键装：
> [dsh-qq-whale-setup](https://github.com/HaireXe-d/dsh-qq-whale-setup)）
>
> ---

## 它做什么

- 收主人的 QQ 私信，投给会话
- 发私信（一条一行 = 一条消息，跟 B 站那边同一个规矩）
- 戳一戳（可选，默认关）
- 安静时段：只收不发

## 它不做什么

- **不碰 QQ 客户端本体**。它只跟本地一个 OneBot 11 服务说话 ✓
- 不管登录。扫码/登录都是 NapCat 那边的事，我不碰主人的账号密码 ✗

---

## 这一页和「养鱼 · B站」长得一样（2026-11-04）

主人：「养鱼QQ的控制台怎么和哔站养鱼的不一样」。

改之前 QQ 那页是一堆圆角卡片、字段散在各处；B 站那页虽然老，但排版是一致的。
现在 QQ 这页照 B 站那套重做了：

| | B 站页 | QQ 页 |
|---|---|---|
| 类名前缀 | `blw-` | `blwq-`（**同样的值**，所以看起来一样） |
| 结构 | 标题 → 分组 → 行 → 底部按钮 | 一模一样 |
| 行 | 左边中文名+说明，右边控件 | 一模一样 |
| 输入框 | `.blw-input` / `.blw-wide` | `.blwq-input` / `.blwq-wide`，同尺寸 |
| 底部 | 保存 / 依赖体检 / 重新读取 | 一模一样 |

**分组**（照 B 站「她是谁 / 你（主人）/ 口味 / 作息…」的写法）：

1. 我是谁、你是谁
2. 扫码登录（专门块）
3. 待审（专门块）
4. 连 NapCat
5. 收消息
6. 她怎么回话
7. 发什么（文字 / 语音 / 表情包）
8. 语音（含试听和导入）
9. 戳一戳
10. 叫醒她用哪个对话

页名也统一了：「养鱼 · B站」「养鱼 · QQ」（之前是「B站详细」「QQ详细」，更绕）。

字段是**数据驱动**的（`FIELDS` 数组），加一项只改那个数组 —— 跟 B 站页同一个写法。

---

## 我是谁、你是谁（2026-11-04）

跟 B 站那边对齐，两个号都要存：

| 字段 | 是什么 |
|---|---|
| `self.uin` / `self.nickname` | **她登录的 QQ 号**（扫码登录成功时自动记；也可以点「从 NapCat 读一次」） |
| `owner.uin` / `owner.nickname` | **你的 QQ 号**（在通道配置里填，或者收到你消息时自动记昵称） |

- 接口：`GET /channels/qq/accounts`（看）、`POST /channels/qq/accounts/refresh`（从 NapCat 读一次自己是谁）
- 界面：「设置 → 养鱼 · QQ详细」最上面的 **我是谁、你是谁**
- `owner.uin` 决定「谁算主人」—— 别人的话走待审 ✗
- **密码 / token 不在这两个接口里回显**（有用例盯着）

---

## 运行时真的按规则走（2026-11-04）

之前的坑：`shared.json` 里写「私聊给 QQ」，可**调度器运行时不看它** ——
规则只有控制台看得见，两边照样同时叫醒她 ✗

现在 QQ 通道收信前先问一句「该不该我说话」（`lib/runtime-rules.js`）：

- 私聊不在 QQ → 收到也**不叫醒**，只记日志（消息不丢，还留在 OneBot 历史里）
- 改配置**立刻生效**，不用重启 ✓
- 读不到规则 → **按允许处理**（不能因为读不到配置就把自己关死）

---

## 收到私信会叫醒她（2026-11-04 补的最后一块）

之前 QQ 收到消息只写日志，人还是哑的。现在：

```
私信进来 → shouldAutoReply 判断
   ├─ 主人自己 → controller.prompt({ sessionId, mode:'queue', content:[…] })
   └─ 别人     → 待审队列 + 提醒主人
```

- 会话**沿用 B 站那个池子**（默认 `bili-whale`，配置里 `wake.sessionId` 可改）—— 不开新会话，否则两边记忆就断了 ✗
- 投进去的内容带：人设路径提醒 + 「谁说了什么」+ 回话指引（`dm-reply-qq.txt`、`[语音]`/`[表情]` 标记）
- **同一条只投一次**：按 `userId:messageId` 去重，状态落盘到 `qq-wake-state.json`，重启也不会重投 ✓
- **投递失败不标记** → 下次轮询还能重来 ✓
- `mode: 'queue'`：她正在干活就排队，不打断 ✓

⚠️ 拿不到 `sessionController` 时**会明确记日志说「收得到消息但叫不醒她」**，不会安静地什么都不做。

---

## 发什么方式（2026-11-04 主人最后补的一条）

主人：「主要是你想发就发，我主动提也可以选，也在控制台可调吧，大部分时候就停留在你自己选择的选项」。

| 情况 | 谁决定 |
|---|---|
| **平时** | 我自己挑 —— 按权重掷（文字 8 / 语音 1 / 表情包 1）✓ |
| **他临时说一句**「发语音」「发个表情包」 | 这一次听他的；`format.overrideTtlSec`（默认 300 秒）后自动失效，**不改默认** |
| **想固定住** | 控制台切 pinned，或者配置里 `format.mode = "pinned"` + `format.pinned` |

配置：

```json
"format": {
  "mode": "auto",
  "pinned": "text",
  "overrideTtlSec": 300,
  "weights": { "text": 8, "voice": 1, "sticker": 1 }
}
```

- 权重都能调，设 0 就是不用那种（比如 `voice: 0` = 我永远不自己发语音，但他要还是能要）
- 接口：`GET /channels/qq/format`（现在会发成什么）、`POST /channels/qq/format/pin`（这一次固定成哪种）
- 控制台：「设置 → 养鱼 · QQ 登录」→ **发什么** 那一块

---

## 控制台可调（2026-11-04）

主人：「这些都做成可调的，上限和声音都可以在控制台导入」。

### 数字都能滑

「设置 → 养鱼（通道）」里每个数字字段都是**滑杆 + 数字框**，范围写在提示里：

| 字段 | 范围 | 是什么 |
|---|---|---|
| `sticker.perDay` | 0–10 | 一天最多存几个表情包 |
| `sticker.sendChance` | 0–1 | 文字配表情包的概率 |
| `voice.maxChars` | 20–500 | 一次最多念几个字 |
| `voice.rate` | -10–10 | 语速 |
| `voice.volume` | 0–100 | 音量 |
| `listen.intervalSec` | 2–60 | 多久查一次消息 |
| `reply.maxLines` | 1–20 | 一次最多发几条 |

### 声音

「设置 → 养鱼 · QQ 登录」下面有 **我的声音**：

- **选音色**：从这台机器装的 TTS 声音里挑（中文排前面；本机现在是慧慧 Huihui）
- **语速 / 音量**：滑杆调
- **试听一句**：点一下我念「这是本鱼的声音，你听听」，并且会告诉你**这个格式能不能真发出去**
- **导入自己的音频**：填一个本机 wav/mp3 路径点导入 → 拷到 `qq-voice/` → 把配置里 `voice.engine` 改成 `file` 就用它

接口：`GET /channels/qq/voice/check`、`POST /channels/qq/voice/preview`、`POST /channels/qq/voice/import`

---

## 想发什么发什么（文字 / 语音 / 表情包，2026-11-04）

主人原话：「想发文字发文字，想发语音发语音，还可以增加表情包功能，碰到喜欢的表情包就存
（一天最多存一个，没碰到喜欢的就不存），对话想发的时候就发」。

### 回复文件里的标记

一行 = 一条消息，可以在行首加标记：

| 写法 | 发什么 |
|---|---|
| `早啊主人` | 普通文字 |
| `[语音] 主人早上好` | 语音条（本地 TTS 念） |
| `[表情]` | 从库里挑一个表情包 |
| `[表情，好可爱]` | 挑一个表情包，配这句话 |
| `[表情] 这谁顶得住` | 挑一个，配「这谁顶得住」 |

普通文字有 15% 的机会顺手配个表情包（`sticker.sendChance`），想调就调。

### 语音

- 用 **Windows 自带 TTS**（Microsoft Huihui，中文女声）念，不外发、不要 key
- 念完要转成 **amr** 才是 QQ 认的语音格式
- ⚠️ **本机实测：剪映那份 ffmpeg 没有 amr 编码器** → 转不出来 → **不发**
  （宁可不发，也不发一个对方点了放不出声的文件 ✗）
  要真用起来，换一个带 `libopencore_amrnb` 的 ffmpeg 就行
- 想知道现在能不能发：`GET /dsh-whale/api/channels/qq/voice/check`

### 表情包

- **一天最多存一个**（`sticker.perDay`），按自然日算
- 没碰上喜欢的就不存 —— 存不下也不难过 ✓
- 存的是**文件**不是 URL（URL 会过期 ✗），在 `~/.dsh/whale-channels/qq-stickers/`
- 接口：`GET /stickers`（看库里有什么）、`POST /stickers/save`（存一个）、`POST /stickers/send`（发一个）

---

## 别人发的话：先给主人过目（2026-11-04）

主人说的原话：「其他人发信息通知主人再回答」。

| 谁说的 | 怎么处理 |
|---|---|
| **主人自己** | 直接投给会话 ✓ |
| **别人** | 进待审队列 → 给主人推一条提醒 → **他点头才发** ✓ |

- 队列文件：`~/.dsh/whale-channels/qq-pending-replies.json`（格式跟 B 站的 `pending-replies.json` 同构）
- 同一条消息不会重复排队（轮询重叠、重启都不会刷屏）
- **队列不自动过期** —— 宁可留着等我拍板，也不能悄悄丢掉（丢了就等于我没告诉他 ✗）
- 发失败了**不出队**，还留着

### 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-whale/api/channels/qq/pending` | 还有几条待你点头 |
| POST | `/dsh-whale/api/channels/qq/pending/approve` | `{id, text?}` → 真的发出去（成功了才出队） |
| POST | `/dsh-whale/api/channels/qq/pending/drop` | `{id, reason?}` → 撤掉（记录留着） |
| POST | `/dsh-whale/api/channels/qq/pending/revise` | `{id, text}` → 改草稿，还是待审 |

### 界面

「设置 → 养鱼 · QQ 登录」下面就是待审列表：谁说的、说了什么、草稿是什么，草稿可以直接改，然后点「发」或「删」。

---

## 扫码登录（2026-11-04 加）

跟 B 站那套流程一样：**生成二维码 → 手机 QQ 扫 → 插件每 2 秒问一次 → 成功/过期/取消**。

区别只在于问谁：B 站问 passport.bilibili.com，这里问**本机 NapCat 的 WebUI**（默认 `http://127.0.0.1:6099`）。

```
设置 → 养鱼 · QQ 登录   ← 这个包里自己的那一节，只放登录
设置 → 养鱼（通道）      ← 通道开关和配置都在 core 那一页
```

NapCat WebUI 的协议（2026-11-04 从 NcatBot 的 setup 模块核对过）：

| 步 | 请求 | 说明 |
|---|---|---|
| 1 | `POST /api/auth/login {hash}` | `hash = sha256("<webui_token>.napcat")`，换回 Bearer Credential |
| 2 | `POST /api/QQLogin/GetQQLoginQrcode` | 拿二维码 URL（有时候要重试，最多等 15 秒） |
| 3 | `POST /api/QQLogin/CheckLoginStatus` | `data.isLogin` 是不是 true |
| 4 | `POST /api/QQLogin/GetQQLoginInfo` | 登录好了拿 `uin` / `nickname` |

配置里对应的两个键（在 QQ 通道的配置里）：

```json
{ "webui": { "url": "http://127.0.0.1:6099", "token": "napcat_webui" } }
```

⚠️ `webui.token` 是敏感字段，设置页读配置时会被掩码成 `******`。

**二维码是我自己画的**（`lib/qr-image.js`，只用 Node 自带 zlib，没引第三方包）——
因为 link 安装下 pnpm 不给这个包建 node_modules，加了 `qrcode` 依赖也未必找得到 ✗
自测：`node tests/qr-verify.mjs` 会把数据位、纠错分块、交织、掩码全反解一遍，跟原文对比。

---

## 技术选型

| 方案 | 说明 | 结论 |
|---|---|---|
| **NapCatQQ / LLOneBot**（OneBot 11） | 独立客户端，本地起 HTTP 服务，插件只跟 `127.0.0.1:PORT` 说话 | ✓ 用这个 |
| Lagrange.Core | 纯协议实现，不用装客户端 | 轻，但风控风险高 |
| 官方 QQ 机器人开放平台 | 只对群/频道开放 | ✗ 拿不到私聊 |

装好 NapCat 之后，在它的配置里开一个 **HTTP 服务端**，记下端口（默认常见 3000）。

---

## 配置

配置在 `~/.dsh/whale-channels/channels/qq.json`（由 core 管，一个通道一份）：

```json
{
  "onebot": { "baseUrl": "http://127.0.0.1:3000", "token": "" },
  "owner": { "uin": "主人的QQ号" },
  "listen": { "intervalSec": 8, "backoffMaxSec": 180 },
  "reply": { "file": "dm-reply-qq.txt", "maxLines": 6, "maxChars": 600, "gapMs": 1200 },
  "quietHours": [{ "from": "23:30", "to": "07:00" }],
  "poke": { "enabled": false, "afterMinutes": 60 },
  "voice": { "enabled": false }
}
```

`onebot.token` 是敏感字段 —— 设置页读配置时会被掩码成 `******` ✓

---

## 开关

```powershell
# 开
curl.exe -X POST http://127.0.0.1:19387/dsh-whale/api/channels/qq/enabled -H "content-type: application/json" -d '{\"enabled\":true}'

# 关（数据一个字节都不删，下次打开接着用）
curl.exe -X POST http://127.0.0.1:19387/dsh-whale/api/channels/qq/enabled -H "content-type: application/json" -d '{\"enabled\":false}'
```

关掉之后：不轮询、不连 OneBot、`/dsh-whale/api/channels/qq/*` 一律 409、配置只读。

**默认是关的** —— 没配 OneBot 之前开着只会一直报错，不如让主人配好再开。

---

## 体检

```powershell
curl.exe http://127.0.0.1:19387/dsh-whale/api/channels/qq/deps
```

会真的去问一句 OneBot 活不活、登录的是哪个号。

---

## 命令行走廊（不经过 DSH 也能测）

```powershell
node tools/qq.mjs status                # OneBot 活着吗，登的哪个号
node tools/qq.mjs send 123456789 你好   # 发一条
node tools/qq.mjs poke 123456789        # 戳一下
node tools/qq.mjs history 123456789 5   # 拉最近 5 条
```

---

## 自检

```powershell
node --test tests/*.test.mjs
```

覆盖：OneBot 应答判定（retcode≠0 不能当成功）、连不上时的报错话术、只认私信的过滤、
CQ 码剥离、基线不灌老消息、失败退避与上限、安静时段跨零点、通道定义的默认关。

---

## 作息与主动（2026-11-04 新增）

### 醒来时段

`night.windows` 是一个数组，一个窗口到点醒一次：

```jsonc
"night": {
  "windows": [
    { "start": "9:00",  "end": "11:00", "wakes": 1 },
    { "start": "14:00", "end": "16:00", "wakes": 1 },
    { "start": "20:00", "end": "22:00", "wakes": 1 }
  ],
  "skipChance": 0,        // 到点了也有这个概率跳过
  "minGapMin": 60,        // 两次醒来至少隔多久
  "maxWakesPerDay": 3     // 一天最多醒几次
}
```

**支持跨零点**：`{ "start": "23:00", "end": "02:00" }` 也能正确识别 ✓

设置页里是可视化的：一行一个时段，能加能删，非法时间会标红。

### 主动找你

醒来之后，由 `proactive` 决定说不说话：

```jsonc
"proactive": {
  "enabled": true,
  "chance": 0.5,      // 醒来时 50% 概率开口
  "dailyMax": 2,      // 一天最多主动几次
  "quietMin": 30      // 你刚说过话 30 分钟内不打扰
}
```

> `night` 和 `proactive` 是**分开的两个开关**：
> `night` 决定「什么时候醒」，`proactive` 决定「醒来后说不说话」。
> 只醒不说话也有用（她会去读日记、想事情），所以没合成一个。

### 人格注入

和 B 站 `session-delivery.js` 完全一致的语义：

| 情况 | 带什么 |
|---|---|
| 首次投递 | **完整人设正文** + 日记恢复指引 |
| 之后 | 只给「人设依据在哪，缺了自己重读」 |
| 人设改了 | 重新注入完整正文 |
| 进程刚启动 | 重新注入（防重启失忆） |

人设还是 `~/.bili-ai/persona.md`，**和 B 站同一份**。
日记还是 `~/.dsh/whale-diary.md`，**同一份**。

### 会话轮换

`sessionRotateDays`：按**自然日**算（不是 24 小时）。
`1` = 过零点就换新对话；`0` = 不换。

换的时候**旧对话保留**（不删），并且新对话第一句会重新注入人设。

---

## 还没做

- **群聊**：只做了私聊。要不要进群得主人定
- **直播/动态监听**：那是 B 站独有的能力（QQ 空间动态接口不稳定）
- **图片理解**：目前只处理文字消息

---

## 测试

```
133 项全部通过
  tests/schedule.test.mjs    21 项（作息：窗口、跨零点、上限、间隔、跳过）
  tests/proactive.test.mjs   13 项（主动、人格注入、口味）
  tests/wake.test.mjs        11 项（叫醒、去重、轮换、人设重注入）
  ...
```

跑法：`node --test tests/*.test.mjs`
