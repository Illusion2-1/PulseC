# PulseC

PulseC 是匿名文本聊天室。它用 WebTransport 在浏览器与 Go 中继之间收发消息，SvelteKit 页面随中继编译成单个可执行文件。服务端只转发消息，标签页用会话存储保留自己收到的记录。

## 本机试聊

在 Linux 上，从源码目录或解压后的二进制发行目录运行：

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

打开 <http://127.0.0.1:8443>。公网部署使用主 Compose 配置、域名证书及同端口的 TCP 和 UDP。[部署与回退](docs/operations.md)

## 从源码开发

准备 Go、Node.js、npm、Python 3 和 make。Go 版本要求见 [go.mod](go.mod)，完整构建使用的工具链见 [Dockerfile](Dockerfile)。

```sh
go test -race ./internal/...
make build
./dist/pulsec
```

第一条命令单独验证 Go 后端。完整的开发检查、协议约定及测试入口见[贡献指南](CONTRIBUTING.md)、[后端架构](docs/architecture.md)和[中继协议](docs/protocol.md)。

## 使用聊天室

- **频道**可以通过 `/?ch=频道名` 分享。公开频道显示在热门目录中，知道未列出频道名称的人也能加入。成员可用 `/topic` 改主题，最后一人离开时中继释放频道状态。
- **身份**由昵称和 trip 组成。昵称可以重名，同一站点使用同一密码会得到相同的 trip。用 `/w 昵称#完整trip 消息` 指定私聊对象。私聊由中继转发，中继可见正文。
- **本地记录**按标签页和频道保存，刷新可恢复已收消息。`/clear` 清空当前频道记录，`/forget` 清理本机聊天数据。浏览器的会话恢复功能会影响关闭标签页后的保留时间。
- **断线**后客户端会重连并处理待发队列。投递结果未知时会提示核对原文，离线期间未收到的消息无法补收。在聊天框输入 `/help` 查看命令。

PulseC 使用 [MIT 许可证](LICENSE)。运行中的服务在 `/LICENSE.txt`、`/THIRD-PARTY-Go.txt` 和 `/THIRD-PARTY-Web.txt` 提供许可声明。
