<script>
  import { onMount, tick } from "svelte";
  import { readRows, appendRow, clearRows } from "$lib/history.js";
  import { forgetChatData, readSaved, applyMember, deliveryUnknown, tripPattern } from "$lib/session.js";
  import Body from "$lib/Body.svelte";
  import { connect } from "$lib/link.js";
  import "$lib/style.css";

  let link,
    status = "正在连接",
    now = Date.now(),
    directory = [],
    total = 0,
    uptime = 0;
  let nick = "",
    password = "",
    channel = "",
    publish = false,
    error = "",
    identity = null,
    current = "",
    known = [],
    ignored = [];
  let rooms = Object.create(null),
    states = Object.create(null),
    logs = Object.create(null),
    unread = Object.create(null),
    mentions = Object.create(null);
  let joined = new Set(),
    queue = [],
    inflight = "",
    until = 0,
    sent = [],
    rtt = null;
  let draft = "",
    area,
    log,
    showUsers = false,
    below = 0,
    lastInput = "",
    selection = 0,
    dismissed = false;
  let firstUnread,
    unreadCount = 0;
  let cacheError = "",
    foundDirectory = false;
  const names = /^[\p{L}\p{N}_-]{1,24}$/u,
    nicks = /^[\p{L}\p{N}_-]{1,16}$/u;
  const commands = [
    "/join",
    "/leave",
    "/nick",
    "/me",
    "/w",
    "/topic",
    "/users",
    "/clear",
    "/help",
    "/cancel",
    "/ignore",
    "/unignore",
    "/forget",
  ];
  const blank = { users: [], pulse: Array(30).fill(0), topic: "" };
  const hex = (b) =>
    Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(
      "",
    );
  const hash = async (s) =>
    hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const color = (t) => "t" + (parseInt(t.slice(0, 2), 16) % 8);
  const spark = (a) =>
    a.map((x) => "▁▂▃▄▅▆▇█"[Math.round((x / Math.max(1, ...a)) * 7)]).join("");
  const clock = (t) =>
    new Date(t).toLocaleTimeString("zh-CN", { hour12: false });
  async function credential(password) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    return hex(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: enc.encode("PulseC trip v1/" + location.origin),
          iterations: 310000,
        },
        key,
        256,
      ),
    );
  }
  let preview = "",
    previewSeq = 0,
    entering = false;
  async function previewTrip(p) {
    let seq = ++previewSeq;
    if (p) {
      await new Promise((r) => setTimeout(r, 250));
      if (seq !== previewSeq) return;
    }
    const val = p
      ? (await hash("PulseC trip v1/" + (await credential(p)))).slice(0, 16)
      : "";
    if (seq === previewSeq) preview = val;
  }
  $: previewTrip(password);
  $: state = states[current] || blank;
  $: items = (logs[current] || []).filter((m) => !m.trip || !ignored.includes(m.trip));
  $: left = Math.max(0, 6 - sent.filter((t) => now - t < 10000).length);
  $: suggestions = dismissed
    ? []
    : draft.match(/^\/\S*$/)
      ? commands.filter((x) => x.startsWith(draft))
      : draft.match(/@[\p{L}\p{N}_-]*$/u)
        ? state.users
            .filter((u) => u.nick.startsWith(draft.split("@").pop()))
            .map((u) => "@" + u.nick + "#" + u.trip)
        : [];
  function forget() {
    if (!window.confirm("清除本标签页的身份、记录、忽略列表、待发消息和本机已知频道？此操作无法撤销。")) return;
    try {
      forgetChatData(sessionStorage, localStorage);
    } catch {
      notice("浏览器未允许完整清除本地数据，请在浏览器设置中清理。");
      return;
    }
    link?.close();
    location.replace(location.pathname);
  }
  function save() {
    try {
      sessionStorage.setItem(
        "pulsec.session",
        JSON.stringify({ identity, current, rooms, queue, ignored }),
      );
    } catch {
      cacheError = "会话存储不可用；刷新可能丢失本地状态";
    }
  }
  function remember(name) {
    known = [name, ...known.filter((n) => n !== name)].slice(0, 50);
    try {
      localStorage.setItem("pulsec.channels", JSON.stringify(known));
    } catch {}
  }
  function restore(name) {
    if (!logs[name]) {
      try {
        logs[name] = readRows(name);
      } catch {
        logs[name] = [];
        cacheError = "会话存储不可用";
      }
    }
  }
  function directoryRequest() {
    link?.send({ op: "directory", known });
  }
  function authorize() {
    if (!identity) return;
    link.send({ op: "identity", rosterDelta: true, nick: identity.nick, proof: identity.proof });
    for (const [room, pub] of Object.entries(rooms))
      link.send({ op: "join", room, public: pub });
  }
  function heartbeat() {
    if (!current) directoryRequest();
    else link.send({ op: "ping", id: String(Date.now()) });
  }
  onMount(() => {
    const saved = readSaved(sessionStorage, "pulsec.session", {});
    identity = saved.identity;
    current = saved.current || "";
    rooms = Object.assign(Object.create(null), saved.rooms);
    queue = saved.queue || [];
    ignored = Array.isArray(saved.ignored) ? saved.ignored.filter((trip) => tripPattern.test(trip)) : [];
    known = readSaved(localStorage, "pulsec.channels", []);
    for (const name of Object.keys(rooms)) restore(name);
    channel = new URLSearchParams(location.search).get("ch") || "";
    link = connect({
      status: (s) => {
        status = s;
        if (s !== "已连接") {
          joined = new Set();
          inflight = "";
          rtt = null;
          states = Object.create(null);
        }
      },
      opened(boot) {
        bootID = boot;
        authorize();
        heartbeat();
      },
      received,
      heartbeat,
    });
    const timer = setInterval(() => {
      now = Date.now();
      flush();
    }, 500);
    return () => {
      clearInterval(timer);
      link.close();
    };
  });
  function add(name, m) {
    restore(name);
    if (m.ref && logs[name].some((x) => x.ref === m.ref)) return;
    const stick =
      !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const prev = logs[name].at(-1);
    const merge =
      m.kind === "presence" &&
      prev?.kind === "presence" &&
      m.time - prev.time < 10000 &&
      prev.text.length < 256;
    if (merge) m = { ...m, text: prev.text + "   " + m.text };
    logs[name] = merge
      ? [...logs[name].slice(0, -1), m]
      : [...logs[name].slice(-499), m];
    try {
      appendRow(name, m, merge);
    } catch {
      cacheError = "会话存储不可用；刷新可能丢失消息";
    }
    if (name !== current) {
      if (!merge) unread[name] = (unread[name] || 0) + 1;
      if (
        m.trip !== identity.trip &&
        (m.text.includes("@" + identity.nick) || m.kind === "whisper")
      )
        mentions[name] = true;
    } else if (stick) bottom();
    else below++;
  }
  function notice(text, room = current) {
    if (room) add(room, { kind: "sys", text, time: Date.now() });
    else error = text;
  }
  function bottom() {
    below = 0;
    tick().then(() => {
      if (log) log.scrollTop = log.scrollHeight;
    });
  }
  function received(e) {
    switch (e.op) {
      case "directory":
        directory = e.rooms;
        total = e.online;
        uptime = e.uptime;
        foundDirectory = true;
        break;
      case "identity":
        if (identity) {
          identity.trip = e.trip;
          save();
        }
        break;
      case "nick":
        if (identity) {
          identity.nick = e.nick;
          save();
        }
        break;
      case "state":
        if (Object.hasOwn(rooms, e.room)) {
          states[e.room] = e;
          if (rooms[e.room] !== e.public) {
            rooms[e.room] = e.public;
            save();
          }
          joined.add(e.room);
          flush();
        }
        break;
      case "member": {
        const state = states[e.room];
        if (!state) break;
        const users = applyMember(state.users, e.action, e.user);
        states[e.room] = {...state, users};
        if (e.text) add(e.room, {kind: "presence", text: e.text, time: Date.now()});
        break;
      }
      case "notice":
        if (Object.hasOwn(rooms, e.room))
          add(e.room, { kind: "presence", text: e.text, time: Date.now() });
        break;
      case "message":
        if (Object.hasOwn(rooms, e.room) && !ignored.includes(e.trip)) {
          add(e.room, e);
          const st = states[e.room];
          if (st)
            states[e.room] = {
              ...st,
              users: st.users.map((u) =>
                u.nick === e.nick && u.trip === e.trip
                  ? { ...u, active: e.time / 1000 }
                  : u,
              ),
            };
        }
        break;
      case "pulse":
        if (states[e.room])
          states[e.room] = { ...states[e.room], pulse: e.pulse };
        break;
      case "pong":
        rtt = Date.now() - Number(e.id);
        break;
      case "ack": {
        const m = queue.find((q) => q.id === e.id);
        if (m && m.kind !== "topic")
          add(m.room, {
            ...m,
            time: m.created,
            ref: e.ref,
            nick: m.nick,
            trip: identity.trip,
          });
        queue = queue.filter((q) => q.id !== e.id);
        inflight = "";
        sent = [...sent.filter((t) => Date.now() - t < 10000), Date.now()];
        save();
        flush();
        break;
      }
      case "limited":
        inflight = "";
        until = Date.now() + e.wait + 100;
        break;
      case "error": {
        const m = queue.find((q) => q.id === e.id);
        if (m) {
          queue = queue.filter((q) => q.id !== e.id);
          inflight = "";
          notice(e.text + " · 未发送：" + m.raw, m.room);
          if (!draft && current === m.room) draft = m.raw;
          save();
        } else notice(e.text);
        break;
      }
    }
  }
  async function enter() {
    error = "";
    const n = nick.trim() || "anon",
      name = channel.trim() || "lobby";
    if (!nicks.test(n) || !names.test(name)) {
      error = "昵称限 16 字，频道限 24 字；可用字母、数字、下划线和连字符";
      return;
    }
    if (status !== "已连接") {
      error = status;
      return;
    }
    if (entering) return;
    entering = true;
    const proof = password
      ? await credential(password)
      : hex(crypto.getRandomValues(new Uint8Array(32)));
    entering = false;
    if (status !== "已连接") {
      error = status;
      return;
    }
    password = "";
    identity = { nick: n, proof, trip: "" };
    link.send({ op: "identity", rosterDelta: true, nick: n, proof });
    join(name, publish);
  }
  function select(name) {
    current = name;
    unreadCount = Math.min(unread[name] || 0, logs[name]?.length || 0);
    firstUnread = unreadCount ? logs[name].at(-unreadCount) : null;
    unread[name] = 0;
    mentions[name] = false;
    showUsers = false;
    draft = "";
    below = 0;
    save();
    bottom();
    tick().then(() => area?.focus());
  }
  function join(name, pub = false) {
    if (!names.test(name)) return notice("频道名无效");
    if (!Object.hasOwn(rooms, name)) {
      if (Object.keys(rooms).length >= 9)
        return notice("最多同时加入 9 个频道");
      rooms[name] = pub;
      restore(name);
      remember(name);
      link.send({ op: "join", room: name, public: pub });
    }
    select(name);
  }
  function leave(all = false) {
    const leaving = all ? Object.keys(rooms) : [current];
    if (queue.some((q) => leaving.includes(q.room)))
      return notice("仍有待发消息，请等待发送完成或用 /cancel 取消待发");
    for (const name of leaving) {
      link.send({ op: "leave", room: name });
      joined.delete(name);
      delete rooms[name];
      delete states[name];
      delete logs[name];
    }
    rooms = rooms;
    const next = Object.keys(rooms)[0];
    if (next) return select(next);
    nick = identity?.nick || "";
    identity = null;
    current = "";
    save();
    location.reload();
  }
  function flush() {
    const m = queue[0];
    if (
      !m ||
      inflight ||
      Date.now() < until ||
      !joined.has(m.room) ||
      !identity?.trip
    )
      return;
    if (deliveryUnknown(m, bootID, Date.now())) {
      queue = queue.slice(1);
      notice("无法确认是否送达，请核对后手动重发：" + m.raw, m.room);
      save();
      return;
    }
    inflight = m.id;
    if (!m.attempt) {
      m.attempt = Date.now();
      m.boot = bootID;
      save();
    }
    const { op, kind, room, text, to, id } = m;
    link.send({ op, kind, room, text, to, id });
  }
  let bootID = "";
  function send() {
    const raw = draft.trimEnd();
    if (!raw.trim()) return;
    if ([...raw].length > 2000) return notice("消息最长 2000 字");
    let kind = "chat",
      text = raw,
      to = "";
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      const [, cmd, arg = ""] = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/) || [];
      draft = "";
      switch (cmd) {
        case "/join":
          return join(arg.replace(/^#/, ""));
        case "/leave":
          return leave();
        case "/cancel":
          queue = queue.filter((q) => q.room !== current || q.id === inflight);
          save();
          return notice("已取消尚未发出的消息");
        case "/nick":
          if (!nicks.test(arg) || status !== "已连接")
            return notice("请连接后指定有效昵称");
          return link.send({ op: "nick", nick: arg });
        case "/ignore":
        case "/unignore": {
          const trip = arg.split("#").at(-1);
          if (!tripPattern.test(trip) || trip === identity.trip)
            return notice("请输入对方的 16 位完整 trip");
          if (cmd === "/ignore") {
            if (ignored.length >= 100 && !ignored.includes(trip)) return notice("忽略列表已满");
            ignored = [...new Set([...ignored, trip])];
            notice("已忽略该 trip 的消息");
          } else {
            ignored = ignored.filter((id) => id !== trip);
            notice("已取消忽略");
          }
          save();
          return;
        }
        case "/forget":
          return forget();
        case "/users":
          return notice(
            state.users.map((u) => u.nick + "#" + u.trip).join("  "),
          );
        case "/clear":
          logs[current] = [];
          clearRows(current);
          return;
        case "/help":
          return notice(
            "/join 频道 · /leave · /nick 新名 · /topic 主题\n/me 动作 · /w 昵称#trip 消息 · /users · /clear · /cancel\n/ignore 完整trip · /unignore 完整trip · /forget 清除本地数据\n以 // 发送开头的斜杠。点击时间引用，点击昵称提及。",
          );
        case "/w": {
          const match = arg.match(/^(\S+)\s+([\s\S]+)/);
          if (!match) {
            draft = raw;
            return notice("用法：/w 昵称#trip 消息");
          }
          [, to, text] = match;
          kind = "whisper";
          break;
        }
        case "/me":
        case "/topic":
          kind = cmd.slice(1);
          text = arg;
          if (!text) return notice("请输入内容");
          break;
        default:
          draft = raw;
          return notice("未知命令，/help 查看帮助");
      }
    } else text = raw.replace(/^\/\//, "/");
    if (queue.length >= 32 || Date.now() < until) {
      draft = raw;
      return notice("待发队列已满或正在限速，请稍后发送");
    }
    if (left === 0 && status === "已连接") {
      draft = raw;
      until = Date.now() + 4000;
      return notice("限速 · 已保留输入内容");
    }
    lastInput = raw;
    draft = "";
    queue = [
      ...queue,
      {
        op: "send",
        kind,
        room: current,
        text,
        to,
        raw,
        nick: identity.nick,
        id: crypto.randomUUID(),
        created: Date.now(),
      },
    ];
    save();
    flush();
  }
  function insert(s) {
    draft += s;
    dismissed = false;
    tick().then(() => area?.focus());
  }
  function pick(s) {
    draft = s.startsWith("@")
      ? draft.replace(/@[^\s]*$/, s.split("#")[0] + " ")
      : s + " ";
    dismissed = true;
    area?.focus();
  }
  function keys(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      dismissed = true;
      bottom();
      return;
    }
    if (suggestions.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      selection =
        (selection +
          (e.key === "ArrowDown" ? 1 : -1) +
          Math.min(suggestions.length, 9)) %
        Math.min(suggestions.length, 9);
      return;
    }
    if (e.key === "Tab" && suggestions.length) {
      e.preventDefault();
      return pick(suggestions[selection] || suggestions[0]);
    }
    if (e.key === "Tab") {
      const word = draft.match(/[\p{L}\p{N}_-]+$/u);
      const u = word && state.users.find((u) => u.nick.startsWith(word[0]));
      if (u) {
        e.preventDefault();
        draft = draft.slice(0, -word[0].length) + "@" + u.nick + " ";
        return;
      }
    }
    if (e.key === "ArrowUp" && !draft) {
      e.preventDefault();
      draft = lastInput;
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  function jump(ref) {
    const el = document.getElementById("m-" + ref);
    if (!el) return notice("这条消息不在本地记录中");
    el.scrollIntoView({ block: "center" });
    el.animate([{ background: "#453710" }, { background: "transparent" }], 900);
  }
  function hotkey(e) {
    if (current && e.altKey && /^[1-9]$/.test(e.key)) {
      const n = Object.keys(rooms)[Number(e.key) - 1];
      if (n) {
        e.preventDefault();
        select(n);
      }
    }
  }
  function clash(n, t, users) {
    return users.some((u) => u.nick === n && u.trip !== t);
  }
</script>

<svelte:head
  ><title>{current ? "#" + current + " · PulseC" : "PulseC · 接入"}</title
  ></svelte:head
>
<svelte:window on:keydown={hotkey} />
{#if !current}
  <header class="bar head">
    <span class="amb">PulseC</span><span class="grow"
      >WebTransport / HTTP·3</span
    ><span>{status}</span><time>{clock(now)}</time>
  </header>
  <main class="gate">
    <p class="intro"><span class="mark">PulseC</span> 是一个匿名聊天中继。</p>
    <p>
      无需注册。昵称可以重名，认人请看 trip。已收到的消息只保存在当前标签页。
    </p>
    <p class="dim">
      运行 {Math.floor(uptime / 60)} 分钟 · 在线 {foundDirectory ? total : "—"} 人
    </p>
    <h2>热门公共频道</h2>
    <table class="chan">
      <colgroup
        ><col class="c-n" /><col class="c-u" /><col class="c-p hide-s" /><col
        /></colgroup
      ><thead
        ><tr
          ><th>频道</th><th>在线</th><th class="hide-s">脉冲 / 30 min</th><th
            >主题</th
          ></tr
        ></thead
      ><tbody>
        {#each directory.filter((r) => r.public) as r}<tr
            class:sel={r.name === channel}
            ><td
              ><button on:click={() => (channel = r.name)}>{r.name}</button></td
            ><td>{r.online}</td><td class="pulse hide-s">{spark(r.pulse)}</td
            ><td class="topic">{r.topic || "—"}</td></tr
          >{:else}<tr
            ><td colspan="4" class="mid"
              >{foundDirectory
                ? "暂无在线公共频道，可直接进入 #lobby。"
                : status}</td
            ></tr
          >{/each}</tbody
      >
    </table>
    <h2>本机已知频道</h2>
    {#if known.length}<table class="chan">
        <colgroup
          ><col class="c-n" /><col class="c-u" /><col class="c-p hide-s" /><col
          /></colgroup
        ><thead
          ><tr
            ><th>频道</th><th>在线</th><th class="hide-s">脉冲 / 30 min</th><th
              >主题</th
            ></tr
          ></thead
        ><tbody>
          {#each known as n}{@const r = directory.find((r) => r.name === n)}<tr
              class:sel={n === channel}
              ><td><button on:click={() => (channel = n)}>{n}</button></td><td
                >{foundDirectory ? r?.online || 0 : "—"}</td
              ><td class="pulse hide-s">{r ? spark(r.pulse) : "—"}</td><td
                class="topic">{r?.topic || "—"}</td
              ></tr
            >{/each}</tbody
        >
      </table>{:else}<p>加入过的频道会出现在这里。</p>{/if}
    <h2>接入</h2>
    <form on:submit|preventDefault={enter} autocomplete="off">
      <div class="field">
        <label for="nick">nick</label><input
          id="nick"
          bind:value={nick}
          maxlength="16"
          placeholder="anon"
        />
      </div>
      <div class="field">
        <label for="pass">password</label><input
          id="pass"
          type="password"
          bind:value={password}
          maxlength="256"
          placeholder="可选，用于生成固定身份"
        /><span class="hint">trip {preview || "— · 临时身份"}</span>
      </div>
      <div class="field">
        <label for="ch">channel</label><input
          id="ch"
          bind:value={channel}
          maxlength="24"
          placeholder="lobby"
        />
      </div>
      <label class="settings"
        ><input
          type="checkbox"
          bind:checked={publish}
        />新建时列入公共目录（lobby 始终公开）</label
      >
      <div class="err" role="status">{error || cacheError}</div>
      <button class="go" disabled={entering || status !== "已连接"}
        >» 接入 #{channel.trim() || "lobby"} <kbd>⏎</kbd></button
      >
    </form>
    <button class="go" data-action="forget" on:click={forget}>清除本地聊天数据</button>
    <h2>须知</h2>
    <p>
      密码在本机派生身份凭据。同名不同 trip 以 <span class="red">≠</span> 标记。
    </p>
    <p>
      每 10 秒最多 6 条消息。无人频道自动消失；本标签页每频道最多保留 500 行。
    </p>
  </main>
{:else}
  <div class="app" class:show-users={showUsers}>
    <header class="bar head">
      <button class="brand" on:click={() => leave(true)} title="离开并返回入口"
        >PulseC</button
      ><span class="grow">#{current} · {state.topic || "暂无主题"}</span><span
        class="wide">WebTransport · TLS 1.3</span
      ><time>{clock(now)}</time>
    </header>
    <nav class="tabs">
      {#each Object.keys(rooms) as n, i}<button
          class="tab"
          class:act={n === current}
          class:men={mentions[n]}
          on:click={() => select(n)}
          >{i + 1}:{n}{n === current
            ? "*"
            : unread[n]
              ? (mentions[n] ? "!" : "+") + unread[n]
              : ""}</button
        >{/each}<button class="add" on:click={() => insert("/join ")}
        >/join</button
      >
    </nav>
    <div
      class="log"
      role="log"
      bind:this={log}
      on:scroll={() => {
        if (log.scrollHeight - log.scrollTop - log.clientHeight < 40) below = 0;
      }}
    >
      {#each items as m, i}
        {@const prev = items[i - 1]}
        {#if m === firstUnread}<div class="div">{unreadCount} 条未读</div>{/if}
        {#if !prev || m.time - prev.time > 300000}<div class="div tick">
            {clock(m.time)}
          </div>{/if}
        <div
          id={m.ref ? "m-" + m.ref : undefined}
          class="ln"
          class:sys={m.kind === "sys" || m.kind === "presence"}
          class:join={m.kind === "presence"}
          class:act={m.kind === "me"}
          class:whis={m.kind === "whisper"}
          class:cont={prev &&
            m.kind === "chat" &&
            prev.kind === "chat" &&
            prev.trip === m.trip &&
            prev.nick === m.nick &&
            m.time - prev.time < 120000}
          class:men={m.trip !== identity.trip &&
            (m.kind === "whisper" || m.text.includes("@" + identity.nick))}
          class:self={m.trip === identity.trip}
        >
          <button
            class="tm"
            title={m.ref}
            on:click={() => m.ref && insert(">>" + m.ref + " ")}
            ><span class="hm">{clock(m.time)}</span><span class="id">»引用</span
            ></button
          >
          <button
            class="tr"
            title={m.trip}
            on:click={() => m.ref && insert(">>" + m.ref + " ")}
            >{m.trip?.slice(0, 5) || ""}</button
          >
          <button
            class={"nk " + (m.trip ? color(m.trip) : "")}
            class:clash={clash(m.nick, m.trip, state.users)}
            title={m.nick ? m.nick + "#" + m.trip : ""}
            on:click={() => m.nick && insert("@" + m.nick + " ")}
            >{m.nick || (m.kind === "presence" ? "±" : "--")}</button
          >
          <span class="tx"
            >{m.kind === "whisper"
              ? "→ " + m.to + "："
              : m.kind === "me"
                ? "* "
                : ""}<Body text={m.text} {jump} /></span
          >
        </div>
      {:else}<p class="empty">#{current} · 此标签页尚未收到消息。</p>{/each}
      {#each queue.filter((q) => q.room === current) as q}<div class="ln pend">
          <span class="tm">…</span><span></span><span class="nk">待发</span
          ><span class="tx">{q.raw}</span>
        </div>{/each}
      {#if below}<button class="below on" on:click={bottom}
          >↓ {below} 条新消息</button
        >{/if}
    </div>
    <aside class="users">
      <h3>在线 <span>{state.users.length}</span></h3>
      {#each [false, true] as idle}{@const group = state.users
          .filter((u) => now / 1000 - u.active >= 600 === idle)
          .sort((a, b) => a.nick.localeCompare(b.nick))}
        {#if group.length}<div class="grp">
            {idle ? "空闲 ≥10m" : "活跃"}
            {group.length}
          </div>{/if}
        {#each group as u}<button
            class="u"
            class:idle
            class:me={u.trip === identity.trip && u.nick === identity.nick}
            title={u.nick + "#" + u.trip}
            on:click={() => {
              insert("@" + u.nick + " ");
              showUsers = false;
            }}
            ><span
              class={"nm " + color(u.trip)}
              class:clash={clash(u.nick, u.trip, state.users)}>{u.nick}</span
            ><span class="tr">{u.trip}</span></button
          >{/each}{/each}
      <button class="utog" on:click={() => (showUsers = false)}>收起</button>
    </aside>
    <div class="bar stat" class:off={status !== "已连接"}>
      <span>{status}</span><button on:click={() => (showUsers = !showUsers)}
        >{state.users.length} 人</button
      ><span class="pulse" title="最近 16 分钟"
        >{spark(state.pulse.slice(-16))}</span
      ><span class="grow">{cacheError || "本地 " + items.length + "/500"}</span
      ><span>{rtt === null ? "—" : rtt + " ms"}</span>
    </div>
    <div class="input" class:throt={now < until}>
      <span class="ps"
        >{identity.nick}<small class="dim">#{identity.trip?.slice(0, 5)}</small>
        <span class="amb">›</span></span
      >
      <textarea
        aria-label="消息"
        rows="1"
        bind:this={area}
        bind:value={draft}
        on:keydown={keys}
        on:input={() => {
          selection = 0;
          dismissed = false;
        }}
        placeholder="说点什么 · /help 看命令"></textarea>
      <span class="meta"
        ><span class="wide">{[...draft].length}/2000 </span><span class="meter"
          >{now < until
            ? "锁定 " + Math.ceil((until - now) / 1000) + "s"
            : "▮".repeat(left) + "▯".repeat(6 - left)}</span
        ></span
      >
      {#if suggestions.length}<div class="pop on">
          {#each suggestions.slice(0, 9) as s, i}<button
              class:sel={selection === i}
              on:click={() => pick(s)}>{s}</button
            >{/each}
        </div>{/if}
    </div>
    <div class="bar keys">
      <span class="kb"
        ><kbd>⏎</kbd>发送 <kbd>⇧⏎</kbd>换行 <kbd>Tab</kbd>补全
        <kbd>↑</kbd>上一条 <kbd>Alt+1–9</kbd>切频道 <kbd>Esc</kbd>到底部</span
      >{#each ["/", "@", ">>", "```\n\n```", "/me ", "/w "] as s}<button
          class="tok"
          on:click={() => insert(s)}>{s.trim()}</button
        >{/each}<button class="tok" on:click={send}>发送</button>
    </div>
  </div>
{/if}
