# 部署 PulseC

## 用 Docker Compose 运行

源码目录默认构建前端和 Go 中继。二进制发行包的 `.env` 选择 `artifact`，Compose 直接使用包内的 Linux 可执行文件构建镜像。使用发行包前，在下载目录运行 `sha256sum --ignore-missing -c SHA256SUMS`，核对所选归档显示 OK。解压时保留隐藏文件。

**Linux 本机试聊**使用回环监听和自动生成的短期证书。

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

打开 <http://127.0.0.1:8443>。停止时运行同样的 `-f` 组合并把 `up -d --build` 换为 `down`。

**使用域名**时，将浏览器信任的证书链和对应私钥复制到专用目录，分别命名为 `fullchain.pem` 和 `privkey.pem`。在 `.env` 中设置以下变量，保留发行包已有的构建配置。

| 变量 | 用途 |
|---|---|
| `PULSEC_BIND_IP` | 公网 IPv4 监听填 `0.0.0.0`。默认仅映射到宿主机回环。 |
| `PULSEC_PORT` | 对外端口，例如 `443`。防火墙需同时开放该端口的 TCP 和 UDP。 |
| `PULSEC_CERT_DIR` | 专用证书目录，在容器中只读挂载为 `/tls`。SELinux 主机会为此目录设置容器私有标签。 |
| `PULSEC_TLS_GID` | 宿主机证书读权限对应的数值组 ID。该组需要遍历目录并读取两个文件。 |

```sh
docker compose -p pulsec config -q
docker compose -p pulsec up -d --build
docker compose -p pulsec logs --tail=10 pulsec
```

通过证书对应的 HTTPS 域名访问。页面和 WebTransport 必须使用同一个对外主机和端口。用两个浏览器进入同一频道，互发消息验证整条路径。

## 直接运行单文件

`./pulsec` 启动本机回环模式。公网运行时指定证书和私钥：

```sh
./pulsec -addr :8443 -cert fullchain.pem -key privkey.pem
```

发行包和源码树均包含 `deploy/pulsec.service`，可按安装目录和证书路径调整后用于 systemd。运行 `./pulsec -help` 查看可用参数和默认值。

## 排障、升级和回退

- 页面打不开时查 DNS、TCP 和证书链。页面可打开但无法进房时，查浏览器的 WebTransport 支持、UDP 转发和中继接入限额。
- `-stats-interval` 启用连接、频道、拒绝、限速及慢连接断开等聚合计数。共享 NAT 下多人共用来源额度，调整 `-source-rate` 前先检查限速计数。宿主机与代理的日志策略由部署方配置。
- 升级时保留上一版目录、镜像及配置，给每个版本设置独立的 `PULSEC_IMAGE`。在新目录使用相同的 Compose 项目名启动。回退时切回旧目录，运行 `docker compose -p pulsec up -d --no-build --force-recreate`。从已打开的标签页和新标签页分别确认能进房并收发消息。
- 在同一证书挂载目录内换好匹配的证书链和私钥后，运行 `docker compose -p pulsec restart pulsec`。挂载路径发生变化时重新创建容器。中继重启会释放频道与临时回执，客户端会对投递结果未知的消息提示核对。
