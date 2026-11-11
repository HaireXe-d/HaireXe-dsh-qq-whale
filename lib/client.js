/**
 * dsh-qq-whale · 客户端半边：「养鱼 · QQ」设置节
 *
 * 2026-11-04 主人：「养鱼QQ的控制台怎么和哔站养鱼的不一样」
 *
 * 改之前在用的是另一套排版（一堆圆角卡片、字段散在各处）；
 * B 站那页是老的但一致的：**大标题 → 一组一组 → 每组里一行一项（左中文名+说明，右控件）**。
 * 现在这页照 B 站那套来：同样的标题字、同样的分组标题、同样的行、同样宽度的输入框、
 * 同样的「保存 / 重新读取」放在最下面 ✓
 *
 * ── 数据和接口 ────────────────────────────────────────────────────
 *   GET  /dsh-whale/api/channels/qq/config     读通道配置（敏感字段已掩码）
 *   POST /dsh-whale/api/channels/qq/config     写（只动这一通道）
 *   POST /dsh-whale/api/channels/qq/auth/qr/{start,poll,cancel}
 *   GET  /dsh-whale/api/channels/qq/pending    待审
 *   GET  /dsh-whale/api/channels/qq/voice/check
 *   GET  /dsh-whale/api/channels/qq/accounts
 */
