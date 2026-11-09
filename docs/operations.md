# 部署 PulseC

| 部署方式 | 公网 TCP 80 | 公网 TCP 443 / UDP 443 | 公网证书 |
|---|---|---|---|
| PulseC 直出 | PulseC 提供 HTTP-01 文件、跳转到 HTTPS | PulseC 提供页面和 WebTransport | Certbot 签发，PulseC 加载 |
| Caddy 反代 | Caddy 处理 ACME 和跳转 | Caddy 终止 TLS，代理页面和 WebTransport | Caddy 自动签发、续期 |

两种方式各用一份 Compose 覆盖文件。下例使用 Linux、Docker Compose 2.24.4 或更新版本，部署目录为 `/opt/pulsec/current`。将 `chat.example.org` 换成实际域名，让公布的 A/AAAA 地址都能到达所选入口，开放 TCP 80、TCP 443 和 UDP 443。

源码检出会构建前端和 Go 中继。使用二进制发行包时，先在下载目录运行 `sha256sum --ignore-missing -c SHA256SUMS`，核对所选归档显示 OK。解压时保留隐藏文件，下面的变量追加或更新到已有 `.env`，保留发行包中的 `PULSEC_TARGET` 和 `PULSEC_BINARY`。

<a name="direct"></a>

## PulseC 直出与 Let's Encrypt 文件验证

