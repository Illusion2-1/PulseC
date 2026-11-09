# 中继协议（v1）

浏览器先读取同源 `GET /config` 得到中继实例启动标识 `boot` 和本机开发模式的证书指纹 `pin`。公网使用系统信任的 TLS 证书。连接同一主机的 `https://…/connect` 后，每个会话使用一条可靠双向流，每行一个 UTF-8 JSON 对象，发送方用 LF 结束，单个客户端命令不超过 32 KiB（含换行）。两个方向分别有序，不保证不同流同步。以下是应用协议；不支持 WebSocket。

| 客户端命令 | 输入 / 前置条件 | 中继结果 |
|---|---|---|
| directory | known 为本机知道的频道名，未设身份也可查询 | directory：rooms、online（已入房连接数）、uptime 秒。未列出频道仅在名称匹配时返回，知道名字即可加入 |
| identity | 每连接一次；nick、64 个小写十六进制字符的 proof、可选 rosterDelta | identity：trip。proof 可重用，不回传、不记录。新连接必须重新提交 |
| join / leave | 已提供身份；room、创建时可设置 public | 加入者得到完整 state：users、topic、public、30 个逐分钟 pulse 桶。迟入者无历史。最后一个成员离开时房间释放 |
| nick | 已提供身份；nick | nick 确认后发送名单变更 |
| send | 已入房；room、id、kind、text；whisper 还需 to | chat / me 广播给全员（含发送者）；whisper 只给指定目标与发送者；topic 更新房间状态。成功后 ack 携带原 id 和 ref |
| ping | id 为短字符串，浏览器用毫秒时间戳 | pong 回显 id；同时为本连接已加入的房间返回 pulse |

新客户端声明 `rosterDelta: true` 后，先收到 state，再按顺序处理 member.action（join、leave、nick）和 member.user。成员以连接级 user.id 区分，同名同 trip 的两个标签页不是同一连接。未声明能力的客户端继续收完整 state，以及入退通知 notice。服务端添加字段时客户端应忽略不认识的字段；未知事件不应中断连接。

私聊以昵称或“昵称#完整trip”寻址。若仍有多个匹配连接，一律报错而非任选。ack 表示中继接受了命令，不证明每个收件人已读。对于断开前未确认的发送，仅在同一 boot、同一 trip、客户端两分钟重试窗口内重发同一 id；中继只保留短期标识与回执，同 id 不会二次投递。不保留正文；换实例或超过窗口应提示用户确认，不自动重发。慢接收者的有界队列满后中继断开该会话，其他成员继续交流。

error 由 code 分类；id、room、request 标识请求，text 供旧客户端和未知码回退。当前输入错误包括 identity_required、invalid_room、room_limit、invalid_nick、not_joined、invalid_id、invalid_text、topic_too_long、ambiguous_recipient、recipient_offline、unknown_kind、unknown_op。limited 是独立事件，包含原 id 和等待毫秒数 wait；客户端在此期间保留待发消息。无效握手、超长或损坏的帧、中断的流可能直接断开，不保证先发 error。

[机器可读样例](../testdata/protocol.json)中的 event 是必须匹配的字段子集；Go 测试重放对应命令以防文案变化影响错误分类。

公网限额：握手、CONNECT 各有独立的全实例速率预算；容量不足时 CONNECT 可能被拒绝（HTTP 503），客户端按退避重连。每连接最多加入 9 个房间；每次 directory 最多查询 50 个已知名字，超过返回 too_many_known。目录、加入/离开、改名及 ping 共用每连接每秒 2 次、突发 24 次的控制命令预算；同房主题至少间隔 10 秒，过快返回 control_limited。会话总量、房间总量和短期回执都有硬上限，容量不足的新建房间和新消息返回 server_busy；重试同一已确认 id 仍可得到原回执。转发前合算同 trip 与同来源地址的发送预算，受限的发送返回 limited 和等待时间。来源仅取 QUIC 连接实际地址，计数在内存中过期，不作身份或日志标签。
