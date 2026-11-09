# Go 中继的结构

根目录的 [main.go](../main.go) 是可执行文件入口。它解析命令行、嵌入 SvelteKit 构建产物，把静态文件系统、配置、日志和退出信号交给 `server.Run`。根入口让 `go build .` 可以直接嵌入 `web/build`。只开发协议或聊天规则时，单测可以独立于前端构建运行。

依赖方向为 `main → server → chat → protocol`。server 也直接使用 protocol 读帧。chat 和 server 各自持有 `ratelimit.Bucket`，共用同一套突发额度算法，分别管理发言和接入配额。浏览器与 Go 中继共用协议样例。

| 改什么 | 从哪里开始 | 可以单独跑的检查 |
|---|---|---|
| 登录、成员与频道、私聊收件人、去重或发言限额 | [internal/chat](../internal/chat)，从 [Hub.Handle](../internal/chat/hub.go) 的命令分派进入对应规则 | `go test -race ./internal/chat` |
| 命令解码、事件字段、错误码、帧边界或兼容文案 | [internal/protocol](../internal/protocol) 和[协议约定](protocol.md) | `go test ./internal/protocol ./internal/chat`，对照[跨端样例](../testdata/protocol.json) |
| Origin、证书、监听器、连接配额、超时或流关闭 | [internal/server](../internal/server) | `go test -race ./internal/server`。涉及 TLS 或监听器时再运行 `make smoke` |
| 命令行或默认启动方式 | [main.go](../main.go) | `make build` 后运行 `./dist/pulsec -help` 和 `./dist/pulsec -version` |

## 一条群聊消息如何到达收件人

1. server 给每个 WebTransport 会话分配一个 Peer。读协程设置期限，`protocol.Reader` 按行限制大小、校验 UTF-8 并解码 JSON，成功后调用 `Hub.Handle`。网络接入配额在设置身份之前就生效。
2. chat 在同一把锁下检查发送者是否在房内、消息是否已经确认、身份和来源额度是否允许。群聊选择全房成员。私聊只选择发件人和唯一匹配的收件人。这些规则可以用普通 Go 值和内存队列验证。
3. chat 调用 protocol 的事件构造函数得到一份含换行符的完整帧。一次群聊的所有收件人共享同一段只读字节。每个 Peer 的队列可容纳 64 帧，Hub 只做非阻塞入队，写满的连接单独关闭。编码和入队完成后，各会话自己的写协程把帧写到网络。
4. 成功的发送留下短期回执并向发送者入队 ACK。ACK 表示中继接受了请求。断线重试沿用原消息编号。同一序号的重试可再次获得回执。正文只在转发所需的内存中短暂停留。

## 所有权与兼容性

- Hub 拥有房间、成员关系、去重和限速状态。服务层只持有 Peer 并读取其出站队列和关闭信号。断开时交回 Hub 移除成员。定时维护调用 Hub 清理过期记录、获取匿名统计快照。
- protocol 只处理线上表示。业务层决定何时发哪种事件，协议层决定怎样编码。扩展现有命令时，复用这条路径。有具体调用需求时再增加 Go 类型或方法。
- 新成员收到完整状态。已在线且声明支持增量名单的客户端收到成员变更。旧客户端继续收快照和兼容通知。同一广播中需要的旧版快照可在第一次使用时生成并复用。
- 帧的底层字节一旦入队便视为只读。不要在后续广播复用仍可能被网络协程持有的缓冲区。修改这个约定时，除功能测试外应验证每条广播的分配次数、512 人收齐率和尾延迟。

例如调整入房上限，从 [channel.go](../internal/chat/channel.go) 的 join 开始。检查返回的错误码是否沿用现有客户端约定。改变私聊事件的 `to` 字段则从 [events.go](../internal/protocol/events.go) 开始，通过协议测试和浏览器接收逻辑核对。收件人选择在 [send.go](../internal/chat/send.go) 中验证。
