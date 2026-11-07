# dsh-qq-whale

> 养鱼的 QQ 入口。装了它就有**完整的养鱼体验** —— 总控制台、作息、人格、记忆全在里面。
>
> 想同时在 B 站也养的话，再装 [HaireXe-dsh-bili-whale](https://github.com/HaireXe-d/HaireXe-dsh-bili-whale)，
> 两个入口会自动共用同一份记忆和同一套设置。**只装这一个也完全能用** ✓
>
> > **自带通道框架**：`core/` 目录里是总控制台和多入口管理，跟着本仓库一起装，
> > 不用另外下任何东西。

---

## 三分钟装完，扫码就能用

```bash
git clone https://github.com/HaireXe-d/dsh-qq-whale
cd dsh-qq-whale
node install.mjs
```

**这一条命令会做完四件事**（以前要三个仓库 + 双击 bat）：

| 步骤 | 做什么 |
|---|---|
| 1 | 把插件放到 `~/.dsh/plugins/dsh-qq-whale` |
| 2 | 自带的总控制台（`core/`）一起装好 |
| 3 | 登记进 DSH，建好链接 |
| 4 | **自动装 NapCat**：下载 118MB → 解压 → 钉死 WebUI 密码 → 开 OneBot HTTP → 设开机自启 |

装完（实测 73 秒，大部分时间在下载）：

1. 双击 `C:\NapCat\start-napcat.bat`（第一次要手动点，之后开机自启），等 20~30 秒
2. **完整退出 DSH**（托盘也要退）再启动
3. 设置 →「养鱼 · QQ」→ 点「**扫码登录**」
4. 手机 QQ 扫一下，在手机上确认
5. 填「主人的 QQ 号」——完事

> 为什么 NapCat 必须单独存在：QQ 官方客户端**不对外开任何接口**，
> 必须有一个 OneBot 实现接管 QQ 进程才能收发消息。NapCat 就是那个东西，本插件只是它的客户端。
>
> 已经装过 NapCat 的机器重跑 `install.mjs` 不会重新下载，只把配置修好。
>
> NapCat 没装上就**在本仓库里重试**（不用去别的仓库）：
>
> ```bash
> node install.mjs --napcat-only
> ```

---

## 备份：桌面上的一份，两个入口都能用

```bash
node tools/qq-backup.mjs            # 备份到桌面「她QQ的备份」
node tools/qq-backup.mjs --dry      # 先看会拷什么，不实际拷
```

一份备份 = **整条鱼**，不只是 QQ 那边：

| 备份里的东西 | 为什么也在这里 |
|---|---|
| 人设 `bili-ai/persona.md` | 两个入口共用这一份 |
| 日记 + 私密日记 + 规则 | 同上，**只有一份** |
| `whale-habits.json` | 作息/口味/人设设置（改了会同步到两边） |
| `whale-body.json` | 她现在在哪段对话（恢复后还记得聊到哪） |
| `bili-whale.config.json` + B站 凭据 | 一起用时，恢复出来 B站 也是登着的 |
| `qq.json` + 登录状态 | QQ 这边不用重新扫码 |
| `whale-work/` | 她写过的东西（调试脚本自动滤掉） |
| `sessions/` | 对话全文 |

恢复：`node tools/qq-backup.mjs --restore --from "<备份目录>" --go`（不加 `--go` 只列清单）

> ⚠️ 备份里有登录状态和日记，**别传到公开的地方**。
>
> 注意：备份是**手动跑命令**触发的，装完不会自己生成。

---

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

## 群聊（2026-11-07）

主人说的原话：

> 「把你拉进群聊，主人 @ 你就回答主人，别人 @ 你就先问主人再回」

### 规矩

| 谁 @ 她 | 怎么处理 |
|---|---|
| **主人本人** | 当场回，回在**那个群**里 ✓ |
| **别人** | 草稿进待审队列 + 推一条私信给主人 → **他点头才发到群里** ✓ |
| 没 @ 她 | 不理（`needAt` 可以关，但默认开）|
| 名单外的群 | 一个字都不碰 |

### ⚠️ 群聊只有主人能邀请她（2026-11-07 主人补的）

> 「群聊只有我能邀请你，你不能乱进」

这条不是靠自觉，是靠**三道闸**：

1. **名单只认主人放的** —— 每条群记录带 `invitedBy: 'owner'`。
   别的来源（别的程序写进去的、手滑的、老配置里莫名冒出来的）一律不算 ✗
2. **加群前先问她真的在不在** —— `POST /groups/add` 会问一次 NapCat：
   不在那个群里就**拒绝加入**（不在里面还加进来，等于答应去一个进不去的地方）
3. **回话也过一道** —— 就算她在回复文件里写了 `[群:xxx]`，
   发之前仍然要过 `canReplyToGroup()`：群在名单里 + 是主人邀请的 + 总开关开着 + 群没被关。
   任何一条不满足 → **不发到群**，改成私信告诉主人「这条本来想发群，被拦了」✓

控制台上那个「只认我邀请的群」（`group.ownerOnly`）就是第 1 道闸的开关 —— **建议一直开着**。

几个容易忽略但必须有的判断：

- **@全体成员 不算叫她**（`qq=all`）—— 不然群里随便一个 @全体 就把她叫出来了 ✗
- **别人 @ 的是主人**，不是她 → 也不理
- **她自己发的话不算来信**（跟私信那条 2026-11-04 刷屏的坑同源）
- **私信混进群历史** 也不算群消息（写测试时抓到过一次，`message_type` 必须校验）

### 回话写到哪

回话文件还是 `whale-work/dm-reply-qq.txt`，一行一句，**行首多一个可选标记**：

```
[群:123456789] 好呀，我也在看
私下再跟你说一句（没有标记 = 私信）
```

没写标记就照旧发私信 —— **文件格式没变**，老习惯不用改 ✓

### 控制台

「设置 → 养鱼 · QQ」里多了「群聊」一组：

- **在哪些群里说话**：直接把她加过的群列出来，点一下就加进名单（`NapCat get_group_list`）
- 拉不到列表（没登录 / 实现不给）→ 手动填群号
- 三个开关：`listen`（在不在群里说话）、`needAt`（只有 @ 才理）、`askWhenOthers`（别人喊她先问主人）
- `quoteContext`：别人喊她的时候，带上前几句给你看 —— 只看到一句「你怎么看」没法判 ✓

### 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-whale/api/channels/qq/groups` | 我加过的群 + 现在配了哪些（含实时状态） |
| POST | `/dsh-whale/api/channels/qq/groups/add` | `{id, name?}` → 加进名单（**立刻生效**） |
| POST | `/dsh-whale/api/channels/qq/groups/remove` | `{id}` → 从名单拿掉 |

### 前置条件

- 群消息走的是 `get_group_msg_history`（NapCat / LLOneBot 的扩展，**不在 OneBot 11 标准里**）。
  实现不给这个 action 的话，日志里会写「这个 OneBot 实现可能不支持群历史」，但**不会假装没消息** ✓
- 前提是她的号本来就在那个群里（QQ 没有「机器人被拉进去」这种权限模型，就是普通账号）
- 群消息轮询比私信慢（默认 20 秒一轮，一次问一个群，轮着来）—— 群多的时候不撞限流 ✓

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

## 记忆、备份、复活（2026-11-04 新增）

### 她的记忆在哪

**不在对话框里，在这几个文件里** —— 所以「换一段新对话」不会让她失忆：

| 文件 | 内容 | 和 B 站共用吗 |
|---|---|---|
| `~/.dsh/whale-diary.md` | 日记 | ✅ 共用 |
| `~/.dsh/whale-diary-private.md` | 私密日记 | ✅ 共用 |
| `~/.bili-ai/persona.md` | 人设 | ✅ 共用 |
| `~/.dsh/whale-rules.md` | 规则和改动 | ✅ 共用 |

> 一条鱼两个入口 —— 你在 QQ 说的话，她在 B 站也记得；反之一样。

### 定期换上下文

设置页 →「**记忆与上下文**」：

| 项 | 说明 |
|---|---|
| `sessionRotateDays` | 每隔几天换一段新对话。`0` = 一直用同一段（会越来越长）；`1` = 每天换 |
| `personaOncePerSession` | 同一段对话里只说一次「我是谁」。开着省上下文 |

**换上下文 ≠ 失忆**：换的是对话窗口（避免越来越长），
记忆还在日记里。换之前她会把这段对话里值得记的东西写进日记，
新对话的第一句会带上「先读日记恢复记忆」的指引。

和 B 站用**同一套规则**（按自然日，不是 24 小时）。

### 备份 / 复活

```bash
# 备份（默认到桌面「她QQ的备份」）
node tools/qq-backup.mjs

# 指定目录
node tools/qq-backup.mjs --to D:\我的备份

# 只看会拷什么，不实际拷
node tools/qq-backup.mjs --dry

# 复活：先预演，看清楚会动哪些文件
node tools/qq-backup.mjs --restore --from "D:\我的备份" --dry
# 确认没问题再真恢复
node tools/qq-backup.mjs --restore --from "D:\我的备份" --go
```

**备份包含什么**：

| 类别 | 内容 |
|---|---|
| 她是谁 | `persona.md`（**两个入口共用这一份**） |
| 记忆 | 日记、私密日记、规则 |
| QQ 设置 | `qq.json`、通道开关、共用设置 |
| 运行时状态 | 登录态、待审队列、作息计数 |
| 她写过的东西 | `whale-work/`（只留文档/图片/语音，**调试脚本自动滤掉**） |
| 对话全文 | `sessions/` |

备份目录里会生成一份 `怎么复活她.md`，别人拿到也知道怎么用。

**三条安全设计**：

1. **白名单** —— 只拷明确列出的，不做整目录镜像（免得把缓存日志搬走）
2. **不覆盖对话全文** —— 恢复时 `sessions/` 默认跳过，怕盖掉更新的记录
3. **必须 `--go`** —— 不加只会列清单，不会动任何文件

> ⚠️ 备份里有登录状态和日记，**别传到公开的地方**。

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

## 还没做

- **投给会话**：收到消息之后真正叫醒她，要靠 core 的 session-delivery（下一步接）
- **语音条**：`voice.enabled` 目前只是个开关位，TTS 没接
- **群**：只做了私聊。要不要进群得主人定
