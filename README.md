# PulseC

匿名、即时的文本聊天室。前端使用 SvelteKit CSR，Go 通过 embed 打包静态资源。浏览器通过一条 WebTransport 双向可靠流交换消息和频道状态。

后端代码的阅读顺序、消息投递路径和开发检查见[架构说明](docs/architecture.md)与[贡献指南](CONTRIBUTING.md)。

## 从源码开始

只修改 Go 中继时，干净检出后运行 `go test -race ./internal/...` 即可验证聊天规则、帧格式和网络边界。构建完整应用需要 Go 1.26.10、Node.js 22.23.1、npm 和 make。

```sh
make build
./dist/pulsec
```

构建后打开 <http://127.0.0.1:8443>。`make test` 运行前端单测和 Go 竞态测试。完整检查和依赖扫描见[贡献指南](CONTRIBUTING.md)及[安全报告](docs/security-review.md)。

发行内容见[变更记录](CHANGELOG.md)，候选的适用范围见[发布验收报告](docs/release-rc1.md)。当前后端与分层前版本的实测对照见[广播性能报告](qa/refactor-performance.md)。

## Docker Compose 部署（首选）

在源码目录或解压后的 Linux amd64 发布包目录执行。先把**浏览器信任**的完整证书链和对应私钥放到专用的 `certs/fullchain.pem`、`certs/privkey.pem`，让容器的补充组有权读取。源码检出可复制 `.env.example` 为 `.env`；发布包自带 `.env`，请保留其中的 artifact 配置，使用验收过的二进制构建离线镜像。

```sh
docker compose config -q
docker compose up -d --build
docker compose logs --tail=10 pulsec
```

在 Linux 上只想先试聊、没有证书时，可用本地覆盖配置：

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

打开 <http://127.0.0.1:8443>。此配置只在宿主机回环监听。公网部署使用上面的主配置。

主配置默认只向主机回环映射 8443/TCP 和 8443/UDP。公网部署在 `.env` 设置 `PULSEC_BIND_IP=0.0.0.0` 并开放这两个端口，然后通过证书对应域名的 HTTPS 地址访问。证书权限、切换到 443、本地证书和版本回退见[部署手册](docs/operations.md)。最终运行镜像采用非 root 用户和只读根文件系统，仅包含 PulseC 可执行文件。

## 直接运行单文件

在 Linux x86-64 上运行 `./dist/pulsec`，然后打开 <http://127.0.0.1:8443>。本机模式使用回环 HTTP 提供页面，自动生成短期 ECDSA 证书并将指纹交给浏览器校验 WebTransport 连接。开发证书有效期为 13 天，可重启进程更新。运行时只需要可执行文件。

公网部署需提供浏览器信任的域名证书和私钥，同一端口允许 TCP 和 UDP 入站。浏览器须支持 HTTP/3 WebTransport。

```sh
./dist/pulsec -addr :443 -cert fullchain.pem -key privkey.pem
```

通过 HTTPS 域名访问。中继必须能直接接收发往该域名和端口的 QUIC 流量。更换证书后重启进程。端口、证书路径等参数可通过 `-help` 查看。

## 频道与身份

- 输入频道名即可加入，也可分享入口地址 `/?ch=频道名`。热门目录按在线连接数排序，最多展示 50 个热门公开频道。本机记住最近 50 个频道名。新建频道时可勾选公开，lobby 始终公开。知道未列出频道的名称即可加入。
- 任何成员可用 `/topic 主题` 修改主题。频道无人时释放成员、主题和 30 个逐分钟活动计数。在线人数按连接统计。活动计数包含公开发言和动作。
- 密码在浏览器内使用 PBKDF2-SHA256（310000 轮，按站点来源加盐）派生凭据。中继从凭据计算 16 位十六进制 trip。相同站点、相同密码可跨设备保持身份。无密码时生成随机凭据。凭据具有登录能力，保存在当前标签页的 sessionStorage 内。
- 输入 `/help` 查看聊天命令。`/w 昵称#完整trip 消息` 可区分同名收件人。私聊由中继定向转发。消息正文按文本渲染，支持代码块、链接、引用和提及。

## 记录与断线

服务端无消息数据库、回放接口或正文日志。实时转发队列有界。重试凭据仅包含短期消息标识、时间和确认号。新加入者从加入时开始接收。

每个标签页按频道缓存最近 500 条已收到的消息或事件。刷新会恢复已加入频道、身份和待发队列。浏览器配额不足时优先淘汰旧记录。`/clear` 清空当前频道的本地记录。关闭标签页后记录的生命周期取决于浏览器的会话恢复行为。

断线后自动退避重连，重新加入频道，再按序发送待发消息（最多 32 条）。每个 trip 共用 6 条 / 10 秒的滑动窗口，触发限速后至少等待 4 秒。尚未确认的投递在同一进程、两分钟内按原 ID 重试并去重。超过该窗口或发现中继重启时，客户端显示原文供用户核对。离线期间其他人发出的消息无法补收。

运行、证书轮换、排障和版本回退见[部署手册](docs/operations.md)。并发对照和浏览器弱网测试见[发布验收](qa/README.md)。

PulseC 使用 [MIT 许可证](LICENSE)。单文件服务内可访问 /LICENSE.txt、/THIRD-PARTY-Go.txt 和 /THIRD-PARTY-Web.txt 查看项目及所含第三方组件的声明。
