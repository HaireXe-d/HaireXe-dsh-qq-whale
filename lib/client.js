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
      { group: "我是谁、你是谁", path: ["self", "uin"], label: "我登录的 QQ 号", hint: "扫码登录成功后自动记；也可以点下面「从 NapCat 读一次」", kind: "text", readOnly: true },
      { group: "我是谁、你是谁", path: ["self", "nickname"], label: "我的 QQ 昵称", hint: "同上，自动记", kind: "text", readOnly: true },
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

      // 发什么
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "mode"], label: "平时怎么挑", hint: "auto = 按下面的权重自己挑；pinned = 固定成一种", kind: "select", options: ["auto", "pinned"] },
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "pinned"], label: "固定发哪种", hint: "mode = pinned 时才用", kind: "select", options: ["text", "voice", "sticker"] },
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "overrideTtlSec"], label: "你临时指定能管多久（秒）", hint: "你说「发语音」之后多久内有效。30–3600", kind: "number" },
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "weights", "text"], label: "文字被挑中的权重", hint: "越大越爱用文字。0–20", kind: "number" },
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "weights", "voice"], label: "语音被挑中的权重", hint: "0 = 她自己不发语音（你要她还是会发）。0–20", kind: "number" },
      { group: "发什么（文字 / 语音 / 表情包）", path: ["format", "weights", "sticker"], label: "表情包被挑中的权重", hint: "0 = 她自己不发表情包。0–20", kind: "number" },

      // 语音
      { group: "语音", path: ["voice", "enabled"], label: "能发语音", hint: "关掉她就只发文字和表情包", kind: "switch" },
      { group: "语音", path: ["voice", "engine"], label: "用谁的声音", hint: "tts = 系统朗读；file = 用你导入的那段音频", kind: "select", options: ["tts", "file"] },
      { group: "语音", path: ["voice", "voice"], label: "音色", hint: "系统里装了的朗读声音（中文的在最前面）", kind: "text", wide: true },
      { group: "语音", path: ["voice", "rate"], label: "说话快慢", hint: "-10 很慢 · 0 正常 · 10 很快", kind: "number" },
      { group: "语音", path: ["voice", "volume"], label: "音量", hint: "0–100", kind: "number" },
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
      { group: "作息（几点醒）", path: ["sessionRotateDays"], label: "多久换一个新对话（天）", hint: "按自然日算，1 = 过零点就换。0 = 不换", kind: "number" },
      { group: "作息（几点醒）", path: ["personaOncePerSession"], label: "同一个对话里只注入一次人设", hint: "开着省上下文；关掉每条都带完整人设", kind: "switch" },

      // 主动找你
      { group: "主动找你", path: ["proactive", "enabled"], label: "会自己想起你", hint: "关掉她就只在收到消息时说话", kind: "switch" },
      { group: "主动找你", path: ["proactive", "chance"], label: "醒来时主动说话的 odds", hint: "0.5 ≈ 两次醒来有一次开口。0–1", kind: "number" },
      { group: "主动找你", path: ["proactive", "dailyMax"], label: "一天最多主动几次", hint: "0–24", kind: "number" },
      { group: "主动找你", path: ["proactive", "quietMin"], label: "你刚说过话多久内不打扰（分钟）", hint: "正常聊就够，不用她再凑上来。0–1440", kind: "number" },

      // 口味
      { group: "她的口味", path: ["preferences", "like"], label: "你喜欢什么", hint: "她会往这些方向聊", kind: "text", wide: true },
      { group: "她的口味", path: ["preferences", "dislike"], label: "你不喜欢什么", hint: "她尽量避开", kind: "text", wide: true },
    ];

    // 作息时间窗单独一块 —— 它是数组（[{start,end,wakes}]），普通输入框装不下，
    // 所以用专门的 WindowsEditor 渲染（见下面）
    const NIGHT_GROUP = "作息（几点醒）";

    const GROUP_ORDER = ["我是谁、你是谁", "连 NapCat", "收消息", "作息（几点醒）", "主动找你", "她怎么回话", "她的口味", "发什么（文字 / 语音 / 表情包）", "语音", "表情包", "戳一戳", "叫醒她用哪个对话"];

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
      const flow = useRef({ generation: 0, id: null, timer: null });

      const cancel = useCallback(() => {
        flow.current.generation += 1;
        clearTimeout(flow.current.timer);
        const id = flow.current.id;
        flow.current.id = null;
        if (id) void api.post("/auth/qr/cancel", { id }).catch(() => {});
      }, []);
      useEffect(() => () => cancel(), [cancel]);

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
            active ? h("button", { className: "blwq-btn blwq-btn2", onClick: () => { cancel(); setQr({ status: "cancelled" }); } }, "取消") : null),
          h("div", { className: "blwq-hint" }, "登录是 NapCat 的事，这边只负责把二维码递过来。"),
          error || qr?.error ? h("div", { className: "blwq-err" }, error || qr.error) : null));
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
          h("div", { className: "blwq-hint" }, `${it.who}（${it.userId}）说：`),
          h("div", { className: "blwq-label", style: { margin: "2px 0 6px" } }, it.src),
          h("textarea", {
            className: "blwq-input",
            rows: 2,
            value: edits[it.id] ?? it.draft ?? "",
            placeholder: "我打算这么回（你可以直接改）",
            onChange: (e) => setEdits((s) => ({ ...s, [it.id]: e.target.value })),
            style: { width: "100%", height: "auto", padding: "6px 8px", lineHeight: "1.6", fontFamily: "inherit" },
          }),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "6px" } },
            h("button", { className: "blwq-btn", disabled: !!busy, onClick: () => act("approve", it.id, { text: edits[it.id] ?? it.draft }) },
              busy === it.id + "approve" ? "发送中…" : "发"),
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

    function VoiceBlock() {
      const [info, setInfo] = useState(null);
      const [msg, setMsg] = useState("");
      const [busy, setBusy] = useState("");
      const [voice, setVoice] = useState("");
      const [rate, setRate] = useState(0);
      const [volume, setVolume] = useState(100);
      const [importPath, setImportPath] = useState("");

      const load = useCallback(async () => {
        try {
          const j = await api.get("/voice/check");
          setInfo(j);
          setVoice(j.current?.voice ?? "");
          setRate(Number(j.current?.rate ?? 0));
          setVolume(Number(j.current?.volume ?? 100));
        } catch (e) { setMsg(`读不到语音状态：${e.message}`); }
      }, []);
      useEffect(() => { load(); }, [load]);

      const listen = async () => {
        setBusy("preview"); setMsg("");
        try {
          const j = await api.post("/voice/preview", { voice, rate, volume, text: "这是本鱼的声音，你听听" });
          setMsg(j.canSend ? "✓ 念出来了，而且这个格式能发出去" : `念出来了，但发不出去：${j.sendError ?? ""}`);
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const doImport = async () => {
        setBusy("import"); setMsg("");
        try {
          const j = await api.post("/voice/import", { path: importPath });
          setMsg(`✓ 导进来了：${j.file}`);
        } catch (e) { setMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      if (!info) return h("div", { className: "blwq-hint" }, msg || "读语音状态中…");
      return h("div", null,
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, "音色"),
            h("div", { className: "blwq-hint" }, (info.voices ?? []).length ? "系统里装了的朗读声音，中文的在最前面" : "这台机器没检测到 TTS 声音")),
          h("select", { className: "blwq-select", value: voice, onChange: (e) => setVoice(e.target.value) },
            (info.voices ?? []).map((v) => h("option", { key: v.name, value: v.name }, `${v.name}（${v.culture}）`)))),
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, `语速 ${rate}`),
            h("div", { className: "blwq-hint" }, "-10 很慢 · 0 正常 · 10 很快")),
          h("input", { type: "range", min: -10, max: 10, step: 1, value: rate, style: { width: "200px" }, onChange: (e) => setRate(Number(e.target.value)) })),
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, `音量 ${volume}`),
            h("div", { className: "blwq-hint" }, "0–100")),
          h("input", { type: "range", min: 0, max: 100, step: 5, value: volume, style: { width: "200px" }, onChange: (e) => setVolume(Number(e.target.value)) })),
        h("div", { className: "blwq-row" },
          h("div", null,
            h("div", { className: "blwq-label" }, "换成我自己的音频"),
            h("div", { className: "blwq-hint" }, "填一个本机音频文件路径，导入后把「用谁的声音」改成 file 就会用它")),
          h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
            h("input", { className: "blwq-input blwq-wide", placeholder: "C:\\Users\\你\\Desktop\\voice.wav", value: importPath, onChange: (e) => setImportPath(e.target.value) }),
            h("button", { className: "blwq-btn blwq-btn2", onClick: doImport, disabled: !!busy || !importPath.trim() }, busy === "import" ? "导入中…" : "导入"))),
        h("div", { className: "blwq-actions" },
          h("button", { className: "blwq-btn", onClick: listen, disabled: !!busy }, busy === "preview" ? "念着呢…" : "试听一句"),
          h("button", { className: "blwq-btn blwq-btn2", onClick: load }, "重新检测")),
        msg ? h("div", { className: msg.startsWith("✓") ? "blwq-ok" : "blwq-err" }, msg) : null,
        info.note ? h("div", { className: "blwq-hint" }, info.note) : null);
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

        // 待审
        h("div", { className: "blwq-group" }, "待审（别人发来的话，你点头才回）"),
        h("div", { className: "blwq-rows" }, h("div", { className: "blwq-row", style: { display: "block" } }, h(PendingList, { onCount: setPendingCount }))),

        // 其余分组
        ordered.filter((g) => g.name !== "我是谁、你是谁").map((g) => h("div", { key: g.name },
          h("div", { className: "blwq-group" }, g.name),
          h("div", { className: "blwq-rows" },
            // 作息那一组，最上面先放**醒来时段**编辑器（数组，普通 Row 装不下）
            g.name === NIGHT_GROUP ? h(WakeWindows, { cfg, set }) : null,
            g.fields.map((f) => h(Row, { key: f.path.join("."), f, cfg, set })),
            g.name === "语音" ? h("div", { className: "blwq-row", style: { display: "block" } }, h(VoiceBlock, null)) : null))),

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
