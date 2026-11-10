// Protocol and application identifiers are stable across display languages.
export const messages = {
  connecting: ["正在连接", "Connecting"],
  connected: ["已连接", "Connected"],
  reconnecting: ["断线 · 正在重连", "Disconnected · reconnecting"],
  unsupported: [
    "浏览器不支持 WebTransport。请改用支持 HTTP/3 WebTransport 的浏览器。",
    "This browser cannot open WebTransport. Use a browser with HTTP/3 WebTransport support.",
  ],
  offlineHint: [
    "正在重试。请检查网络是否允许 UDP。离线期间的消息无法补收。",
    "Retrying. Check that your network allows UDP. Messages sent while offline cannot be recovered.",
  ],
  intro: ["匿名聊天室", "Anonymous chat"],
  privacy: [
    "无需注册。昵称可以重名，用 trip 区分身份。中继可见转发内容，不保存聊天记录。",
    "No account needed. Check the trip to distinguish people with the same name. The relay can read messages as it forwards them and keeps no chat history.",
  ],
  stats: [
    "运行 {minutes} 分钟 · 在线 {online} 人",
    "Uptime {minutes} min · {online} online",
  ],
  publicRooms: ["热门公共频道", "Popular public channels"],
  knownRooms: ["本机已知频道", "Remembered channels"],
  channel: ["频道", "Channel"],
  online: ["在线", "Online"],
  pulse: ["活跃度 · 30 分钟", "Activity · 30 min"],
  topic: ["主题", "Topic"],
  noPublic: [
    "暂无在线公共频道，可直接进入 #lobby。",
    "No public channels online. You can join #lobby.",
  ],
  noKnown: [
    "加入过的频道会出现在这里。",
    "Channels you join will appear here.",
  ],
  join: ["接入", "Join"],
  nick: ["昵称", "Nickname"],
  password: ["密码", "Password"],
  passwordHint: [
    "可选，用于生成固定身份",
    "Optional, for a repeatable identity",
  ],
  temporary: ["临时身份", "temporary identity"],
  publish: [
    "新建时列入公共目录（lobby 始终公开）",
    "List new channel publicly (#lobby is always public)",
  ],
  forget: ["清除本地聊天数据", "Clear local chat data"],
  forgetConfirm: [
    "清除本标签页的身份、记录、忽略列表、待发消息和本机已知频道？此操作无法撤销。",
    "Clear this tab’s identity, history, mute list, pending messages and this browser’s remembered channels? This cannot be undone.",
  ],
  forgetFailed: [
    "浏览器未允许完整清除数据。请在浏览器设置中清理。",
    "The browser could not clear all data. Clear site data in your browser settings.",
  ],
  about: ["使用须知", "Before you join"],
  identityInfo: [
    "密码在本机生成身份凭据。同名不同 trip 以 ≠ 标记。知道未列出频道的名称即可加入。",
    "Your password derives a credential on this device. ≠ marks identical names with different trips. Anyone who knows an unlisted channel’s name can join it.",
  ],
  limitInfo: [
    "每 10 秒最多 6 条消息。无人频道自动消失。本标签页每频道保留最近 500 行，刷新可恢复。",
    "Send up to 6 messages per 10 seconds. Empty channels disappear. Each tab keeps the latest 500 rows per channel across refreshes.",
  ],
  leave: ["离开并返回入口", "Leave and return to the entrance"],
  noTopic: ["暂无主题", "No topic"],
  unread: ["{count} 条未读", "{count} unread"],
  quote: ["引用", "Quote"],
  empty: ["此标签页尚未收到消息。", "No messages received in this tab yet."],
  queued: ["待发", "Queued"],
  retryJoin: [
    "请稍后输入 /join {room} 重新加入。",
    "Try /join {room} again in a moment.",
  ],
  remaining: [
    "本轮还可发送 {count} 条",
    "{count} sends available in this window",
  ],
  sending: ["发送中", "Sending"],
  confirmed: ["已确认", "Acknowledged"],
  newMessages: ["{count} 条新消息", "{count} new messages"],
  newMessage: ["{count} 条新消息", "{count} new message"],
  idle: ["空闲 ≥10 分钟", "Idle ≥10 min"],
  active: ["活跃", "Active"],
  close: ["收起", "Close"],
  members: ["{count} 人", "{count} online"],
  cacheCount: ["本地 {count}/500", "Local {count}/500"],
  message: ["消息", "Message"],
  draftHint: [
    "说点什么 · /help 看命令",
    "Write a message · /help for commands",
  ],
  cooldown: ["限速 {seconds}s", "Limited {seconds}s"],
  send: ["发送", "Send"],
  newline: ["换行", "New line"],
  complete: ["补全", "Complete"],
  last: ["上一条", "Previous"],
  switch: ["切频道", "Switch channel"],
  bottom: ["到底部", "Latest"],
  cacheUnavailable: [
    "会话存储不可用，刷新可能丢失本地数据",
    "Tab storage is unavailable. Refreshing may lose local data.",
  ],
  invalidEntry: [
    "昵称限 16 字，频道限 24 字。可用字母、数字、下划线和连字符。",
    "Use up to 16 characters for a nickname and 24 for a channel. Letters, digits, underscores and hyphens are allowed.",
  ],
  leavePending: [
    "还有待发消息。等候确认或用 /cancel 取消未发出的消息。",
    "Messages are pending. Wait for confirmation or use /cancel to discard unsent messages.",
  ],
  uncertain: [
    "无法确认是否送达，请核对后手动重发：{raw}",
    "Delivery unknown. Check before resending: {raw}",
  ],
  canceled: ["已取消尚未发出的消息", "Unsent messages canceled"],
  connectedNick: ["请连接后指定有效昵称", "Connect and enter a valid nickname"],
  needTrip: [
    "请输入对方的 16 位完整 trip",
    "Enter the other person’s full 16-character trip",
  ],
  muteFull: ["忽略列表已满", "Mute list is full"],
  muted: ["已忽略该 trip 的消息", "Messages from that trip are muted"],
  unmuted: ["已取消忽略", "Trip unmuted"],
  help: [
    "/join 频道 · /leave · /nick 新名 · /topic 主题\n/me 动作 · /w 昵称#trip 消息 · /users · /clear · /cancel\n/ignore 完整trip · /unignore 完整trip · /forget 清除本地数据\n用 // 发送开头的斜杠。点击时间引用，点击昵称提及，点击 trip 私聊。",
    "/join channel · /leave · /nick name · /topic topic\n/me action · /w nick#trip message · /users · /clear · /cancel\n/ignore trip · /unignore trip · /forget clears local data\nUse // for a leading slash. Select a timestamp to quote, a name to mention or a trip to whisper.",
  ],
  whisperTo: ["私聊 {name}", "Whisper to {name}"],
  mention: ["提及 {name}", "Mention {name}"],
  you: ["你", "you"],
  nextField: ["下一项", "Next field"],
  newRoom: ["新频道", "new channel"],
  whisperUsage: ["用法：/w 昵称#trip 消息", "Usage: /w nick#trip message"],
  needText: ["请输入内容", "Enter some text"],
  unknownCommand: [
    "未知命令，/help 查看帮助",
    "Unknown command. Type /help for help.",
  ],
  queueFull: [
    "待发队列已满或正在限速，请稍后发送",
    "Queue full or rate limited. Try again shortly.",
  ],
  retained: ["限速 · 已保留输入内容", "Rate limited · draft kept"],
  missingRef: [
    "这条消息不在本地记录中",
    "This message is not in local history",
  ],
  invalid_room: ["频道名无效", "Invalid channel name"],
  room_limit: ["最多同时加入 9 个频道", "Join up to 9 channels at once"],
  identity_required: ["请先设置身份", "Set your identity first"],
  invalid_nick: ["昵称无效", "Invalid nickname"],
  not_joined: ["尚未加入频道", "You have not joined that channel"],
  invalid_id: ["消息编号无效", "Invalid message ID"],
  invalid_text: [
    "消息需要 1–2000 个字符",
    "Use 1–2,000 characters per message",
  ],
  topic_too_long: [
    "主题最长 120 字",
    "Topics can contain up to 120 characters",
  ],
  ambiguous_recipient: [
    "收件人有重名，请指定昵称#完整trip",
    "Ambiguous recipient. Specify nick#full-trip.",
  ],
  recipient_offline: ["收件人不在线", "Recipient is offline"],
  unknown_kind: ["未知消息类型", "Unknown message type"],
  unknown_op: ["未知操作", "Unknown operation"],
  server_busy: ["中继已满，请稍后再试", "Relay at capacity. Try again later."],
  too_many_known: ["已知频道数量过多", "Too many remembered channels"],
  control_limited: [
    "操作过于频繁，请稍后再试",
    "Too many requests. Try again shortly.",
  ],
  unsent: ["未发送：{raw}", "Not sent: {raw}"],
  rejected: ["操作失败", "Request failed"],
  memberJoin: ["{name} 加入", "{name} joined"],
  memberLeave: ["{name} 离开", "{name} left"],
  line: ["{count} 行", "{count} line"],
  lines: ["{count} 行", "{count} lines"],
  copy: ["复制", "Copy"],
  copied: ["已复制", "Copied"],
  copyFailed: ["未能复制", "Copy failed"],
};

export function chooseLocale(preference, languages) {
  if (preference === "en" || preference === "zh-CN") return preference;
  for (const name of languages || []) {
    if (/^en(?:-|$)/i.test(name)) return "en";
    if (/^zh(?:-|$)/i.test(name)) return "zh-CN";
  }
  return "zh-CN";
}

export function translator(locale) {
  const index = locale === "en" ? 1 : 0;
  const numbers = new Intl.NumberFormat(locale);
  return (key, params = {}, fallback = "") => {
    if (!Object.hasOwn(messages, key)) return fallback;
    return messages[key][index].replace(/\{(\w+)\}/g, (_, name) => {
      const value = params[name];
      return typeof value === "number" ? numbers.format(value) : (value ?? "");
    });
  };
}

export function displayEvent(t, message) {
  if (message.parts)
    return message.parts.map((part) => displayEvent(t, part)).join("   ");
  const text = t(message.code, message.params, message.text || "");
  return message.unsent
    ? text + " · " + t("unsent", { raw: message.unsent })
    : text;
}
