# 发布验收

测试只启动本机子进程，使用合成身份和消息，不需要公网地址。先在项目根目录构建候选文件。浏览器和压测请错开机器上的大规模编译任务。

- **证书轮换与独立启动**：`PULSEC_BIN="$PWD/dist/pulsec" go test -count=1 -v ./qa`。在空工作目录和空工具搜索路径下启动两次服务，以各自的信任根校验 HTTPS 和真实 WebTransport；替换证书后旧根必须失效。
- **真实浏览器、弱网与回退**：安装 Chrome、Node 和 Python 3，运行 `npm ci --prefix qa`，再运行 `node qa/browser.mjs`。默认用本机 Chrome；可通过绝对路径 `CHROME_BIN` 或 `PULSEC_BIN` 指定其他 Chrome/候选文件。使用 `ROLLBACK_BIN=/绝对路径/上一个版本 node qa/browser.mjs` 增加旧进程接管已打开标签页的回退测试。默认占用回环端口 18487 到 18489，可设置 QA_PORT 改变起始端口。UDP 双向各 3% 随机丢包、每方向约 90 ms 延迟，另有完全阻断 UDP 的用例；普通 HTTP 页面仍可打开。
- **Docker Compose**：需 Docker Engine、Compose、Chrome、OpenSSL 和已安装的 QA 依赖，运行 `qa/compose.sh`。这会临时创建专用测试证书，在真实映射的 TCP 和 UDP 端口上收发消息，再删除本次容器与网络；为本次 QA Chrome 进程启用 WebTransport 本地开发模式，只信任测试证书的公钥指纹；不会改主机或浏览器的持久信任库。要测已验收的 Linux 文件，使用 `PULSEC_TARGET=artifact qa/compose.sh`（要求 dist/release/pulsec 已存在）。
- **性能对照**：Linux 机器需有 taskset。执行 `go build -trimpath -o /tmp/pulsec-load ./cmd/pulsec-load`，然后 `python3 qa/compare.py /绝对路径/m0 ./dist/pulsec /tmp/pulsec-load > comparison.jsonl`。默认两个独立进程各用四个物理核（0–3 和 4–7，按机器拓扑修改），512 人，1 和 32 频道，每秒 24 人入场、128 条原创消息/s、30 秒聊天窗口。各跑三轮，轮间反转版本先后，输出逐轮二进制哈希、端侧投递延迟/吞吐、应用层入场字节和服务端每 50 ms 采样的稳态峰值 RSS。英文字段 SetupMiB 不含 TLS/QUIC 包头。P99 是写流到各客户端读完整消息的端到端延迟，不含界面渲染。

浏览器的私聊隔离与无历史断言用另一条公开消息作屏障，不凭“短时间没看见”判断通过。实验只说明本机候选满足所列条件，不能代替实际域名、证书链、防火墙和运营商网络的外部验证。
