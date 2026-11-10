<script>
  import { onMount, tick } from "svelte";
  import { readRows, appendRow, clearRows } from "$lib/history.js";
  import {
    forgetChatData,
    readSaved,
    applyMember,
    deliveryUnknown,
    tripPattern,
    colorPattern,
    names,
    nicks,
  } from "$lib/session.js";
  import { t, clock, loadLanguage } from "$lib/locale.js";
  import LanguagePicker from "$lib/LanguagePicker.svelte";
  import Entrance from "$lib/Entrance.svelte";
  import MemberList from "$lib/MemberList.svelte";
  import MessageList from "$lib/MessageList.svelte";
  import Composer from "$lib/Composer.svelte";
  import { spark, mentions as mentioned } from "$lib/format.js";
  import { normalizeHex } from "$lib/colors.js";
  import { connect } from "$lib/link.js";
  import "$lib/style.css";

  let link,
    status = "connecting",
    now = Date.now(),
    directory = [],
    total = 0,
    uptime = 0;
  let channel = "",
    error = null,
    identity = null,
    current = "",
    known = [],
    ignored = [];
  let rooms = Object.create(null),
    states = Object.create(null),
    logs = Object.create(null),
    unread = Object.create(null),
    mentions = Object.create(null);
  // Rooms this tab was removed from (kick, ban, lock). The tab stays for reading.
  let parted = new Set();
  let joined = new Set(),
    queue = [],
    inflight = "",
    until = 0,
    sent = [],
    rtt = null;
  let draft = "",
    composer,
    log,
    showUsers = false,
    memberToggle,
    acknowledged = Object.create(null),
    below = 0,
    lastInput = "";
  let firstUnread,
    unreadCount = 0;
  let cacheError = "",
    foundDirectory = false;
  const blank = { users: [], pulse: Array(30).fill(0), topic: "" };
  $: state = states[current] || blank;
  $: items = (logs[current] || []).filter(
    (m) => !m.trip || !ignored.includes(m.trip),
  );
  $: left = Math.max(0, 6 - sent.filter((t) => now - t < 10000).length);
  function forget() {
    if (!window.confirm($t("forgetConfirm"))) return;
    try {
      forgetChatData(sessionStorage, localStorage);
    } catch {
      notice("forgetFailed");
      return;
    }
    link?.close();
    location.replace(location.pathname);
  }
  function save() {
    try {
      sessionStorage.setItem(
        "pulsec.session",
        JSON.stringify({
          identity,
          current,
          rooms,
          queue,
          ignored,
        }),
      );
    } catch {
      cacheError = "cacheUnavailable";
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
        cacheError = "cacheUnavailable";
      }
    }
  }
  function directoryRequest() {
    link?.send({ op: "directory", known });
  }
  function authorize() {
    if (!identity) return;
    link.send({
      op: "identity",
      rosterDelta: true,
      nick: identity.nick,
      proof: identity.proof,
      color: identity.color || "",
    });
    for (const [room, pub] of Object.entries(rooms))
      if (!parted.has(room)) link.send({ op: "join", room, public: pub });
  }
  function heartbeat() {
    if (!current) directoryRequest();
    else link.send({ op: "ping", id: String(Date.now()) });
  }
  onMount(() => {
    loadLanguage();
    hidden = document.hidden;
    const saved = readSaved("sessionStorage", "pulsec.session", {});
    if (
      saved.identity &&
      nicks.test(saved.identity.nick) &&
      /^[a-f0-9]{64}$/.test(saved.identity.proof)
    ) {
      identity = saved.identity;
      if (!colorPattern.test(identity.color)) identity.color = "";
      for (const [name, listed] of Object.entries(saved.rooms || {})
        .filter(([name]) => names.test(name))
        .slice(0, 9)) {
        rooms[name] = listed === true;
      }
      current = Object.hasOwn(rooms, saved.current)
        ? saved.current
        : Object.keys(rooms)[0] || "";
      // Treat a partially written or obsolete login without channels as signed out.
      if (!current) identity = null;
      queue = Array.isArray(saved.queue)
        ? saved.queue
            .filter(
              (q) =>
                q?.op === "send" &&
                Object.hasOwn(rooms, q.room) &&
                typeof q.id === "string" &&
                typeof q.raw === "string" &&
                typeof q.text === "string",
            )
            .slice(0, 32)
        : [];
    }
    ignored = Array.isArray(saved.ignored)
      ? saved.ignored.filter((trip) => tripPattern.test(trip))
      : [];
    const recent = readSaved("localStorage", "pulsec.channels", []);
    known = Array.isArray(recent)
      ? recent
          .filter((n) => typeof n === "string" && names.test(n))
          .slice(0, 50)
      : [];
    for (const name of Object.keys(rooms)) restore(name);
    channel = new URLSearchParams(location.search).get("ch") || "";
    link = connect({
      status: (s) => {
        status = s;
        if (s !== "connected") {
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
    if (merge)
      m = {
        ...m,
        text: prev.text + "   " + m.text,
        parts: [...(prev.parts || [{ text: prev.text }]), ...m.parts],
      };
    logs[name] = merge
      ? [...logs[name].slice(0, -1), m]
      : [...logs[name].slice(-499), m];
    try {
      appendRow(name, m, merge);
    } catch {
      cacheError = "cacheUnavailable";
    }
    const pinged =
      !!m.trip &&
      m.trip !== identity.trip &&
      (m.kind === "whisper" || mentioned(m.text, identity.nick));
    if (name !== current) {
      if (!merge && !m.quiet) unread[name] = (unread[name] || 0) + 1;
      if (pinged) mentions[name] = true;
    } else {
      if (hidden && m.trip && m.trip !== identity.trip) {
        away = [...away, m].slice(-500);
        if (pinged) awayMention = true;
      }
      if (stick) bottom();
      else below++;
    }
  }
  // Messages that arrived in the open channel while the browser tab was hidden.
  let hidden = false,
    away = [],
    awayMention = false;
  function visibility() {
    hidden = document.hidden;
    if (hidden || !away.length) return;
    const list = logs[current] || [];
    const first = away.find((m) => list.includes(m));
    if (first) {
      firstUnread = first;
      unreadCount = list.length - list.indexOf(first);
    }
    away = [];
    awayMention = false;
  }
  $: pending =
    Object.entries(unread).reduce(
      (sum, [name, n]) => sum + (name === current ? 0 : n || 0),
      0,
    ) + away.length;
  $: pingedAny =
    awayMention ||
    Object.entries(mentions).some(([name, on]) => on && name !== current);
  $: badge = pending ? "(" + (pingedAny ? "!" : "") + pending + ") " : "";
  function notice(code, room = current, details = {}) {
    const event = {
      kind: "sys",
      code,
      text: $t(code, details.params, details.text),
      time: Date.now(),
      ...details,
    };
    if (room) add(room, event);
    else error = event;
  }

  // The relay sends a room snapshot on every join and after topic changes.
  function arrived(next, prev) {
    const room = next.room;
    if (!joined.has(room)) {
      restore(room);
      const last = logs[room].at(-1);
      const code = logs[room].length ? "rejoined" : "joinedRoom";
      if (last?.code !== code)
        notice(code, room, { params: { room }, quiet: true });
    } else if (prev && prev.topic !== next.topic)
      notice(next.topic ? "topicChanged" : "topicCleared", room, {
        params: { topic: next.topic },
      });
  }
  function presence(e) {
    if (!e.text || !Object.hasOwn(rooms, e.room)) return;
    const code = { join: "memberJoin", leave: "memberLeave" }[e.action];
    const part =
      code && e.user
        ? {
            code,
            params: { name: e.user.nick + "#" + e.user.trip },
            text: e.text,
          }
        : { text: e.text };
    add(e.room, {
      kind: "presence",
      text: e.text,
      parts: [part],
      time: Date.now(),
    });
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
      case "color":
        if (identity && (e.color === "" || colorPattern.test(e.color))) {
          identity.color = e.color;
          save();
          notice(
            e.color ? "colorSet" : "colorReset",
            current,
            e.color ? { params: { color: e.color } } : {},
          );
        }
        break;
      case "moderation":
        moderated(e);
        break;
      case "state":
        if (Object.hasOwn(rooms, e.room)) {
          arrived(e, states[e.room]);
          states[e.room] = e;
          mark(e.room, false);
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
        states[e.room] = { ...state, users };
        if (e.action !== "color") presence(e);
        break;
      }
      case "notice":
        presence(e);
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
        if (!m) break;
        acknowledged[m.room] = Date.now();
        if (m.kind !== "topic")
          add(m.room, {
            ...m,
            time: m.created,
            ref: e.ref,
            nick: m.nick,
            trip: identity.trip,
            color: identity.color || undefined,
          });
        queue = queue.filter((q) => q.id !== e.id);
        inflight = "";
        sent = [...sent.filter((t) => Date.now() - t < 10000), Date.now()];
        save();
        flush();
        break;
      }
      case "limited": {
        const m = queue.find((q) => q.id === e.id);
        if (!m) break;
        // The relay explicitly rejected this attempt. It is safe to cancel or retry.
        delete m.attempt;
        delete m.boot;
        save();
        inflight = "";
        until = Date.now() + e.wait + 100;
        break;
      }
      case "error": {
        const m = queue.find((q) => q.id === e.id);
        if (m) {
          queue = queue.filter((q) => q.id !== e.id);
          inflight = "";
          notice(e.code, m.room, {
            text: e.text || $t("rejected"),
            unsent: m.raw,
            warn: true,
          });
          if (!draft && current === m.room) draft = m.raw;
          save();
        } else if (e.request === "join" && Object.hasOwn(rooms, e.room)) {
          notice(e.code, e.room, {
            text: e.text || $t("rejected"),
            warn: true,
          });
          if (e.code === "room_banned" || e.code === "room_locked")
            part(e.room);
          if (e.code !== "room_banned")
            notice("retryJoin", e.room, { params: { room: e.room } });
        } else
          notice(e.code, current, {
            text: e.text || $t("rejected"),
            warn: true,
          });
        break;
      }
    }
  }
  const tag = (nick, trip) => (nick || "") + "#" + (trip || "").slice(0, 5);
  const codes = {
    kick: "modKick",
    ban: "modBan",
    unban: "modUnban",
    mute: "modMute",
    unmute: "modUnmute",
    op: "modOp",
    deop: "modDeop",
  };
  function moderated(e) {
    if (!Object.hasOwn(rooms, e.room)) return;
    const by = tag(e.by?.nick, e.by?.trip);
    const params = { by, target: tag(e.nick, e.target), rate: e.rate };
    const toggles = {
      slow: e.on ? "modSlow" : "modSlowOff",
      lock: e.on ? "modLock" : "modUnlock",
      topiclock: e.on ? "modTopicLock" : "modTopicUnlock",
      public: e.on ? "modPublic" : "modPrivate",
    };
    const code = codes[e.action] || toggles[e.action];
    if (code) notice(code, e.room, { params });
    if (
      (e.action === "kick" || e.action === "ban") &&
      e.target === identity.trip
    ) {
      notice(e.action === "kick" ? "youKicked" : "youBanned", e.room, {
        params: { by, room: e.room },
      });
      part(e.room);
    }
  }
  function mark(room, gone) {
    if (parted.has(room) === gone) return;
    const next = new Set(parted);
    if (gone) next.add(room);
    else next.delete(room);
    parted = next;
  }
  // The relay no longer has us in this room. Keep the tab and its history.
  function part(room) {
    joined.delete(room);
    mark(room, true);
    const rest = Object.assign(Object.create(null), states);
    delete rest[room];
    states = rest;
    const dropped = queue.filter((q) => q.room === room && q.id !== inflight);
    if (dropped.length) {
      queue = queue.filter((q) => !dropped.includes(q));
      for (const q of dropped)
        notice("not_joined", room, { unsent: q.raw, warn: true });
      save();
    }
  }
  $: admin =
    !!identity?.trip &&
    (state.owner === identity.trip || !!state.mods?.includes(identity.trip));
  function moderate(action, extra = {}) {
    if (status !== "connected") return notice("needConnection");
    if (!admin) return notice("not_admin");
    link.send({ op: "moderate", room: current, action, ...extra });
  }
  // A target is a nick, nick#trip or full trip among members (or the ban list).
  function target(text, unban = false) {
    const word = text.trim();
    if (!word) return notice("needTarget");
    const [nick, trip] = word.includes("#") ? word.split("#") : [word, ""];
    if (tripPattern.test(word)) return word;
    if (unban) {
      const hit = (state.banned || []).filter(
        (t) => t === trip || t.startsWith(word),
      );
      if (hit.length === 1) return hit[0];
    }
    const hits = [
      ...new Set(
        state.users
          .filter((u) =>
            trip ? u.nick === nick && u.trip === trip : u.nick === nick,
          )
          .map((u) => u.trip),
      ),
    ];
    if (hits.length === 1) return hits[0];
    return notice(hits.length ? "ambiguousTarget" : "needTarget");
  }
  function enter(n, proof, name, publish) {
    identity = { nick: n, proof, trip: "", color: "" };
    link.send({ op: "identity", rosterDelta: true, nick: n, proof });
    join(name, publish);
  }
  function select(name) {
    if (name === current) {
      composer?.focus();
      return;
    }
    current = name;
    unreadCount = Math.min(unread[name] || 0, logs[name]?.length || 0);
    firstUnread = unreadCount ? logs[name].at(-unreadCount) : null;
    unread[name] = 0;
    mentions[name] = false;
    away = [];
    awayMention = false;
    showUsers = false;
    draft = "";
    below = 0;
    save();
    bottom();
    tick().then(() => composer?.focus());
  }
  function join(name, pub = false) {
    if (!names.test(name)) return notice("invalid_room");
    if (!Object.hasOwn(rooms, name)) {
      if (Object.keys(rooms).length >= 9) return notice("room_limit");
      rooms[name] = pub;
      restore(name);
      remember(name);
    }
    if (!joined.has(name)) {
      mark(name, false);
      link.send({ op: "join", room: name, public: rooms[name] });
    }
    select(name);
  }
  function leave(all = false) {
    const leaving = all ? Object.keys(rooms) : [current];
    if (queue.some((q) => leaving.includes(q.room)))
      return notice("leavePending");
    const remaining = Object.assign(Object.create(null), rooms);
    for (const name of leaving) {
      if (!parted.has(name)) link.send({ op: "leave", room: name });
      mark(name, false);
      joined.delete(name);
      delete remaining[name];
      delete states[name];
      delete logs[name];
    }
    rooms = remaining;
    const next = Object.keys(rooms)[0];
    if (next) return select(next);
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
      notice("uncertain", m.room, { params: { raw: m.raw } });
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
    if ([...raw].length > 2000) return notice("invalid_text");
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
          queue = queue.filter((q) => q.room !== current || q.attempt);
          save();
          return notice("canceled");
        case "/nick":
          if (!nicks.test(arg) || status !== "connected")
            return notice("connectedNick");
          return link.send({ op: "nick", nick: arg });
        case "/ignore":
        case "/unignore": {
          const trip = arg.split("#").at(-1);
          if (!tripPattern.test(trip) || trip === identity.trip)
            return notice("needTrip");
          if (cmd === "/ignore") {
            if (ignored.length >= 100 && !ignored.includes(trip))
              return notice("muteFull");
            ignored = [...new Set([...ignored, trip])];
            notice("muted");
          } else {
            ignored = ignored.filter((id) => id !== trip);
            notice("unmuted");
          }
          save();
          return;
        }
        case "/forget":
          return forget();
        case "/color": {
          if (!arg.trim()) {
            if (status !== "connected") return notice("needConnection");
            return link.send({ op: "color", color: "" });
          }
          const hex = normalizeHex(arg);
          if (!hex) {
            draft = raw;
            return notice("colorUsage");
          }
          if (status !== "connected") return notice("needConnection");
          return link.send({ op: "color", color: hex });
        }
        case "/kick":
        case "/ban":
        case "/unban":
        case "/mute":
        case "/unmute":
        case "/op":
        case "/deop": {
          const trip = target(arg, cmd === "/unban");
          if (!trip) return;
          if (
            cmd === "/ban" &&
            !window.confirm($t("banConfirm", { name: arg.trim() }))
          )
            return;
          return moderate(cmd.slice(1), { target: trip });
        }
        case "/slow": {
          const rate = Number(arg.trim() || "-1");
          if (!Number.isInteger(rate) || rate < 0 || rate > 5) {
            draft = raw;
            return notice("slowUsage");
          }
          return moderate("slow", { rate, on: rate > 0 });
        }
        case "/lock":
        case "/unlock":
          return moderate("lock", { on: cmd === "/lock" });
        case "/locktopic":
        case "/unlocktopic":
          return moderate("topiclock", { on: cmd === "/locktopic" });
        case "/public":
        case "/private":
          return moderate("public", { on: cmd === "/public" });
        case "/users":
          return notice(undefined, current, {
            text: state.users.map((u) => u.nick + "#" + u.trip).join("  "),
          });
        case "/clear":
          logs[current] = [];
          try {
            clearRows(current);
          } catch {
            cacheError = "cacheUnavailable";
          }
          return;
        case "/help":
          return notice("help");
        case "/w": {
          const match = arg.match(/^(\S+)\s+([\s\S]+)/);
          if (!match) {
            draft = raw;
            return notice("whisperUsage");
          }
          [, to, text] = match;
          kind = "whisper";
          break;
        }
        case "/me":
        case "/topic":
          kind = cmd.slice(1);
          text = arg;
          if (!text) return notice("needText");
          break;
        default:
          draft = raw;
          return notice("unknownCommand");
      }
    } else text = raw.replace(/^\/\//, "/");
    if (parted.has(current)) {
      draft = raw;
      return notice("parted", current, { params: { room: current } });
    }
    if (state.muted?.includes(identity.trip) && !admin) {
      draft = raw;
      return notice("room_muted");
    }
    if (kind === "topic" && state.topicLocked && !admin) {
      draft = raw;
      return notice("topic_locked");
    }
    if (queue.length >= 32 || Date.now() < until) {
      draft = raw;
      return notice("queueFull");
    }
    if (left === 0 && status === "connected") {
      draft = raw;
      until = Date.now() + 4000;
      return notice("retained");
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
  function insert(text) {
    composer?.insert(text);
  }
  function whisper(target) {
    composer?.whisper(target);
  }
  function jump(ref) {
    const el = document.getElementById("m-" + ref);
    if (!el) return notice("missingRef");
    el.scrollIntoView({ block: "center" });
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      el.animate(
        [{ background: "#453710" }, { background: "transparent" }],
        900,
      );
  }
  function closeMembers() {
    showUsers = false;
    memberToggle?.focus();
  }
  async function toggleMembers() {
    showUsers = !showUsers;
    if (showUsers) {
      await tick();
      document.querySelector("#members .utog")?.focus();
    }
  }
  function hotkey(e) {
    if (e.key === "Escape" && showUsers) {
      closeMembers();
      return;
    }
    if (current && e.altKey && /^[1-9]$/.test(e.key)) {
      const n = Object.keys(rooms)[Number(e.key) - 1];
      if (n) {
        e.preventDefault();
        select(n);
      }
    }
  }
</script>

<svelte:head
  ><title
    >{current
      ? badge + "#" + current + " · PulseC"
      : "PulseC · " + $t("join")}</title
  ></svelte:head
>
<svelte:window on:keydown={hotkey} />
<svelte:document on:visibilitychange={visibility} />
{#if !current}
  <Entrance
    bind:channel
    bind:error
    {now}
    {foundDirectory}
    {status}
    {directory}
    {total}
    {uptime}
    {known}
    {cacheError}
    {forget}
    onEnter={enter}
  />
{:else}
  <main class="app" class:show-users={showUsers}>
    <header class="bar head">
      <button class="brand" on:click={() => leave(true)} title={$t("leave")}
        >PulseC</button
      ><span class="grow"
        ><span class="ch">#{current}</span> · {state.topic ||
          $t("noTopic")}</span
      ><span class="wide">WebTransport · TLS 1.3</span><LanguagePicker /><time
        >{$clock(now)}</time
      >
    </header>
    <nav class="tabs" aria-label={$t("channel")}>
      {#each Object.keys(rooms) as n, i}<button
          class="tab"
          class:act={n === current}
          aria-current={n === current ? "page" : undefined}
          class:men={mentions[n]}
          class:unr={n !== current && unread[n] > 0}
          class:gone={parted.has(n)}
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
    <MessageList
      bind:log
      bind:below
      {queue}
      {current}
      {inflight}
      {items}
      {firstUnread}
      {unreadCount}
      {identity}
      users={state.users}
      {jump}
      {insert}
      {whisper}
      {bottom}
    />
    <MemberList
      users={state.users}
      {state}
      {admin}
      {moderate}
      {identity}
      {now}
      {insert}
      {whisper}
      close={closeMembers}
    />
    <div class="bar stat" class:off={status !== "connected"}>
      <span
        role="status"
        title={status === "reconnecting" ? $t("offlineHint") : undefined}
        >{$t(status)}</span
      ><span class="wide"
        ><span class="k">{$t("onlineLabel")}</span> {state.users.length}</span
      ><button
        class="utog"
        aria-expanded={showUsers}
        aria-controls="members"
        bind:this={memberToggle}
        on:click={toggleMembers}
        >{$t("members", { count: state.users.length })}</button
      ><span title={$t("pulse")}
        ><span class="k wide">{$t("pulseLabel")}</span>
        <span class="pulse">{spark(state.pulse)}</span>
        <span class="wide"
          >{$t("perMinute", {
            rate:
              Math.round(
                (state.pulse.reduce((a, b) => a + b, 0) / state.pulse.length) *
                  10,
              ) / 10,
          })}</span
        ></span
      ><span class="grow"
        >{#if cacheError}<span class="warnText">{$t(cacheError)}</span
          >{:else}<span class="k">{$t("cache")}</span>
          {items.length}/500{/if}</span
      ><span class="rtt"
        ><span class="k">rtt</span> {rtt === null ? "—" : rtt + " ms"}</span
      >
      {#if status === "reconnecting"}<span class="offline-detail"
          >{$t("offlineHint")}</span
        >{/if}
    </div>
    <Composer
      confirmed={now - (acknowledged[current] ?? 0) < 3500}
      bind:this={composer}
      bind:draft
      users={state.users}
      {identity}
      {until}
      {now}
      {left}
      {lastInput}
      {bottom}
      {send}
    />
  </main>
{/if}