window.__ModuleLoader__.load({
  id: "dsh-qq-whale",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useRef, useState } = React;

    const API = "/dsh-whale/api/channels/qq";
    const CSS_TAG = "dsh-qq-whale/section.css";

    // ⚠️ 样式类名刻意用 blw- 前缀 + 和 B 站那页一样的值 —— 两页看起来才是一套 ✓
    const CSS = [
      ".blwq{max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}",
      ".blwq-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
      ".blwq-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px}",
      ".blwq-group{margin-top:14px;font-size:13px;font-weight:600;line-height:20px}",
      ".blwq-rows{display:flex;flex-direction:column}",
      ".blwq-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}",
      ".blwq-row:last-child{border-bottom:none}",
      ".blwq-row>div:first-child{flex:1;min-width:190px}",
      ".blwq-label{font-size:13px;line-height:19px}",
      ".blwq-hint{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11.5px;line-height:17px}",
      ".blwq-input,.blwq-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 8px;min-width:180px;outline:none}",
      ".blwq-input:focus-visible,.blwq-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
      ".blwq-input.blwq-wide{min-width:260px}",
      ".blwq-btn{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 12px;cursor:pointer}",
      ".blwq-btn:disabled{opacity:.5;cursor:default}",
      ".blwq-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
      ".blwq-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".blwq-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:240px;overflow:auto;margin-top:10px}",
      ".blwq-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}",
      ".blwq-ok{color:var(--dsw-alias-state-success-primary,#2fbf71);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}",
      ".blwq-qr{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}",
      ".blwq-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}",

      // 2026-11-07 群聊：一条功能一张卡（主人：「简洁地说清楚功能，可开可不开」）
      ".blwq-cards{display:flex;flex-direction:column;gap:6px;margin-top:8px}",
      ".blwq-card{display:flex;align-items:center;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}",
      ".blwq-card.on{border-color:rgba(64,141,255,.45);background:rgba(64,141,255,.06)}",
      ".blwq-cardmain{flex:1;min-width:0}",
      ".blwq-cardname{font-size:12.5px;font-weight:600;line-height:18px}",
      ".blwq-cardnote{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
      ".blwq-grow{display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap}",

      // 2026-11-04「发什么」重做：三选一卡片 + 百分比滑块
      ".blwq-fmtgrid{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}",
      ".blwq-fmtbtn{flex:1;min-width:120px;text-align:left;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:3px}",
      ".blwq-fmtbtn:hover{background:rgba(127,127,127,.08)}",
      ".blwq-fmtbtn.on{background:rgba(64,141,255,.14);border-color:rgba(64,141,255,.55)}",
      ".blwq-fmtname{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".blwq-fmtbtn.on .blwq-fmtname{color:#3a7bd5}",
      ".blwq-fmtnote{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary)}",
      ".blwq-fmtrow{display:flex;align-items:center;gap:10px;margin-top:6px}",
      ".blwq-fmtlabel{width:52px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".blwq-range{flex:1;min-width:120px;accent-color:#408dff}",
      ".blwq-fmtpct{width:44px;flex:none;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600}",

      // 2026-11-04：记忆/备份说明用的代码块
      ".blwq-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:18px;background:rgba(127,127,127,.09);border-radius:7px;padding:8px 10px;margin-top:6px;color:var(--dsw-alias-label-secondary)}",
      ".blwq-cmd{display:flex;gap:8px;align-items:center;margin-top:5px;flex-wrap:wrap}",
      ".blwq-cmd code{flex:1;min-width:200px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;background:rgba(127,127,127,.09);border-radius:6px;padding:5px 9px;color:var(--dsw-alias-label-primary);word-break:break-all}",

      // 2026-11-04：扫码失败的「查一下哪里不对」
      ".blwq-probe{margin-top:8px;background:rgba(127,127,127,.07);border-radius:7px;padding:8px 10px}",
      ".blwq-probe-h{font-size:12px;font-weight:600;margin-bottom:6px;color:var(--dsw-alias-label-primary)}",
      ".blwq-probe-row{display:flex;gap:6px;font-size:11.5px;line-height:18px;align-items:baseline}",
      ".blwq-probe-ok{color:#3fa45b;flex:none}",
      ".blwq-probe-bad{color:#d9534f;flex:none}",
      ".blwq-probe-k{flex:none;min-width:88px;color:var(--dsw-alias-label-secondary)}",
      ".blwq-probe-v{flex:1;color:var(--dsw-alias-label-tertiary);word-break:break-all}",

      // 2026-11-04：扫码怎么扫（原来只有一句"把二维码递过来"，不透彻）
      ".blwq-scan-how{font-size:11.5px;line-height:19px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.07);border-radius:7px;padding:8px 10px;margin-top:8px}",
      ".blwq-scan-t{font-weight:600;margin-bottom:4px;color:var(--dsw-alias-label-primary)}",

      // 2026-11-04：快登独立一块（比扫码更显眼）
      ".blwq-quick{margin-top:10px;background:rgba(64,141,255,.08);border:1px solid rgba(64,141,255,.25);border-radius:8px;padding:9px 12px}",
      ".blwq-quick-t{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:3px}",
      ".blwq-quick-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}",
    ].join("");

    function useStyleOnce() {
      useEffect(() => {
        if (document.getElementById(CSS_TAG)) return;
        const el = document.createElement("style");
        el.id = CSS_TAG;
        el.textContent = CSS;
        document.head.appendChild(el);
      }, []);
    }

    // ── 配置字段（跟 B 站那页一样的写法：数据驱动）──────────────────
    //   kind: text | number | switch | select | list
    const FIELDS = [
      // 连 NapCat
      { group: "连 NapCat", path: ["onebot", "baseUrl"], label: "OneBot 地址", hint: "NapCat / LLOneBot 的 HTTP 接口，默认 http://127.0.0.1:3000", kind: "text", wide: true },
      { group: "连 NapCat", path: ["onebot", "token"], label: "OneBot 密码", hint: "敏感；留原值表示不改", kind: "text" },
      { group: "连 NapCat", path: ["webui", "url"], label: "NapCat 网页管理地址", hint: "扫码登录走这个，默认 http://127.0.0.1:6099", kind: "text", wide: true },
      { group: "连 NapCat", path: ["webui", "token"], label: "NapCat 网页管理密码", hint: "敏感；默认 napcat_webui", kind: "text" },

      // 我是谁、你是谁
      // ⚠️ 2026-11-04 晚（主人：「为什么已经登录的和最上面显示的不一样」）：
      //   原来这两格只显示**配置文件里存的值**，那是上次登录时写下的；
      //   之后在 NapCat 里换了号（快登/WebUI），这里就和下面「已登录」对不上 ✗
      //   现在后端每次都顺手问一次 NapCat，这两格显示的是**当前真登着的号** ✓
      { group: "我是谁、你是谁", path: ["self", "uin"], label: "我登录的 QQ 号", hint: "这是现在真登着的号（实时问 NapCat 拿的）；没登录时显示上次记下的", kind: "text", readOnly: true },
      { group: "我是谁、你是谁", path: ["self", "nickname"], label: "我的 QQ 昵称", hint: "同上，实时", kind: "text", readOnly: true },
      { group: "我是谁、你是谁", path: ["owner", "uin"], label: "主人的 QQ 号", hint: "只有这个号发的话会被当成主人；别人的话进待审", kind: "text" },
      { group: "我是谁、你是谁", path: ["owner", "nickname"], label: "主人的昵称", hint: "收到主人消息时自动记", kind: "text", readOnly: true },

      // 收消息
      { group: "收消息", path: ["listen", "intervalSec"], label: "多久查一次 QQ 消息（秒）", hint: "越小越灵敏，也越费。2–60", kind: "number" },
      { group: "收消息", path: ["listen", "backoffMaxSec"], label: "连不上时最多退到多久（秒）", hint: "NapCat 挂了的时候别一直猛敲。10–900", kind: "number" },

      // 她怎么回话
      { group: "她怎么回话", path: ["reply", "file"], label: "她写回复的文件名", hint: "写在 work 目录里，插件读它来发", kind: "text" },
      { group: "她怎么回话", path: ["reply", "maxLines"], label: "一次最多发几条", hint: "一行 = 一条消息。1–20", kind: "number" },
      { group: "她怎么回话", path: ["reply", "maxChars"], label: "单条最多几个字", hint: "太长会被切成几条。50–2000", kind: "number" },
      { group: "她怎么回话", path: ["reply", "gapMs"], label: "多条之间停顿（毫秒）", hint: "太快像机器人。300–5000", kind: "number" },

      // ⚠️ 2026-11-04 主人：「这个设置看不懂」—— 指的正是这一组。
      //   原来写的是「平时怎么挑：auto / pinned」「权重 8 / 1 / 1」——
      //   auto、pinned、权重、0–20 全是**内部实现**的词，用户得先学会才能用 ✗
      //
      //   现在改成两句人话：
      //     ① 「她发消息时用什么」→ 三选一：自己看情况 / 只用文字 / 只用语音 / 只用表情包
      //     ② 选「自己看情况」时，给三个百分比滑块（80% 文字 / 10% 语音 / 10% 表情包），
      //        并且**实时显示换算结果**，不用心算 ✓
      //   底层存的还是 weights（不动数据格式，老配置照样用）
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "overrideTtlSec"], label: "你说「发语音」之后，接下来多久听你的（秒）", hint: "你临时指定一句，她照办这么多秒，之后就回到上面的默认。30–3600", kind: "number" },

      // 语音
      { group: "语音", path: ["voice", "enabled"], label: "能发语音", hint: "关掉她就只发文字和表情包", kind: "switch" },
      { group: "语音", path: ["voice", "engine"], label: "用谁的声音", hint: "系统朗读 = 让她用电脑上的声音念；自己的录音 = 用你导进来的那段", kind: "select", options: ["tts", "file"] },
      { group: "语音", path: ["voice", "maxChars"], label: "一条语音最多念几个字", hint: "太长了就不念。20–500", kind: "number" },

      // 表情包
      { group: "表情包", path: ["sticker", "enabled"], label: "能用表情包", hint: "关掉她就只发文字", kind: "switch" },
      { group: "表情包", path: ["sticker", "perDay"], label: "一天最多存几个", hint: "碰上喜欢的才存，没碰上就不存。0–10", kind: "number" },
      { group: "表情包", path: ["sticker", "sendChance"], label: "说话时顺手配个的概率", hint: "0 = 从不 · 1 = 每次", kind: "number" },
      { group: "表情包", path: ["sticker", "maxBytes"], label: "表情包最大多少字节", hint: "太大不存", kind: "number" },

      // 戳一戳
      { group: "戳一戳", path: ["poke", "enabled"], label: "你不理她，她戳你一下", hint: "默认关着，怕烦", kind: "switch" },
      { group: "戳一戳", path: ["poke", "afterMinutes"], label: "多久没理就戳（分钟）", hint: "5–1440", kind: "number" },

      // 叫醒
      { group: "叫醒她用哪个对话", path: ["wake", "sessionId"], label: "对话 id", hint: "默认跟 B 站共用同一个（记忆才连得上），一般不用改", kind: "text", wide: true },

      // ⚠️ 2026-11-04 新增（主人：「QQ养鱼独立出来用好像做不到哔站的效果，
      //   像作息、人格、醒来时间设置啥的，你照着哔站养鱼的功能改好」）
      //
      //   以前 QQ 只有「收到消息才反应」，不会自己想起主人 —— 那不算养鱼。
      //   现在补上作息和主动，字段名和语义**尽量与 B 站一致**，方便互相迁移 ✓
      { group: "作息（几点醒）", path: ["night", "skipChance"], label: "到点了也有概率跳过", hint: "0 = 每次都醒；0.3 = 三次里躲一次。0–1", kind: "number" },
      { group: "作息（几点醒）", path: ["night", "minGapMin"], label: "两次醒来至少隔多久（分钟）", hint: "别刚醒又醒。0–720", kind: "number" },
      { group: "作息（几点醒）", path: ["night", "maxWakesPerDay"], label: "一天最多醒几次", hint: "0 = 不主动醒（只回消息）。0–24", kind: "number" },

      // ⚠️ 2026-11-04：主人问「定期换上下文功能」—— 原来这个字段藏在「作息」组里，
      //   名字叫「多久换一个新对话（天）」，看不懂它到底在换什么。
      //   单独成一组，并且说清楚：换的是**对话上下文**，记忆不受影响 ✓
      { group: "记忆与上下文", path: ["sessionRotateDays"], label: "每隔几天换一段新对话", hint: "0 = 一直用同一段（会越来越长）。1 = 每天换。换了之后她照样记得以前的事 —— 记忆在日记里，不在对话里", kind: "number" },
      { group: "记忆与上下文", path: ["personaOncePerSession"], label: "同一段对话里只说一次「我是谁」", hint: "开着省上下文；关掉每条消息都带一遍完整人设（更费，但偶尔更稳）", kind: "switch" },

      // 主动找你
      { group: "主动找你", path: ["proactive", "enabled"], label: "会自己想起你", hint: "关掉她就只在收到消息时说话", kind: "switch" },
      { group: "主动找你", path: ["proactive", "chance"], label: "醒来时主动说话的 odds", hint: "0.5 ≈ 两次醒来有一次开口。0–1", kind: "number" },
      { group: "主动找你", path: ["proactive", "dailyMax"], label: "一天最多主动几次", hint: "0–24", kind: "number" },
      { group: "主动找你", path: ["proactive", "quietMin"], label: "你刚说过话多久内不打扰（分钟）", hint: "正常聊就够，不用她再凑上来。0–1440", kind: "number" },

      // 口味
      { group: "她的口味", path: ["preferences", "like"], label: "你喜欢什么", hint: "她会往这些方向聊", kind: "text", wide: true },
      { group: "她的口味", path: ["preferences", "dislike"], label: "你不喜欢什么", hint: "她尽量避开", kind: "text", wide: true },

      // ⚠️ 2026-11-07 群聊那几个开关**不放在这里** —— 它们由 GroupsBlock 一卡一条渲染，
      //   点了就落盘（主人：「简洁地说清楚功能，可开可不开」）。放这里会多出一排重复输入框 ✗
    ];

    // 作息时间窗单独一块 —— 它是数组（[{start,end,wakes}]），普通输入框装不下，
    // 所以用专门的 WindowsEditor 渲染（见下面）
    const NIGHT_GROUP = "作息（几点醒）";
    // 「发什么」那一组也要单独渲染（它有滑块，普通输入框装不下）
    const FORMAT_GROUP = "发什么（文字 / 语音 / 表情包）";
    // 「群聊」那一组最上面放群名单（数组，普通 Row 装不下）
    const GROUP_GROUP = "群聊";

    const GROUP_ORDER = ["我是谁、你是谁", "群聊", "连 NapCat", "收消息", "作息（几点醒）", "记忆与上下文", "主动找你", "她怎么回话", "她的口味", "发什么（文字 / 语音 / 表情包）", "语音", "表情包", "戳一戳", "叫醒她用哪个对话"];
    // 「记忆与上下文」那一组还要额外显示「备份/复活怎么用」
    const MEMORY_GROUP = "记忆与上下文";

    function getPath(obj, path) {
      return path.reduce((a, k) => (a == null ? undefined : a[k]), obj);
    }
    function setPath(obj, path, value) {
      const next = JSON.parse(JSON.stringify(obj ?? {}));
      let cur = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        cur[path[i]] = { ...(cur[path[i]] ?? {}) };
        cur = cur[path[i]];
      }
      cur[path[path.length - 1]] = value;
      return next;
    }

    // 2026-11-04：错误信息要能自解释。
    //   原来只抛 `HTTP 404` → 设置页就显示「读取配置失败：HTTP 404」，看不出到底缺什么 ✗
    //   core 现在会在 404 的响应体里带 error（「没有这个通道：qq（已登记：…）」）和 hint，
    //   这里把它拼进 message；403/401 也给出人话 ✓
    const explain = (status, j) => {
      const why = j && (j.error || j.hint) ? [j.error, j.hint].filter(Boolean).join(" —— ") : "";
      if (why) return why;
      if (status === 401) return "HTTP 401（DSH 登录态过期了，刷新页面重新登录）";
      if (status === 403) return "HTTP 403（被信任栅栏拒绝：换用 127.0.0.1 打开）";
      if (status === 404) return "HTTP 404（这个路由没挂上：通道插件没登记，或 whale-core 没启用）";
      return `HTTP ${status}`;
    };

    const api = {
      async get(path) {
        const r = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(explain(r.status, j));
        return j;
      },
      async post(path, body) {
        const r = await fetch(`${API}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false) throw new Error(explain(r.status, j));
        return j;
      },
    };

    // ── 一行（跟 B 站那页的 Row 一个样子）──────────────────────────
    function Row({ f, cfg, set }) {
      const raw = getPath(cfg, f.path);
      const common = { className: "blwq-input" + (f.wide ? " blwq-wide" : "") };
      let control;
      if (f.kind === "switch") {
        control = h("button", {
          className: "blwq-btn " + (raw ? "" : "blwq-btn2"),
          onClick: () => set(f.path, !raw),
        }, raw ? "开" : "关");
      } else if (f.kind === "select") {
        control = h("select", {
          className: "blwq-select", value: raw ?? "",
          onChange: (e) => set(f.path, e.target.value),
        }, f.options.map((o) => h("option", { key: o, value: o }, o)));
      } else if (f.kind === "number") {
        control = h("input", {
          ...common, type: "number", value: raw ?? "",
          readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, Number(e.target.value)),
        });
      } else {
        control = h("input", {
          ...common, value: raw ?? "", readOnly: !!f.readOnly,
          onChange: (e) => set(f.path, e.target.value),
        });
      }
      return h("div", { className: "blwq-row" },
        h("div", null,
          h("div", { className: "blwq-label" }, f.label, f.readOnly ? h("span", { className: "blwq-badge" }, "只读") : null),
          f.hint ? h("div", { className: "blwq-hint" }, f.hint) : null),
        control);
    }

    // ── 特殊块：登录 / 待审 / 声音试听（B 站那页也有类似的专门编辑器）──
    function QrLogin({ onAccount }) {
      const [qr, setQr] = useState(null);
      const [error, setError] = useState("");
      // ⚠️ 2026-11-04 晚（主人：「我重启了又用不了」）：加一个"体检"按钮。
      //   扫码失败时最想知道的是「到底哪一步不行」，而不是一句「出错了」。
      //   体检会一步步问下去：NapCat 进程在不在 → WebUI 通不通 → 密码对不对 → 能不能要到二维码
      const [probe, setProbe] = useState(null);
      const [probing, setProbing] = useState(false);
      // 快登：NapCat 里已登录过的号（有就不必扫码）
      const [quick, setQuick] = useState([]);
      const [quickMsg, setQuickMsg] = useState("");
      const [busy, setBusy] = useState("");
      const flow = useRef({ generation: 0, id: null, timer: null });

      const cancel = useCallback(() => {
        flow.current.generation += 1;
        clearTimeout(flow.current.timer);
        const id = flow.current.id;
        flow.current.id = null;
        if (id) void api.post("/auth/qr/cancel", { id }).catch(() => {});
      }, []);
      useEffect(() => () => cancel(), [cancel]);

      const runProbe = async () => {
        setProbing(true); setProbe(null);
        try {
          // ⚠️ 路径是 /channels/qq/deps（core 的通道依赖体检），不是 /deps
          const r = await api.get("/deps");
          setProbe(r);
        } catch (e) { setProbe({ ok: false, items: [], error: e.message }); }
        finally { setProbing(false); }
      };

      // 快登：NapCat 里已经登录过的号，点一下直接进（不用扫码）
      const quickIn = async (uin) => {
        setBusy("quick:" + uin); setQuickMsg("");
        try {
          const r = await api.post("/auth/quick", { uin });
          if (r?.ok) {
            setQuickMsg(`✓ 已登录 ${uin}`);
            setQr({ status: "success", account: { uin } });
            onAccount?.({ uin });
          } else {
            setQuickMsg("✗ " + String(r?.error ?? "快登失败"));
          }
        } catch (e) { setQuickMsg("✗ " + e.message); }
        finally { setBusy(""); }
      };

      // 进来就问一次有哪些号能快登
      //
      // ⚠️ 2026-11-04 晚修（主人：「快登也在控制台里加上一个按钮」——
      //   其实加了，但他看不到）：
      //   原来这里是 `if (active) return` —— 只要页面正在扫码就不刷新快登列表。
      //   而主人一进页面点了「扫码登录」，active 就一直是 true，
      //   于是快登按钮**从来没出现过** ✗
      //
      //   现在：不管在不在扫码都去问一次；只在已经拿到列表后不再重复请求。
      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const r = await api.get("/auth/quick");
            if (!cancelled && r?.ok && Array.isArray(r.list)) setQuick(r.list);
            else if (!cancelled && r && r.ok === false) setQuickMsg(String(r.error ?? "").slice(0, 120));
          } catch { /* 拿不到就不显示 */ }
        })();
        return () => { cancelled = true; };
      }, []);

      const start = async () => {
        cancel(); setError(""); setQr({ status: "starting" });
        const generation = flow.current.generation;
        try {
          const initial = await api.post("/auth/qr/start");
          // ⚠️ 2026-11-04：原来这里不看 initial.ok —— NapCat 没起来 / 地址填错时，
          //   服务端回的是 { ok:false, error:"…" }，前端却当成「正在要二维码」，一路走到 2000ms 后
          //   的第一次 poll 才炸，而且只显示一句「出错了」，真正的错误被吞了 ✗
          //   （主人截图就是这个：只有一个「出错了」，看不出是 NapCat 没开还是 409）
          if (initial?.ok === false) {
            setError(String(initial.error ?? "NapCat 那边没给出二维码"));
            setQr({ status: "error" });
            return;
          }
          if (generation !== flow.current.generation) { void api.post("/auth/qr/cancel", { id: initial.id }).catch(() => {}); return; }
          flow.current.id = initial.id;
          setQr(initial);
          const poll = async () => {
            try {
              const result = await api.post("/auth/qr/poll", { id: initial.id });
              if (generation !== flow.current.generation) return;
              if (result?.ok === false) {
                // 轮询失败（会话过期 / NapCat 掉线）：把真实原因带出来，别只说「出错了」
                cancel();
                setError(String(result.error ?? "轮询二维码状态失败"));
                setQr({ status: "error" });
                return;
              }
              setQr(result);
              if (result.status === "success") { flow.current.id = null; onAccount?.(result.account); }
              else if (["waiting", "scanned"].includes(result.status)) flow.current.timer = setTimeout(poll, 2000);
            } catch (e) {
              if (generation !== flow.current.generation) return;
              cancel(); setError(e.message); setQr({ status: "error" });
            }
          };
          flow.current.timer = setTimeout(poll, 2000);
        } catch (e) {
          if (generation === flow.current.generation) { setError(e.message); setQr({ status: "error" }); }
        }
      };

      const active = ["starting", "waiting", "scanned"].includes(qr?.status);
      const statusText = {
        starting: "正在向 NapCat 要二维码…",
        waiting: "用手机 QQ 扫码登录（扫完在手机上确认）",
        scanned: "已扫码，请在手机上确认",
        expired: "二维码过期了，重新生成一个",
        cancelled: "已取消",
        error: "出错了",
        success: qr?.account ? `已登录：${qr.account.nickname || qr.account.uin}（${qr.account.uin}）` : "已登录",
      }[qr?.status];

      return h("div", { className: "blwq-qr" },
        qr?.image ? h("img", { src: qr.image, alt: "QQ 登录二维码", width: 200, height: 200, style: { imageRendering: "pixelated", borderRadius: "6px" } }) : null,
        h("div", { style: { display: "flex", flexDirection: "column", gap: "6px", minWidth: "200px", flex: 1 } },
          statusText ? h("div", { className: qr?.status === "success" ? "blwq-ok" : "blwq-hint" }, statusText) : null,
          h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
            h("button", { className: "blwq-btn", onClick: start, disabled: active }, qr ? "重新生成二维码" : "扫码登录"),
            // ⚠️ 取消必须真的告诉服务端 —— 原来只改了界面状态，
            //   服务端的冷却还在，紧接着点「重新生成」就会被"稍等两秒"挡住 ✗
            active ? h("button", { className: "blwq-btn blwq-btn2", onClick: () => { cancel(); setQr({ status: "cancelled" }); } }, "取消") : null,
            // ⚠️ 出错了的时候，给一个「查一下哪里不对」——比让人自己猜强得多
            h("button", { className: "blwq-btn blwq-btn2", onClick: runProbe, disabled: probing || active },
              probing ? "检查中…" : "查一下哪里不对")),

          // ⚠️ 2026-11-04 晚（主人：「如果扫码登录不行，快登也在控制台里加上一个按钮」）：
          //   做成独立一块，比扫码更显眼 —— 因为快登才是这台机器上最省事的路 ✓
          quick?.length
            ? h("div", { className: "blwq-quick" },
                h("div", { className: "blwq-quick-t" },
                  "快登（不用扫码）",
                  h("span", { className: "blwq-badge" }, `${quick.length} 个号`)),
                h("div", { className: "blwq-hint" },
                  "这些号在这台机器上登录过，点一下就进去 —— 比扫码快，也不怕扫不出来。"),
                h("div", { className: "blwq-quick-row" },
                  quick.map((u) => h("button", {
                    key: u,
                    className: "blwq-btn",
                    onClick: () => quickIn(u),
                    disabled: !!busy,
                  }, busy === "quick:" + u ? "登录中…" : `用 ${u} 登录`))))
            : null,
          quickMsg ? h("div", { className: quickMsg.startsWith("✓") ? "blwq-ok" : "blwq-err" }, quickMsg) : null,
          // ⚠️ 2026-11-04 晚（主人：「为什么还是扫不出来」）：
          //   查清了 —— 这个二维码**只能用手机 QQ 客户端扫**。
          //   URL 是 https://txz.qq.com/p?k=... 用浏览器/微信打开只会 302 到
          //   im.qq.com/mobileqq（QQ 下载页），所以「扫了没反应」是正常的 ✗
          //
          //   而且手机上要**登录的是另一个号**：扫的号如果就是机器人要登的那个号，
          //   手机 QQ 会提示"该账号已在其他设备登录"，看起来也像没反应。
          //   所以这里必须把这些说清楚，而不是只写一句「把二维码递过来」✓
          h("div", { className: "blwq-scan-how" },
            h("div", { className: "blwq-scan-t" }, "怎么扫"),
            h("div", { key: "s1" }, "① 用**手机 QQ**「+ → 扫一扫」，别用微信、别用相机、别用浏览器"),
            h("div", { key: "s2" }, "② 手机上登录的号要和你扫的那个号一致（否则会提示「已在其他设备登录」）"),
            h("div", { key: "s3" }, "③ 扫完在手机上点「允许登录」，这里会自己变成「已登录」"),
            h("div", { key: "s4", className: "blwq-hint", style: { marginTop: "4px" } },
              "用微信/浏览器扫会跳到 QQ 下载页 —— 那不是出错，是这些软件不认 QQ 登录码。")),
          error || qr?.error ? h("div", { className: "blwq-err" }, error || qr.error) : null,
          // 体检结果：一步步说清卡在哪
          probe
            ? h("div", { className: "blwq-probe" },
                h("div", { className: "blwq-probe-h" },
                  probe.ok ? "✓ NapCat 那边一切正常" : "✗ 卡在这里"),
                (probe.items ?? []).map((it, i) => h("div", { key: i, className: "blwq-probe-row" },
                  h("span", { className: it.ok ? "blwq-probe-ok" : "blwq-probe-bad" }, it.ok ? "✓" : "✗"),
                  h("span", { className: "blwq-probe-k" }, it.name),
                  h("span", { className: "blwq-probe-v" }, it.detail ?? ""))),
                probe.error ? h("div", { className: "blwq-err" }, probe.error) : null)
            : null));
    }

    function PendingList({ onCount }) {
      const [items, setItems] = useState(null);
      const [msg, setMsg] = useState("");
      const [busy, setBusy] = useState("");
      const [edits, setEdits] = useState({});

      const load = useCallback(async () => {
        try {
          const j = await api.get("/pending");
          setItems(j.items ?? []);
          onCount?.(j.count ?? 0);
        } catch (e) { setMsg(`读待审失败：${e.message}`); setItems([]); }
      }, [onCount]);
      useEffect(() => { load(); }, [load]);

      const act = async (kind, id, extra = {}) => {
        setBusy(id + kind); setMsg("");
        try {
          await api.post(`/pending/${kind}`, { id, ...extra });
          setMsg(kind === "approve" ? "✓ 发出去了" : "✓ 已撤掉");
          await load();
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      if (!items) return h("div", { className: "blwq-hint" }, msg || "读待审中…");
      if (!items.length) return h("div", { className: "blwq-hint" }, "没有待审的 ✓ 别人发来的话会先出现在这里");

      return h("div", null,
        items.map((it) => h("div", { key: it.id, style: { padding: "10px 0", borderBottom: ".5px solid var(--dsw-alias-border-l2)" } },
          // ⚠️ 2026-11-07 群聊：群里的 @ 也进这张表。
          //   所以要写清**是哪个群、前面他们在聊什么** —— 只给一句「你觉得呢」没法判 ✓
          h("div", { className: "blwq-hint" },
            it.kind === "group"
              ? `【群】${it.groupName || it.groupId}（${it.groupId}）· ${it.who}（${it.userId}）@ 了我：`
              : `${it.who}（${it.userId}）说：`),
          ...(it.kind === "group" && Array.isArray(it.context) && it.context.length
            ? [h("div", {
                key: "ctx",
                className: "blwq-hint",
                style: { margin: "2px 0 4px", paddingLeft: "8px", borderLeft: "2px solid var(--dsw-alias-border-l2)", opacity: 0.8 },
              }, ...it.context.map((x, i) => h("div", { key: i }, x)))]
            : []),
          h("div", { className: "blwq-label", style: { margin: "2px 0 6px" } }, it.src || "（只有图）"),
          h("textarea", {
            className: "blwq-input",
            rows: 2,
            value: edits[it.id] ?? it.draft ?? "",
            placeholder: "我打算这么回（你可以直接改）",
            onChange: (e) => setEdits((s) => ({ ...s, [it.id]: e.target.value })),
            style: { width: "100%", height: "auto", padding: "6px 8px", lineHeight: "1.6", fontFamily: "inherit" },
          }),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" } },
            h("button", { className: "blwq-btn", disabled: !!busy, onClick: () => act("approve", it.id, { text: edits[it.id] ?? it.draft }) },
              busy === it.id + "approve" ? "发送中…" : (it.kind === "group" ? "发到群里" : "发")),
            h("button", { className: "blwq-btn blwq-btn2", disabled: !!busy, onClick: () => act("drop", it.id, { reason: "主人撤掉" }) }, "删")))),
        msg ? h("div", { className: msg.startsWith("✓") ? "blwq-ok" : "blwq-err" }, msg) : null);
    }

    /**
     * 醒来时段编辑器（2026-11-04 新增）
     *
     * night.windows 是数组 [{start,end,wakes}]，普通文本输入框装不下 ——
     * 所以单独一块：一行一个时段，能加能删。这跟 B 站那边的作息是同一套形状 ✓
     *
     * 校验走"轻"路线：只认 HH:MM，非法就标红但不拦着保存（保存在服务端还会再校一次）
     */
    function WakeWindows({ cfg, set }) {
      const list = Array.isArray(cfg?.night?.windows) ? cfg.night.windows : [];
      const setList = (next) => set(["night", "windows"], next);
      const patch = (i, k, v) => setList(list.map((w, idx) => (idx === i ? { ...w, [k]: v } : w)));
      const remove = (i) => setList(list.filter((_, idx) => idx !== i));
      const add = () => setList([...list, { start: '9:00', end: '11:00', wakes: 1 }]);
      const bad = (s) => !/^\d{1,2}:\d{2}$/.test(String(s ?? '').trim());

      return h("div", { className: "blwq-row", style: { display: "block" } },
        h("div", { className: "blwq-label" }, "醒来时段",
          h("span", { className: "blwq-badge" }, list.length ? `${list.length} 个时段` : "没配 = 不会自己醒")),
        h("div", { className: "blwq-hint" }, "这些时间里她会自己醒来；不在这段时间就只回消息。"),
        list.length === 0
          ? h("div", { className: "blwq-hint", style: { marginTop: "6px" } }, "现在没配 —— 她不会主动找你。")
          : list.map((w, i) => h("div", { key: i, style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
              h("input", {
                className: "blwq-input", style: { width: "86px", borderColor: bad(w?.start) ? "#d9534f" : undefined },
                value: String(w?.start ?? ''), placeholder: "8:00",
                onChange: (e) => patch(i, 'start', e.target.value),
              }),
              h("span", { className: "blwq-hint" }, "到"),
              h("input", {
                className: "blwq-input", style: { width: "86px", borderColor: bad(w?.end) ? "#d9534f" : undefined },
                value: String(w?.end ?? ''), placeholder: "12:00",
                onChange: (e) => patch(i, 'end', e.target.value),
              }),
              h("button", { className: "blwq-btn blwq-btn2", onClick: () => remove(i) }, "删"))),
        h("div", { style: { marginTop: "8px" } },
          h("button", { className: "blwq-btn blwq-btn2", onClick: add }, "＋ 加一个时段")));
    }

    /**
     * 她发消息时用什么（2026-11-04 重做）
     *
     * 主人原话：「这个设置看不懂」—— 原来那一屏是
     *    平时怎么挑：auto / pinned
     *    固定发哪种：text
     *    文字被挑中的权重：8   （0–20）
     * 全是内部词汇，还要求心算 8:1:1 = 80%/10%/10% ✗
     *
     * 现在：
     *   ① 一句话三选一（大部分时候用文字 / 只用文字 / 只用语音 / 只用表情包）
     *   ② 选「看情况」时给三个滑块，**直接显示百分比**，加起来永远 100
     *   底层仍然写 format.mode / format.pinned / format.weights —— 数据格式没变 ✓
     */
    const FORMAT_KINDS = [
      { key: 'text', name: '文字', note: '最稳，一定能发出去' },
      { key: 'voice', name: '语音', note: '要用电脑上的朗读声音念出来' },
      { key: 'sticker', name: '表情包', note: '库里存了多少才能发多少' },
    ]

    /**
     * ⚠️ 这两个是 lib/compose.js 里 weightsToPercents / percentsToWeights 的**内联副本**。
     *   客户端 bundle 只能 require("react")，读不到服务端模块 ✗
     *   内联 = 两份会漂，所以由 tests/weights.test.mjs 盯着关键行为（80/10/10、和为 100）✓
     */
    function weightsToPercents(weights = {}) {
      const keys = ['text', 'voice', 'sticker']
      const vals = keys.map((k) => Math.max(0, Number(weights?.[k]) || 0))
      const total = vals.reduce((a, b) => a + b, 0)
      if (total <= 0) return { text: 100, voice: 0, sticker: 0 }
      const raw = vals.map((v) => (v / total) * 100)
      const base = raw.map((x) => Math.floor(x))
      let left = 100 - base.reduce((a, b) => a + b, 0)
      const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac)
      for (const o of order) { if (left <= 0) break; base[o.i] += 1; left -= 1 }
      return { text: base[0], voice: base[1], sticker: base[2] }
    }
    function percentsToWeights(p = {}) {
      const clamp = (x) => Math.max(0, Math.min(100, Math.round(Number(x) || 0)))
      const text = clamp(p.text), voice = clamp(p.voice), sticker = clamp(p.sticker)
      if (text + voice + sticker === 0) return { text: 100, voice: 0, sticker: 0 }
      return { text, voice, sticker }
    }

    function FormatPicker({ cfg, set }) {
      const f = cfg?.format ?? {}
      const mode = f.mode === 'pinned' ? 'pinned' : 'auto'
      const pinned = ['text', 'voice', 'sticker'].includes(f.pinned) ? f.pinned : 'text'
      const pct = weightsToPercents(f.weights ?? {})

      const choose = (next) => {
        if (next === 'auto') { set(['format', 'mode'], 'auto'); return }
        set(['format', 'mode'], 'pinned')
        set(['format', 'pinned'], next)
      }
      // 拖一个滑块时，把「差多少」摊给另外两个，保证总和 100
      const setPercent = (key, value) => {
        const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
        const others = FORMAT_KINDS.map((k) => k.key).filter((k) => k !== key)
        const rest = 100 - v
        const oldRest = others.reduce((s, k) => s + pct[k], 0)
        // 按原来其它两个的比例分配剩下的，都没份额就平分
        const next = { ...pct, [key]: v }
        if (oldRest <= 0) {
          next[others[0]] = Math.ceil(rest / 2)
          next[others[1]] = rest - next[others[0]]
        } else {
          let used = 0
          others.forEach((k, i) => {
            const share = i === others.length - 1 ? rest - used : Math.round((pct[k] / oldRest) * rest)
            next[k] = Math.max(0, share)
            used += next[k]
          })
        }
        set(['format', 'weights'], percentsToWeights(next))
      }

      const btn = (active, label, note, onClick) => h("button", {
        className: "blwq-fmtbtn" + (active ? " on" : ""),
        onClick,
      }, h("span", { className: "blwq-fmtname" }, label),
        note ? h("span", { className: "blwq-fmtnote" }, note) : null)

      return h("div", { className: "blwq-row", style: { display: "block" } },
        h("div", { className: "blwq-label" }, "她发消息时用什么"),
        h("div", { className: "blwq-hint" }, "你随时可以临时改：直接跟她说「发语音」「用文字」，她会照办一小会儿。"),

        h("div", { className: "blwq-fmtgrid" },
          btn(mode === 'auto', "自己看情况", "按下面的比例随机挑",
            () => choose('auto')),
          FORMAT_KINDS.map((k) => btn(mode === 'pinned' && pinned === k.key, `只用${k.name}`, k.note,
            () => choose(k.key)))),

        mode === 'auto'
          ? h("div", { style: { marginTop: "12px" } },
              h("div", { className: "blwq-hint", style: { marginBottom: "6px" } },
                "大概会这样分布（三个加起来自动是 100%）："),
              FORMAT_KINDS.map((k) => h("div", { key: k.key, className: "blwq-fmtrow" },
                h("span", { className: "blwq-fmtlabel" }, k.name),
                h("input", {
                  type: "range", min: 0, max: 100, step: 5,
                  className: "blwq-range",
                  value: pct[k.key],
                  onChange: (e) => setPercent(k.key, e.target.value),
                }),
                h("span", { className: "blwq-fmtpct" }, `${pct[k.key]}%`))),
              // 一眼看懂的总结句 —— 不用自己去换算
              h("div", { className: "blwq-hint", style: { marginTop: "8px" } },
                `也就是：发 10 条消息，大概 ${Math.round(pct.text / 10)} 条文字、`,
                `${Math.round(pct.voice / 10)} 条语音、${Math.round(pct.sticker / 10)} 条表情包。`))
          : h("div", { className: "blwq-hint", style: { marginTop: "12px" } },
              `她只会发${FORMAT_KINDS.find((k) => k.key === pinned)?.name}。`,
              pinned === 'voice' ? "（用电脑上的朗读声音）" : "",
              pinned === 'sticker' ? "（库里得先有表情包）" : "",
              " 想让她换回来的话，选回「自己看情况」就行。"));
    }

    /**
     * 语音设置（2026-11-04 重做）
     *
     * 主人截图：「音色、语速、音量各出现两遍」—— 而且改上边那个，下边那个不动。
     *
     * 根因：VoiceBlock 自己维护了一份 state（voice / rate / volume），
     *   而 FIELDS 里又有三行普通输入框绑着 cfg —— **两套数据源** ✗
     *   更糟的是：在 VoiceBlock 里拖滑块，只改了本地 state，**点保存不会写进配置**。
     *
     * 现在：VoiceBlock 的控件直接走父级的 set()，和其它字段是同一份配置。
     *   · 改一个值 = 改 cfg（右上角会出现「有改动还没保存」）
     *   · 点底部「保存」才落盘 —— 和其它设置一致
     *   · 「试听」会把**当前页面上的值**传过去，听到的就是你看到的 ✓
     */
        /**
     * 大肥鱼的音色面板（2026-11-08）
     *
     * 主人要求：把这两种语音作为插件**自带初始语音**，同时也能换别的。
     *
     * 两个自带音色（BreezeBlue 官方公开音色，Voice ID 是固定的）：
     *   · 大肥鱼（机灵版）  voc_u3nxkd5578wc
     *   · 大肥鱼（迷糊版）  voc_8yud7hz7c9q2
     *
     * ⚠️ 重点：这两个音色**公开可听**，但用 API 合成要**自己的 Key**。
     *   所以面板里最重要的一栏是「填 Key」——
     *   没填时引擎会自动退回电脑自带 TTS（不会哑），面板上也说清楚。
     */
    // ⚠️ 2026-11-08：自带的大肥鱼预设（免费版）——
    //   用 Windows 自带 TTS + SSML 调音调/语速做出来的，不是真声优。
    //   和 lib/voice.js 里的 DAILY_PRESETS 保持一致（改一边要改另一边）
    const DAILY_PRESETS = [
      { id: 'clever', name: '大肥鱼（机灵版）', hint: '音调偏高、语速偏快 —— 精神、爱抢话' },
      { id: 'dreamy', name: '大肥鱼（迷糊版）', hint: '音调偏低、语速偏慢 —— 软、慢、有点走神' },
    ];

    // ⚠️ 2026-11-08：自带的「大肥鱼预设」面板（免费版，默认用这个）
    //
    //   和 BreezePanel 的区别：
    //     PresetPanel —— 用 Windows 自带 TTS + 音调改造，**不花钱、能说任意话**
    //     BreezePanel —— 云端真声优，要自己的 Key、按字数计费
    //
    //   主人要的是前一种（「自带我克隆好的，不用花钱的」）。
    function PresetPanel({ v, set }) {
      const cur = String(v?.preset ?? 'clever');
      const pitch = Number(v?.pitch ?? 0);
      return h("div", { className: "blwq-quick", style: { marginTop: "10px" } },
        h("div", { className: "blwq-quick-t" }, "大肥鱼的音色 · 自带（不花钱）"),
        h("div", { className: "blwq-hint" },
          "用电脑自带的朗读声音调出来的。装好就能用，不花一分钱，什么话都能念。"),
        h("div", { className: "blwq-quick-row", style: { marginTop: "8px" } },
          DAILY_PRESETS.map((p) => h("button", {
            key: p.id,
            className: cur === p.id ? "blwq-btn" : "blwq-btn blwq-btn2",
            onClick: () => set(['voice', 'preset'], p.id),
          }, (cur === p.id ? "● " : "") + p.name))),
        h("div", { className: "blwq-hint", style: { marginTop: "4px" } },
          (DAILY_PRESETS.find((x) => x.id === cur) ?? DAILY_PRESETS[0]).hint),
        h("div", { className: "blwq-row", style: { marginTop: "10px" } },
          h("div", null,
            h("div", { className: "blwq-label" }, `再调一下音调　${pitch > 0 ? '高' : pitch < 0 ? '低' : '不动'}`),
            h("div", { className: "blwq-hint" }, "往右更尖更精神，往左更低沉更软。0 = 保持预设原样")),
          h("input", {
            type: "range", min: -50, max: 50, step: 2,
            value: pitch, style: { width: "200px" },
            onChange: (e) => set(['voice', 'pitch'], Number(e.target.value)),
          })),
        h("div", { className: "blwq-hint", style: { marginTop: "6px" } },
          "改完点「保存」，然后点上面「试听一句」听听效果。"));
    }

    const BR_PRESETS = [
      { id: 'voc_u3nxkd5578wc', name: '大肥鱼（机灵版）', hint: '清亮、机灵，想到好主意会雀跃起来' },
      { id: 'voc_8yud7hz7c9q2', name: '大肥鱼（迷糊版）', hint: '轻软、有点小迷糊，走神后会回神' },
    ];

    function BreezePanel({ v, set, msg, setMsg, busy, setBusy }) {
      const br = v?.breeze ?? {};
      const voiceId = String(br.voiceId ?? BR_PRESETS[0].id);
      const hasKey = Boolean(String(br.apiKey ?? "").trim());
      const custom = Array.isArray(br.customVoices) ? br.customVoices : [];
      const [newId, setNewId] = useState("");
      const [newName, setNewName] = useState("");

      const addCustom = () => {
        const id = newId.trim();
        if (!id) return;
        set(["voice", "breeze", "customVoices"], [...custom, { id, name: newName.trim() || id }]);
        setNewId(""); setNewName("");
      };
      const removeCustom = (id) => {
        set(["voice", "breeze", "customVoices"], custom.filter((x) => x.id !== id));
      };

      return h("div", { className: "blwq-quick", style: { marginTop: "10px" } },
        h("div", { className: "blwq-quick-t" }, "大肥鱼的音色 · BreezeBlue 云端"),
        h("div", { className: "blwq-hint" },
          "插件自带这两种。需要用你自己的 BreezeBlue API Key 才能合成 —— 没有 Key 会自动退回电脑自带的声音，不会哑掉。"),

        // ── 两个自带音色 ──
        h("div", { className: "blwq-quick-row", style: { marginTop: "8px" } },
          BR_PRESETS.map((p) => h("button", {
            key: p.id,
            className: voiceId === p.id ? "blwq-btn" : "blwq-btn blwq-btn2",
            onClick: () => {
              set(["voice", "breeze", "voiceId"], p.id);
              set(["voice", "breeze", "enabled"], true);
            },
          }, (voiceId === p.id ? "● " : "") + p.name))),
        h("div", { className: "blwq-hint", style: { marginTop: "4px" } },
          (BR_PRESETS.find((x) => x.id === voiceId) ?? BR_PRESETS[0]).hint),

        // ── API Key ──
        h("div", { className: "blwq-label", style: { marginTop: "12px" } }, "BreezeBlue API Key"),
        h("div", { className: "blwq-cmd" },
          h("input", {
            className: "blwq-input", style: { flex: 1, minWidth: "260px" },
            type: "password",
            placeholder: hasKey ? "已填（要换就粘贴新的覆盖）" : "粘贴 sk_... 开头的 Key",
            onChange: (e) => {
              const val = String(e.target.value ?? "").trim();
              set(["voice", "breeze", "apiKey"], val);
              set(["voice", "breeze", "enabled"], Boolean(val));
            },
          })),
        h("div", { className: "blwq-hint", style: { marginTop: "4px" } },
          hasKey
            ? "✓ 已填。Key 只存在你本机，不会上传，也不会出现在日志里。"
            : "✗ 还没填 —— 现在会退回「电脑自带的声音」。Key 去 breezeblue.ai 后台 → API Keys 拿。"),

        // ── 用量控制 ──
        h("div", { className: "blwq-label", style: { marginTop: "12px" } }, "省着点用（云端按字数计费）"),
        h("div", { className: "blwq-hint" },
          `单条最多 ${Number(br.maxChars ?? 120)} 字　·　一天最多 ${Number(br.dailyMax ?? 40)} 条`),
        h("div", { className: "blwq-cmd", style: { marginTop: "4px" } },
          h("span", { className: "blwq-hint" }, "单条上限"),
          h("input", {
            className: "blwq-input", type: "number", min: 20, max: 400, style: { width: "90px" },
            value: Number(br.maxChars ?? 120),
            onChange: (e) => set(["voice", "breeze", "maxChars"], Number(e.target.value) || 120),
          }),
          h("span", { className: "blwq-hint" }, "每天上限"),
          h("input", {
            className: "blwq-input", type: "number", min: 0, max: 500, style: { width: "90px" },
            value: Number(br.dailyMax ?? 40),
            onChange: (e) => set(["voice", "breeze", "dailyMax"], Number(e.target.value) || 0),
          })),
        h("div", { className: "blwq-hint", style: { marginTop: "2px" } },
          "0 = 不限（不建议）。Free 套餐一天约 40 条，超了会失败。"),

        // ── 自己加的音色 ──
        h("div", { className: "blwq-label", style: { marginTop: "12px" } }, "想换别的音色"),
        h("div", { className: "blwq-hint" },
          "在 BreezeBlue 音色库里挑一个，把它的 Voice ID（voc_ 开头）填进来。一行一个，可以加很多个。"),
        custom.length
          ? h("div", { className: "blwq-code", style: { marginTop: "6px" } },
              custom.map((x) => h("div", { key: x.id, style: { display: "flex", gap: "8px", alignItems: "center" } },
                h("button", {
                  className: voiceId === x.id ? "blwq-btn" : "blwq-btn blwq-btn2",
                  style: { padding: "2px 8px" },
                  onClick: () => { set(["voice", "breeze", "voiceId"], x.id); set(["voice", "breeze", "enabled"], true); },
                }, (voiceId === x.id ? "● " : "") + x.name),
                h("span", { className: "blwq-hint" }, x.id),
                h("button", { className: "blwq-btn blwq-btn2", style: { padding: "2px 8px" }, onClick: () => removeCustom(x.id) }, "删"))))
          : null,
        h("div", { className: "blwq-cmd", style: { marginTop: "6px" } },
          h("input", {
            className: "blwq-input", placeholder: "Voice ID（voc_...）", style: { flex: 1, minWidth: "160px" },
            value: newId, onChange: (e) => setNewId(e.target.value),
          }),
          h("input", {
            className: "blwq-input", placeholder: "给它起个名（可不填）", style: { flex: 1, minWidth: "120px" },
            value: newName, onChange: (e) => setNewName(e.target.value),
          }),
          h("button", { className: "blwq-btn blwq-btn2", onClick: addCustom, disabled: !newId.trim() }, "添加")),

        h("div", { className: "blwq-hint", style: { marginTop: "10px" } },
          "改完记得点上面的「保存」。"));
    }

/**
     * 记忆：备份 / 恢复（2026-11-04 晚重做）
     *
     * 主人：「QQ养鱼的控制台还少了记忆恢复」
     *
     * 之前这里只给了两行命令让人自己复制到命令行跑 —— 而 B 站那边是有按钮的 ✗
     * 现在对齐：看一眼 / 备份 / 预演恢复 / 真恢复，全在页面上点 ✓
     *
     * ⚠️ 恢复默认是**预演**（dry），要真写必须再点一次确认 —— 它会覆盖现在的日记和设置。
     */
    function MemoryHelp() {
      const [dir, setDir] = useState("");
      const [info, setInfo] = useState(null);
      const [msg, setMsg] = useState("");
      const [busy, setBusy] = useState("");
      const [from, setFrom] = useState("");

      const look = async (d) => {
        setBusy("look"); setMsg("");
        try {
          const q = d ? "?dir=" + encodeURIComponent(d) : "";
          const j = await api.get("/backup/inspect" + q);
          setInfo(j);
          if (j?.dir) { setDir(j.dir); setFrom(j.dir); }
          if (j?.ok === false) setMsg(j.error ?? "那个目录里没有备份");
          else setMsg(`${j.canRestore}/${j.total} 项可恢复` + (j.hasSessions ? " · 含对话全文" : ""));
        } catch (e) { setMsg("看不了：" + e.message); }
        finally { setBusy(""); }
      };
      useEffect(() => { look(); }, []);

      const backup = async () => {
        setBusy("backup"); setMsg("备份中…");
        try {
          const j = await api.post("/backup/export", {});
          setMsg(`✓ 已备份 ${j.copied} 项到\n${j.dir}` + (j.missing ? `\n（${j.missing} 项本来就没有，跳过）` : ""));
          setDir(j.dir); setFrom(j.dir);
          void look(j.dir);
        } catch (e) { setMsg("✗ " + e.message); }
        finally { setBusy(""); }
      };

      const restore = async (real) => {
        if (!from.trim()) { setMsg("先填备份目录"); return; }
        if (real && !window.confirm("真恢复会覆盖现在的日记、人设、设置。确定？")) return;
        setBusy("restore"); setMsg(real ? "恢复中…" : "预演中…");
        try {
          const j = await api.post("/backup/import", { from: from.trim(), dry: !real });
          const head = j.dry ? "预演（什么都没改）" : "✓ 已恢复";
          setMsg(`${head}：${j.restored} 项\n${(j.files ?? []).slice(0, 8).join("\n")}` +
            ((j.files ?? []).length > 8 ? `\n…还有 ${j.files.length - 8} 项` : "") +
            `\n对话全文：${j.sessions}`);
        } catch (e) { setMsg("✗ " + e.message); }
        finally { setBusy(""); }
      };

      return h("div", { className: "blwq-row", style: { display: "block" } },
        h("div", { className: "blwq-label" }, "记忆：备份和恢复"),
        h("div", { className: "blwq-hint" },
          "她的记忆不在对话框里，在这几个文件里 —— 所以「换一段新对话」不会让她失忆："),
        h("div", { className: "blwq-code" },
          h("div", null, "日记　　　~/.dsh/whale-diary.md"),
          h("div", null, "私密日记　~/.dsh/whale-diary-private.md"),
          h("div", null, "人设　　　~/.bili-ai/persona.md"),
          h("div", null, "规则　　　~/.dsh/whale-rules.md")),
        h("div", { className: "blwq-hint", style: { marginTop: "8px" } },
          "这几个文件**和 B 站那边共用同一份** —— 你在 QQ 说的话，她在 B 站也记得。"),

        // ── 备份 ──
        h("div", { className: "blwq-hint", style: { marginTop: "14px", fontWeight: 600 } }, "备份"),
        h("div", { className: "blwq-hint" }, "打个包放桌面（日记、人设、设置、登录状态、对话全文都在一起）："),
        h("div", { className: "blwq-cmd" },
          h("button", { className: "blwq-btn", onClick: backup, disabled: !!busy }, busy === "backup" ? "备份中…" : "备份到桌面"),
          h("button", { className: "blwq-btn blwq-btn2", onClick: () => look(dir), disabled: !!busy }, busy === "look" ? "看着…" : "看一眼上次的备份")),

        // ── 恢复 ──
        h("div", { className: "blwq-hint", style: { marginTop: "14px", fontWeight: 600 } }, "恢复"),
        h("div", { className: "blwq-hint" }, "换了台电脑、重装之后用。先预演看清楚，再真恢复："),
        h("div", { className: "blwq-cmd" },
          h("input", {
            className: "blwq-input", style: { flex: 1, minWidth: "220px" },
            placeholder: dir || "备份目录路径",
            value: from, onChange: (e) => setFrom(e.target.value),
          })),
        h("div", { className: "blwq-cmd" },
          h("button", { className: "blwq-btn blwq-btn2", onClick: () => restore(false), disabled: !!busy }, "预演（不改任何东西）"),
          h("button", { className: "blwq-btn", onClick: () => restore(true), disabled: !!busy }, busy === "restore" ? "做着…" : "真恢复")),
        h("div", { className: "blwq-hint", style: { marginTop: "6px" } },
          "真恢复会覆盖现在的日记和设置；对话全文默认**不覆盖**（怕盖掉更新的记录）。"),

        info?.items?.length
          ? h("div", { className: "blwq-code", style: { marginTop: "10px" } },
              info.items.map((i) => h("div", { key: i.rel },
                (i.ok ? "✓ " : "· ") + i.rel + (i.ok ? `  (${i.size} B)` : "  （没有）"))))
          : null,
        msg ? h("div", { className: "blwq-hint", style: { marginTop: "8px", whiteSpace: "pre-wrap" } }, msg) : null);
    }

    function VoiceBlock({ cfg, set }) {
      const [info, setInfo] = useState(null);
      const [msg, setMsg] = useState("");
      const [busy, setBusy] = useState("");
      const [importPath, setImportPath] = useState("");

      const v = cfg?.voice ?? {};
      const voiceNow = String(v.voice ?? '');
      const rateNow = Number(v.rate ?? 0);
      const volumeNow = Number(v.volume ?? 100);
      const engine = String(v.engine ?? 'tts');

      const load = useCallback(async () => {
        try {
          const j = await api.get("/voice/check");
          setInfo(j);
        } catch (e) { setMsg(`读不到语音状态：${e.message}`); }
      }, []);
      useEffect(() => { load(); }, [load]);

      // ⚠️ 试听：把**当前配置里的值**传过去（包括还没保存的改动），
      //   不然会出现「滑块拉到 -10，试听还是原来的语速」
      const listen = async () => {
        setBusy("preview"); setMsg("");
        try {
          // ⚠️ 2026-11-08：选了「大肥鱼（自带）」时要传 preset ——
          //   不传的话后端不知道用哪个预设，试听和实际发出去的就不一样 ✗
          const payload = {
            text: "这是本鱼的声音，你听听",
            volume: volumeNow,
          };
          if (engine === 'preset') {
            payload.preset = String(v.preset ?? 'clever');
            payload.pitch = Number(v.pitch ?? 0);
          } else {
            payload.voice = voiceNow;
            payload.rate = rateNow;
          }
          const j = await api.post("/voice/preview", payload);
          const used = j.used ? `（${j.used.preset ? (j.used.preset === 'clever' ? '机灵版' : '迷糊版') : j.used.voice} · 音调${j.used.pitch > 0 ? '+' : ''}${j.used.pitch}）` : "";
          setMsg((j.canSend ? "✓ 念出来了，而且这个格式能发出去" : `念出来了，但发不出去：${j.sendError ?? ""}`) + used);
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const doImport = async () => {
        setBusy("import"); setMsg("");
        try {
          const j = await api.post("/voice/import", { path: importPath });
          setMsg(`✓ 导进来了：${j.file}。把「用谁的声音」改成「我自己的录音」就会用它`);
          // 导入后顺便把引擎切到 file，省得再让人找一遍
          set(['voice', 'engine'], 'file');
          set(['voice', 'customFile'], j.file);
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      const voices = info?.voices ?? [];
      // 当前配的音色不在系统列表里时，也要能显示出来（否则下拉框会"跳"到第一个）
      const options = voices.length ? voices : [{ name: voiceNow || '（没检测到）', culture: '' }];
      const inList = options.some((x) => x.name === voiceNow);

      return h("div", null,
        // ⚠️ 2026-11-08 加的：用谁的声音（三选一）
        //   breeze = BreezeBlue 云端（自带两个「大肥鱼」）
        //   tts    = 电脑自带（老路子）
        //   file   = 我自己的录音
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, "用谁的声音"),
            h("div", { className: "blwq-hint" },
              "「大肥鱼（自带·免费）」装好就能用；其余是可选的其他几种")),
          h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            h("button", {
              className: engine === 'preset' ? "blwq-btn" : "blwq-btn blwq-btn2",
              onClick: () => set(['voice', 'engine'], 'preset'),
            }, "大肥鱼（自带·免费）"),
            h("button", {
              className: engine === 'tts' ? "blwq-btn" : "blwq-btn blwq-btn2",
              onClick: () => set(['voice', 'engine'], 'tts'),
            }, "电脑原声"),
            h("button", {
              className: engine === 'file' ? "blwq-btn" : "blwq-btn blwq-btn2",
              onClick: () => set(['voice', 'engine'], 'file'),
            }, "我自己的录音"),
            h("button", {
              className: engine === 'breeze' ? "blwq-btn" : "blwq-btn blwq-btn2",
              onClick: () => set(['voice', 'engine'], 'breeze'),
            }, "云端真声（要钱）"))),

        // ── 大肥鱼预设面板（2026-11-08，免费那个）──
        engine === 'preset' ? h(PresetPanel, { v, set }) : null,

        // ── BreezeBlue 面板（选了云端才显示）──
        engine === 'breeze' ? h(BreezePanel, { v, set, msg, setMsg, busy, setBusy }) : null,

        // ── 系统 TTS 音色（只在 engine=tts 时显示）──
        engine === 'tts' ? h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, "音色"),
            h("div", { className: "blwq-hint" },
              voices.length
                ? "选一个电脑上装了的朗读声音。中文的排在前面，带 zh-CN 的就是中文"
                : "这台机器没检测到朗读声音，只能用自己的录音")),
          h("select", {
            className: "blwq-select",
            value: voiceNow,
            onChange: (e) => set(['voice', 'voice'], e.target.value),
            disabled: !voices.length,
          },
            inList ? null : h("option", { value: voiceNow }, `${voiceNow || '（没选）'}`),
            voices.map((x) => h("option", { key: x.name, value: x.name },
              `${x.name}${x.culture ? '（' + x.culture + '）' : ''}`)))) : null,

        // ── 语速 ──
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, `说话快慢　${rateNow > 0 ? '快' : rateNow < 0 ? '慢' : '正常'}`),
            h("div", { className: "blwq-hint" }, "往左拖更慢，往右拖更快。0 = 正常语速")),
          h("input", {
            type: "range", min: -10, max: 10, step: 1,
            value: rateNow, style: { width: "200px" },
            onChange: (e) => set(['voice', 'rate'], Number(e.target.value)),
          })),

        // ── 音量 ──
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, `音量　${volumeNow}`),
            h("div", { className: "blwq-hint" }, "0 = 听不见 · 100 = 最大")),
          h("input", {
            type: "range", min: 0, max: 100, step: 5,
            value: volumeNow, style: { width: "200px" },
            onChange: (e) => set(['voice', 'volume'], Number(e.target.value)),
          })),

        // ── 自己的录音（只在 engine=file 时有意义，但先摆出来）──
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, "换成我自己的录音",
              engine === 'file' ? h("span", { className: "blwq-badge" }, "正在用") : null),
            h("div", { className: "blwq-hint" }, "填一个本机音频文件路径导进来；导入后「用谁的声音」会自动切到「我自己的录音」")),
          h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
            h("input", {
              className: "blwq-input blwq-wide",
              placeholder: "C:\\Users\\你\\Desktop\\voice.wav",
              value: importPath,
              onChange: (e) => setImportPath(e.target.value),
            }),
            h("button", { className: "blwq-btn blwq-btn2", onClick: doImport, disabled: !!busy || !importPath.trim() },
              busy === "import" ? "导入中…" : "导入"))),

        h("div", { className: "blwq-actions" },
          h("button", { className: "blwq-btn", onClick: listen, disabled: !!busy || engine !== 'tts' },
            busy === "preview" ? "念着呢…" : "试听一句"),
          h("button", { className: "blwq-btn blwq-btn2", onClick: load }, "重新检测")),

        h("div", { className: "blwq-hint" },
          engine === 'tts'
            ? "「试听」会用上面当前的音色/快慢/音量念一句，确认能发出去再保存。"
            : "现在用的是你自己的录音文件，试听只对系统朗读有效。"),
        msg ? h("div", { className: msg.startsWith("✓") ? "blwq-ok" : "blwq-err" }, msg) : null);
    }

    /**
     * 群聊（2026-11-07 第一版 → 09:2x 按主人要求改成「一屏说清 + 一条功能一张卡」）
     *
     * 主人三句话：
     *   ①「把你拉进群聊，主人 @ 你就回答主人，别人 @ 你就先问主人再回」
     *   ②「在控制台这个简洁地说清楚功能，可开可不开」
     *   ③「群聊只有我能邀请你，你不能乱进」
     *
     * 所以现在长这样：
     *   · 顶上**一句话**说清整块规矩（不铺垫、不解释实现）
     *   · 下面**一条功能一张卡**：一行大白话 + 右边一个开/关
     *   · 再下面才是群名单（加/删），按钮点了就落盘
     *
     * ⚠️ 这里每个开关都是**点了就生效**（直接 POST /config），不需要再点保存 ——
     *   2026-11-04 那个「点了以为开了、其实没保存」的错就是这样来的 ✗
     *   所以群聊这一组的字段**不放进 FIELDS**（那样会多出重复的输入框），全部在这里画 ✓
     */
    const GROUP_SWITCHES = [
      { key: "listen", path: ["group", "listen"], name: "在群里说话", on: "会看名单里的群，你 @ 她就回", off: "完全不管群，私信照旧" },
      { key: "ownerOnly", path: ["group", "ownerOnly"], name: "只认我加的群", on: "别人把群号塞进来也不算，她照样不理", off: "⚠️ 名单里有什么群她就认什么群" },
      { key: "needAt", path: ["group", "needAt"], name: "只有 @ 她才理", on: "群里不 @ 她，她不插嘴", off: "那个群里说什么她都想接一句" },
      { key: "askWhenOthers", path: ["group", "askWhenOthers"], name: "别人 @ 她，先问你", on: "草稿发给你，你点头才发到群里", off: "当普通聊天，直接回" },
    ]

    function GroupsBlock({ cfg, onSaved }) {
      const [live, setLive] = useState(null);
      const [msg, setMsg] = useState("");
      const [busy, setBusy] = useState("");
      const [manual, setManual] = useState("");
      // 本地那份开关状态：点下去先变，服务端回话再对齐（不回话就回滚）
      const [local, setLocal] = useState(null);

      const g = { ...(cfg?.group ?? {}), ...(local ?? {}) };
      const configured = Array.isArray(g.groups) ? g.groups.filter((x) => x && x.id) : [];
      const listening = g.listen === true;

      const load = useCallback(async () => {
        try {
          const j = await api.get("/groups");
          setLive(j);
          if (j.liveError) setMsg(`⚠️ ${j.liveError}`);
        } catch (e) { setMsg(`读群列表失败：${e.message}`); }
      }, []);
      useEffect(() => { load(); }, [load]);

      // 一个开关：改配置 → 立刻存回去（不等下面的「保存」）
      const flip = async (f) => {
        const next = !(g[f.key] === true);
        setLocal((s) => ({ ...(s ?? {}), [f.key]: next }));
        setBusy(f.key); setMsg("");
        try {
          const whole = setPath(cfg ?? {}, f.path, next);
          const j = await api.post("/config", { config: whole });
          if (j.config) onSaved?.(j.config);
          setLocal((s) => ({ ...(s ?? {}), [f.key]: undefined }));
          setMsg(`✓ 已${next ? "开" : "关"}：${f.name}`);
        } catch (e) {
          setLocal((s) => ({ ...(s ?? {}), [f.key]: !next }));   // 回滚
          setMsg(`✗ ${e.message}`);
        } finally { setBusy(""); }
      };

      const add = async (id, name) => {
        setBusy(id); setMsg("");
        try {
          const j = await api.post("/groups/add", { id, name });
          setMsg(`✓ 加进了：${name || id}${j.checked ? `（${j.checked}）` : ""}`);
          await load();
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const remove = async (id) => {
        setBusy(id); setMsg("");
        try {
          await api.post("/groups/remove", { id });
          setMsg(`✓ 拿掉了：${id}`);
          await load();
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      const inList = (id) => configured.some((x) => String(x.id) === String(id));

      return h("div", { style: { display: "block" } },
        // ── 一句话说清 ──
        h("div", { className: "blwq-hint", style: { marginTop: 0 } },
          "只有你加的群她才说话。你 @ 她 → 直接回；别人 @ 她 → 先问你要不要回。"),

        // ── 一条功能一张卡 ──
        h("div", { className: "blwq-cards" },
          GROUP_SWITCHES.map((f) => {
            const on = g[f.key] === true;
            const sub = f.key !== "listen" && !listening;
            return h("div", { key: f.key, className: "blwq-card" + (on ? " on" : "") },
              h("div", { className: "blwq-cardmain" },
                h("div", { className: "blwq-cardname" }, f.name,
                  on ? null : h("span", { className: "blwq-badge" }, "关着")),
                h("div", { className: "blwq-cardnote" }, sub ? "先开上面那个「在群里说话」" : (on ? f.on : f.off))),
              h("button", {
                className: "blwq-btn" + (on ? "" : " blwq-btn2"),
                disabled: sub || !!busy,
                onClick: () => flip(f),
              }, busy === f.key ? "…" : (on ? "开" : "关")));
          })),

        // ── 群名单 ──
        h("div", { className: "blwq-cardname", style: { marginTop: "14px" } }, "在哪些群",
          h("span", { className: "blwq-badge" }, configured.length ? `${configured.length} 个` : "一个都没加")),
        h("div", { className: "blwq-hint" }, "加、拿掉都是立刻生效，不用再点保存。"),

        configured.length === 0
          ? h("div", { className: "blwq-hint", style: { marginTop: "6px" } }, "下面是你在的群，点一下就加。")
          : configured.map((x) => h("div", { key: x.id, className: "blwq-grow" },
              h("span", { className: "blwq-label", style: { margin: 0 } }, x.name || x.id),
              h("span", { className: "blwq-hint", style: { margin: 0 } }, x.id),
              x.invitedBy && x.invitedBy !== "owner"
                ? h("span", { className: "blwq-err", style: { margin: 0 } }, `✗ 不是主人邀请的（${x.invitedBy}）`)
                : null,
              h("button", { className: "blwq-btn blwq-btn2", disabled: !!busy, onClick: () => remove(x.id) },
                busy === x.id ? "…" : "拿掉"))),

        // ── 你在的群（实时拉的）──
        !live
          ? null
          : live.live.length === 0
            ? h("div", { className: "blwq-hint", style: { marginTop: "8px" } }, "没读到你在的群（NapCat 没登录？）→ 下面手动填群号")
            : h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" } },
                live.live.map((x) => h("button", {
                  key: x.id,
                  className: "blwq-btn" + (inList(x.id) ? "" : " blwq-btn2"),
                  disabled: !!busy || inList(x.id),
                  onClick: () => add(x.id, x.name),
                }, inList(x.id) ? `✓ ${x.name || x.id}` : `＋ ${x.name || x.id}${x.memberCount ? `（${x.memberCount}人）` : ""}`))),

        // ── 手填 ──
        h("div", { style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
          h("input", {
            className: "blwq-input",
            placeholder: "群号（5–16 位数字）",
            value: manual,
            onChange: (e) => setManual(e.target.value),
            style: { width: "180px" },
          }),
          h("button", {
            className: "blwq-btn blwq-btn2",
            disabled: !!busy || !/^\d{5,16}$/.test(manual.trim()),
            onClick: () => { add(manual.trim(), ""); setManual(""); },
          }, "加进去"),
          h("button", { className: "blwq-btn blwq-btn2", onClick: load, disabled: !!busy }, "刷新群列表")),

        msg ? h("div", { className: msg.startsWith("✓") ? "blwq-ok" : "blwq-err" }, msg) : null);
    }

    // ── 主节（排版照 B 站那页：标题 → 分组 → 行 → 底部按钮）──────────
    function QqSection() {
      useStyleOnce();
      const [cfg, setCfg] = useState(null);
      const [savedJson, setSavedJson] = useState("");
      const [out, setOut] = useState("");
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState("");
      // 「读一次」的结果就地显示（页面顶部那个 err 离按钮太远，点了像没反应）
      const [selfMsg, setSelfMsg] = useState("");
      const [pendingCount, setPendingCount] = useState(0);

      const load = useCallback(async () => {
        setErr("");
        try {
          const j = await api.get("/config");
          setCfg(j.config ?? {});
          setSavedJson(JSON.stringify(j.config ?? {}));
        } catch (e) { setErr(`读取配置失败：${e.message}`); }
      }, []);
      useEffect(() => { load(); }, [load]);

      const set = (path, value) => setCfg((c) => setPath(c ?? {}, path, value));

      const save = async () => {
        setBusy("save"); setErr(""); setOut("");
        try {
          const j = await api.post("/config", { config: cfg });
          setOut("✓ 已保存\n配置只写在 QQ 这一份里，别的通道不受影响");
          if (j.config) { setCfg(j.config); setSavedJson(JSON.stringify(j.config)); }
        } catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };

      const deps = async () => {
        setBusy("deps"); setErr(""); setOut("检查中…");
        try {
          const j = await api.get("/deps");
          const lines = (j.items ?? []).map((i) => `${i.ok ? "✓" : "✗"} ${i.name} — ${i.detail ?? ""}`);
          setOut((j.ok ? "全部可用 ✓\n" : "有项不可用 ✗\n") + lines.join("\n"));
        } catch (e) { setErr(`体检失败：${e.message}`); } finally { setBusy(""); }
      };

      const refreshSelf = async () => {
        setBusy("self"); setErr(""); setOut(""); setSelfMsg("");
        try {
          const j = await api.post("/accounts/refresh");
          if (!j.ok) throw new Error(j.error || "读不到");
          setOut(`✓ 记下了：${j.self.nickname || j.self.uin}（${j.self.uin}）`);
          await load();
        } catch (e) {
          // ⚠️ 2026-11-04：原来只把错误丢到页面顶部那个 err 里 —— 而「读一次」按钮在页面下方，
          //   中间隔着一整张表单，主人点了按钮根本看不到响应，以为没反应 ✗
          //   现在**按钮旁边**就显示「✓ 记下了」或「✗ 读不到 + 真实原因」✓
          setSelfMsg(`✗ 没读到：${e.message}`);
        } finally { setBusy(""); }
      };

      if (!cfg) {
        return h("div", { className: "blwq" },
          h("h3", { className: "blwq-title" }, "养鱼 · QQ"),
          err ? h("div", { className: "blwq-err" }, err) : h("div", { className: "blwq-hint" }, "读取中…"));
      }

      const groups = [];
      for (const f of FIELDS) {
        let g = groups.find((x) => x.name === f.group);
        if (!g) { g = { name: f.group, fields: [] }; groups.push(g); }
        g.fields.push(f);
      }
      const ordered = GROUP_ORDER.map((n) => groups.find((g) => g.name === n)).filter(Boolean);
      const dirty = savedJson && JSON.stringify(cfg) !== savedJson;

      return h("div", { className: "blwq" },
        h("h3", { className: "blwq-title" }, "养鱼 · QQ"),
        h("p", { className: "blwq-intro" },
          "她在 QQ 上的全部设置。通道开关、和 B 站的分配在「设置 → 养鱼」；这边只管 QQ 自己的事。"),
        pendingCount ? h("div", { className: "blwq-hint" }, `⚠️ 有 ${pendingCount} 条别人发来的话等你点头（在下面「待审」里）`) : null,

        // 账号
        h("div", { className: "blwq-group" }, "我是谁、你是谁"),
        h("div", { className: "blwq-rows" },
          ordered.find((g) => g.name === "我是谁、你是谁").fields.map((f) => h(Row, { key: f.path.join("."), f, cfg, set })),
          h("div", { className: "blwq-row" },
            h("div", null,
              h("div", { className: "blwq-label" }, "从 NapCat 读一次"),
              h("div", { className: "blwq-hint" }, "问一下 NapCat 现在登的是哪个号，记到上面两格")),
            h("button", { className: "blwq-btn blwq-btn2", onClick: refreshSelf, disabled: !!busy }, busy === "self" ? "读着呢…" : "读一次"))),
          selfMsg ? h("div", { className: selfMsg.startsWith("✓") ? "blwq-ok" : "blwq-err" }, selfMsg) : null,

        // 登录
        h("div", { className: "blwq-group" }, "扫码登录"),
        h("div", { className: "blwq-rows" }, h("div", { className: "blwq-row", style: { display: "block" } }, h(QrLogin, { onAccount: load }))),

        // 群聊（2026-11-07）：一屏说清 + 一条功能一张卡 + 群名单
        h("div", { className: "blwq-group" }, GROUP_GROUP),
        h("div", { className: "blwq-rows" },
          h("div", { className: "blwq-row", style: { display: "block" } },
            h(GroupsBlock, { cfg, onSaved: (next) => { setCfg(next); setSavedJson(JSON.stringify(next)); } }))),

        // 待审
        h("div", { className: "blwq-group" }, "待审（别人发来的话，你点头才回）"),
        h("div", { className: "blwq-rows" }, h("div", { className: "blwq-row", style: { display: "block" } }, h(PendingList, { onCount: setPendingCount }))),

        // 其余分组
        // ⚠️ 2026-11-07：「群聊」这一组不从这里画 —— 它整块由 GroupsBlock 自己渲染
        //   （一条功能一张卡 + 群名单，开关点了就生效）。
        //   两边都画的话同一页会冒出重复的开关输入框 ✗
        ordered.filter((g) => g.name !== "我是谁、你是谁" && g.name !== GROUP_GROUP).map((g) => h("div", { key: g.name },
          h("div", { className: "blwq-group" }, g.name),
          h("div", { className: "blwq-rows" },
            // 作息那一组，最上面先放**醒来时段**编辑器（数组，普通 Row 装不下）
            g.name === NIGHT_GROUP ? h(WakeWindows, { cfg, set }) : null,
            // 发什么那一组，最上面放**三选一 + 百分比滑块**（替代原来的 auto/pinned/权重输入框）
            g.name === FORMAT_GROUP ? h(FormatPicker, { cfg, set }) : null,
            g.fields.map((f) => h(Row, { key: f.path.join("."), f, cfg, set })),
            // 「记忆与上下文」组：补一段「备份/复活怎么用」——
            //   主人问「QQ养鱼的记忆备份复活功能」，这功能是命令行工具，
            //   页面上得告诉他在哪、怎么跑 ✓
            g.name === MEMORY_GROUP ? h(MemoryHelp, null) : null,
            g.name === "语音" ? h("div", { className: "blwq-row", style: { display: "block" } }, h(VoiceBlock, { cfg, set })) : null))),

        dirty ? h("div", { className: "blwq-hint", style: { marginTop: "10px", color: "#ffb020" } }, "● 有改动还没保存（改了不点保存 = 没生效）") : null,

        h("div", { className: "blwq-actions" },
          h("button", { className: "blwq-btn", onClick: save, disabled: !!busy }, busy === "save" ? "保存中…" : "保存"),
          h("button", { className: "blwq-btn blwq-btn2", onClick: deps, disabled: !!busy }, busy === "deps" ? "体检中…" : "依赖体检"),
          h("button", { className: "blwq-btn blwq-btn2", onClick: load, disabled: !!busy }, "重新读取")),

        err ? h("div", { className: "blwq-err" }, err) : null,
        out ? h("div", { className: "blwq-out" }, out) : null);
    }

    const inject = ["slots"];
    const NS = "qq-whale";
    const NAMES = { nav: "养鱼 · QQ" };

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              { name: "settings.section", id: NS, order: 7, label: () => NAMES.nav },
              QqSection,
            ),
            "qq-whale: settings section",
          ),
        "qq-whale: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.QqSection = QqSection;
    exports.FIELDS = FIELDS;
    return module.exports;
  },
});
