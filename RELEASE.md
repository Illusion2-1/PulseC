# PulseC · Linux amd64 发布包

此目录已含通过验收的可执行文件。Docker 不需要从源码构建，也不需要下载运行时基础镜像。保留包内的隐藏文件 `.env` 与 `.dockerignore`；将下载的 tar.gz 和可信渠道取得的 SHA256SUMS 放在同一目录，运行 `sha256sum --ignore-missing -c SHA256SUMS` 并确认目标 tar.gz 显示 OK，再解包。

**Linux 本机试聊**（Docker Engine、支持 `!reset` 的 Compose）：

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

打开 <http://127.0.0.1:8443>。停止时使用相同配置运行 `docker compose -f compose.yaml -f compose.local.yaml down`。或直接在本机运行 `./pulsec`，无需 Docker。

**使用域名运行**：把受信任的完整证书链和私钥放入专用目录，设定文件组权限，在现有 `.env` 里追加 PULSEC_CERT_DIR、PULSEC_TLS_GID、PULSEC_BIND_IP 和 PULSEC_PORT。不要覆盖已有的 artifact / pulsec 两项。运行 `docker compose config -q && docker compose up -d --build`，确保所选端口的 TCP 和 UDP 都可到达。

部署、回退和公网验收见 [docs/operations.md](docs/operations.md)。版本和测试边界见 [docs/release-rc1.md](docs/release-rc1.md)。当前 Go 后端的压测证据见 [qa/refactor-performance.md](qa/refactor-performance.md)。运行镜像只有 PulseC 程序，使用非 root 身份。没有需要备份或迁移的聊天数据库。