PulseC 可以从空证书目录启动。它先在 80 端口响应 `/.well-known/acme-challenge/<token>`。Certbot 将签发结果部署到证书目录并发出 SIGHUP 后，PulseC 开始在 443 端口接受 HTTPS 和 WebTransport 连接。以后每次续期复用同一套流程。[HTTP-01 验证](https://letsencrypt.org/docs/challenge-types/#http-01-challenge) · [Certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot)

在部署目录的 `.env` 中设置：

```dotenv
PULSEC_DOMAIN=chat.example.org
PULSEC_BIND_IP=0.0.0.0
PULSEC_CERT_DIR=/etc/pulsec/tls
PULSEC_TLS_GID=65532
PULSEC_WEBROOT=/var/lib/pulsec/acme
```

在宿主机安装 Certbot、OpenSSL 和 flock。用 root 创建目录并启动 PulseC。容器以只读方式挂载两个目录，Certbot 在宿主机写验证文件。

```sh
cd /opt/pulsec/current
install -d -m 0755 /var/lib/pulsec/acme
install -d -m 0750 -g 65532 /etc/pulsec/tls
docker compose -p pulsec -f compose.yaml -f compose.direct.yaml up -d --build
```

将下面的脚本保存为 `/usr/local/sbin/pulsec-renew`，设置为 root 所有、权限 0755。部署目录、脚本和 Compose 配置也由 root 管理。钩子检查证书和私钥是否匹配，成对发布到专用目录，再通知中继。

```sh
#!/bin/sh
set -eu
cd /opt/pulsec/current
exec ./deploy/certbot-deploy /etc/pulsec/tls 65532 \
  docker compose -p pulsec -f compose.yaml -f compose.direct.yaml kill -s HUP pulsec
```

首次签发时将钩子绑定到这张证书。之后由安装 Certbot 时提供的定时任务运行 `certbot renew`。如果安装方式没有提供定时任务，在宿主机定时运行该命令。保留 TCP 80 和验证目录供续期使用。

```sh
certbot certonly --webroot -w /var/lib/pulsec/acme \
  --cert-name chat.example.org -d chat.example.org \
  --deploy-hook /usr/local/sbin/pulsec-renew
certbot renew --cert-name chat.example.org --dry-run --run-deploy-hooks
```

用 `certbot certificates` 查看有效期。部署钩子报错时，修复原因后可运行 `RENEWED_LINEAGE=/etc/letsencrypt/live/chat.example.org /usr/local/sbin/pulsec-renew` 重新应用现有证书。检查中继日志和 `https://chat.example.org/config`，再用两个浏览器进同一频道互发消息。正常续期保留已有聊天会话。[Certbot 续期和钩子](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)

<a name="caddy"></a>

## Caddy 反代

Caddy 在公网接收 HTTPS 和 WebTransport，再通过内部网络上的 HTTP/3 连接 PulseC。公共证书和 ACME 账户保存在 Caddy 的数据卷中。PulseC 只持有上游证书，Compose 将它放在专用网络上，宿主机没有映射到 PulseC 的端口。

`deploy/Caddyfile` 使用 Caddy 的 `webtransport` 和 `reverse_proxy`。`deploy/Dockerfile.caddy` 固定了带有这项实验性功能的上游源码版本。自备 Caddy 时，用同一构建或支持该指令的版本，通过 `caddy validate --config /etc/caddy/Caddyfile` 校验配置。[Caddy 上游实现](https://github.com/caddyserver/caddy/pull/7669)

**准备内部证书。** 如果有内部 CA，用它为 `pulsec.internal` 签发服务器证书即可。下面是新建私有 CA 和第一张上游证书的完整示例，需要 OpenSSL 3，以 root 运行。CA 私钥留在宿主机。将 CA 证书提供给 Caddy，用它校验上游身份。PulseC 加载服务器证书和对应私钥。

```sh
umask 077
install -d -m 0700 /etc/pulsec/ca
install -d -m 0750 -g 65532 /etc/pulsec/origin
cd /etc/pulsec/ca
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc \
  -days 3650 -subj '/CN=PulseC origin CA' -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign' -keyout ca.key -out ca.crt
install -m 0644 ca.crt /etc/pulsec/origin-ca.crt
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc \
  -subj '/CN=pulsec.internal' -addext 'subjectAltName=DNS:pulsec.internal' \
  -addext 'extendedKeyUsage=serverAuth' -keyout /etc/pulsec/origin/privkey.pem -out origin.csr
openssl x509 -req -in origin.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -copy_extensions copy -days 365 -out /etc/pulsec/origin/fullchain.pem
chgrp 65532 /etc/pulsec/origin/*.pem
chmod 0640 /etc/pulsec/origin/*.pem
```

在部署目录的 `.env` 中设置：

```dotenv
PULSEC_DOMAIN=chat.example.org
PULSEC_BIND_IP=0.0.0.0
PULSEC_CERT_DIR=/etc/pulsec/origin
PULSEC_TLS_GID=65532
PULSEC_UPSTREAM_CA=/etc/pulsec/origin-ca.crt
```

```sh
cd /opt/pulsec/current
docker compose -p pulsec -f compose.yaml -f compose.caddy.yaml up -d --build
docker compose -p pulsec -f compose.yaml -f compose.caddy.yaml ps
```

公网签发和续期由 Caddy 处理。内部证书到期前，用同一内部 CA 签发新证书，将匹配的证书和私钥安装到原目录，保持上述权限，然后运行 `docker compose -p pulsec -f compose.yaml -f compose.caddy.yaml kill -s HUP pulsec`。备份 Caddy 数据卷和内部 CA 私钥。

使用已有的 Caddy 实例时，将站点和全局 `webtransport` 设置合入现有 Caddyfile，配置 `PULSEC_DOMAIN`、`PULSEC_UPSTREAM`（中继私网地址和端口）、`PULSEC_UPSTREAM_NAME`（上游证书 DNS 名）及 `PULSEC_UPSTREAM_CA`（Caddy 可读的 CA 证书路径）。在网络层只允许该 Caddy 访问上游。中继按它实际看到的 QUIC 对端实施来源限速，同一 Caddy 下的用户共用该来源额度，每个 trip 还有独立额度。

## 本机试聊、自备证书和单文件运行

- **Linux 本机试聊**可运行 `docker compose -f compose.yaml -f compose.local.yaml up -d --build`，打开 <http://127.0.0.1:8443>。中继使用临时证书。
- **已有公网证书**可直接使用主 `compose.yaml`。在 `.env` 设置 `PULSEC_CERT_DIR`、`PULSEC_TLS_GID`、`PULSEC_BIND_IP` 和 `PULSEC_PORT=443`。提供 `fullchain.pem` 和 `privkey.pem`，运行 `docker compose -p pulsec up -d --build`。更换证书对后运行 `docker compose -p pulsec kill -s HUP pulsec`。
- **直接运行二进制**时，`./pulsec` 可启动本机试聊。下例提供与直出模式相同的文件验证。运行账号需有监听低端口、读取证书和验证文件的权限。使用 `deploy/pulsec.service` 时，将下列参数写入 `ExecStart`，按需要添加 `AmbientCapabilities=CAP_NET_BIND_SERVICE`。首次签发及续期钩子的最后一条命令改为 `systemctl reload pulsec`，组 ID 改为 pulsec 服务可读的组。

```sh
./pulsec -addr :443 -http-addr :80 -public-host chat.example.org \
  -acme-webroot /var/lib/pulsec/acme \
  -cert /etc/pulsec/tls/fullchain.pem -key /etc/pulsec/tls/privkey.pem
```

## 排障、升级和回退

- 页面打不开时查 DNS、TCP 和证书链。页面可打开但无法进房时，查浏览器的 WebTransport 支持、UDP 443 和中继接入限额。反代模式还要检查 Caddy 到上游的 UDP 连通性和证书信任。
- `-stats-interval` 启用连接、频道、拒绝、限速及慢连接断开等聚合计数。调整 `-source-rate` 前先检查限速计数。宿主机与代理的日志策略由部署方配置。
- 升级时保留上一版目录、镜像及配置，为每个版本设置独立的 `PULSEC_IMAGE`。保留同一 Compose 项目名、配置文件组合和持久卷。回退时切回旧目录，用相同的 `-p` 和 `-f` 参数运行 `up -d --no-build --force-recreate`。从已打开的标签页和新标签页分别确认能进房并收发消息。
