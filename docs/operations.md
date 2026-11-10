# 部署 PulseC

在 Linux 上从源码目录或解压后的发行目录运行以下命令。Compose 需要 2.24.4 或更新版本。下载二进制包后，可先在下载目录运行 `sha256sum --ignore-missing -c SHA256SUMS` 校验归档。解压时保留隐藏文件，编辑已有 `.env` 时保留包内的构建选项。

<a name="caddy"></a>

## 在已有 Caddy 上加一个站点

在 PulseC 的 `.env` 中加入 `PULSEC_BEHIND_PROXY=true`，然后启动中继：

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

PulseC 默认只监听 `127.0.0.1:8443`。如果用 `PULSEC_PORT` 改了端口，同步修改站点块中的上游端口。已有 Caddy 如果运行在独立容器内，再在 `.env` 设置 `PULSEC_LOCAL_NETWORK=container:现有容器名`，让两个进程共用回环接口。该 Caddy 容器重新创建后，也要重新创建 PulseC。

将 `deploy/Caddyfile` 中的站点块加入现有 Caddyfile，把 `chat.example.org` 换成域名。在现有全局选项的 `servers` 块中启用 `webtransport`。使用支持 WebTransport 反代的 Caddy 构建，校验配置后重载现有服务。[Caddy 的 WebTransport 实现](https://github.com/caddyserver/caddy/pull/7669)

```sh
caddy validate --config /etc/caddy/Caddyfile
caddy reload --config /etc/caddy/Caddyfile
```

浏览器使用 Caddy 管理的公网证书。Caddy 到 PulseC 的 WebTransport 回源也使用 QUIC，PulseC 启动时在内存中生成这段连接的证书。示例信任同一台机器上的回环监听者，跳过对这张临时证书的校验。请保留上游的回环地址。同一 Caddy 后的用户共享中继的来源 IP 限额，各 trip 的发言限额独立生效。公网访问日志沿用该 Caddy 实例的设置。

<a name="direct"></a>

## 由 PulseC 直接提供 80/443

把域名解析到主机。开放 TCP 80、TCP 443 和 UDP 443。直出默认监听所有 IPv4 地址，已有 `.env` 中的 `PULSEC_BIND_IP` 会覆盖这个默认值。在 PulseC 的 `.env` 中加入：

```dotenv
PULSEC_DOMAIN=chat.example.org
```

```sh
docker compose -f compose.yaml -f compose.direct.yaml up -d --build
docker compose -f compose.yaml -f compose.direct.yaml logs --tail=20 certbot pulsec
```

此配置使用 Let’s Encrypt 并接受其订户协议，可用 `PULSEC_ACME_EMAIL` 指定账户邮箱。PulseC 在 80 端口提供 HTTP-01 验证文件，Certbot 容器负责首签和定期续期。证书就绪后，PulseC 自动在 443 端口启用 HTTPS 和 WebTransport，以后换证时已有聊天会话可以继续收发。[HTTP-01](https://letsencrypt.org/docs/challenge-types/#http-01-challenge) · [订户协议](https://letsencrypt.org/repository/)

用 `docker compose -f compose.yaml -f compose.direct.yaml exec certbot certbot certificates` 查看证书有效期。升级或重建容器时沿用 Compose 项目名并保留命名卷，Certbot 可复用原账户和证书。TCP 80 在续期时仍需可达。签发失败时检查 Certbot 日志、域名公布的 A/AAAA 地址和防火墙。修复后可以重启 `certbot` 服务立即重试。

## 其他启动方式

- **本机试聊**使用 `docker compose -f compose.yaml -f compose.local.yaml up -d --build`，以默认的本机模式打开 <http://127.0.0.1:8443>。
- **自备证书**使用基础 `compose.yaml`。在 `.env` 中设置 `PULSEC_CERT_DIR` 和能读取私钥的 `PULSEC_TLS_GID`，提供 `fullchain.pem` 和 `privkey.pem`。设置 `PULSEC_BIND_IP=0.0.0.0`、`PULSEC_PORT=443` 可对公网开放。更换证书对后运行 `docker compose kill -s HUP pulsec`。
- **直接运行二进制**可用 `./pulsec -behind-proxy` 接入同机 Caddy。自备证书时可用 `./pulsec -addr :443 -cert fullchain.pem -key privkey.pem`。运行账号需有监听相应端口和读取所选文件的权限。其他选项见 `./pulsec -help`，systemd 单元示例在 `deploy/pulsec.service`。

## 验收与回退

用两个浏览器打开同一频道，互发一条消息。页面正常但无法进房时，检查公网 UDP 443。使用 Caddy 时也检查回环上游地址和 Caddy 的 WebTransport 配置。

升级时保留上一版目录、镜像及配置，按版本设置 `PULSEC_IMAGE`。回退时切回旧目录，用相同的项目名和 `-f` 参数运行 `up -d --no-build --force-recreate`，再从已有标签页和新标签页验证收发。
