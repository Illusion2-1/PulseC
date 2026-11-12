# PulseC

**English** · [简体中文](README.zh-CN.md)

[![Build status](https://github.com/Illusion2-1/PulseC/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/Illusion2-1/PulseC/actions/workflows/check.yml)
[![Docker pulls](https://img.shields.io/docker/pulls/illusionn21/pulsec?logo=docker&logoColor=white)](https://hub.docker.com/r/illusionn21/pulsec)
[![MIT license](https://img.shields.io/badge/License-MIT-397254)](LICENSE)
![Go version](https://img.shields.io/github/go-mod/go-version/Illusion2-1/PulseC?logo=go&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![WebTransport over HTTP/3](https://img.shields.io/badge/WebTransport-HTTP%2F3-7A5524)
![LaTeX with KaTeX](https://img.shields.io/badge/LaTeX-KaTeX-16645B)

PulseC is a self-hosted platform for anonymous chat in your browser. Open a channel link, pick a nickname, and start talking. No account needed.

The server can read the messages it forwards, including private replies. It keeps no chat history. Your tab remembers recent messages across refreshes. People who join later see only new messages.

## Preview

![Desktop chat with LaTeX and JavaScript syntax highlighting](docs/chat.en.png)

<p>
  <a href="docs/soundcheck.en.png"><img src="docs/soundcheck.en.png" width="69%" alt="Aligned equations and highlighted Python"></a>
  <a href="docs/mobile.en.png"><img src="docs/mobile.en.png" width="28%" alt="Mobile chat with mentions and private replies"></a>
</p>

![With 512 clients on one machine, 99% of deliveries took up to 13.34 ms in a single channel or 0.76 ms when split across 32 channels. Median of three runs per layout.](docs/latency.en.png)

## Try it locally

On Linux with Docker Compose 2.24.4 or newer, run this from the project directory. If you unpacked the binary release, you can also start the server with `./pulsec`.

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --no-build
```

1. Open [the lobby](http://127.0.0.1:8443/?ch=lobby) in a browser that supports WebTransport, such as Chrome.
2. Pick a nickname, leave the password blank, and click `/join #lobby`.
3. Open the same link in a second tab and join under another name. Send a message with **Enter** and watch it appear in both tabs. Type `/help` for chat commands.

Try `$x^2$` inside a sentence or `$$x^2$$` on its own line for a larger formula. For highlighted code, start a line with `` ```python ``, paste your code on the following lines, and close with three backticks. Use **Shift+Enter** for line breaks.

## Host a room for others

<p align="center"><img src="docs/server-warning.en.svg" width="536" alt="Do not share sensitive information on a untrusted server."></p>

Point your domain at a Linux server and open TCP ports 80 and 443 and UDP port 443. Add `PULSEC_DOMAIN=chat.example.org` to the project's `.env` file, using your own domain. Then run the command below. The included Certbot service obtains and renews the HTTPS certificate.

```sh
docker compose -f compose.yaml -f compose.direct.yaml up -d --no-build
```

When the certificate is ready, create or join a channel and copy the link from your address bar to invite others, for example `https://chat.example.org/?ch=lobby`. The address updates when you switch channels.

Already running Caddy on the host? With a Caddy build that supports WebTransport proxying, set `PULSEC_BEHIND_PROXY=true` in `.env`, run the local Compose command above, and follow the [Caddyfile example](deploy/Caddyfile).

[MIT License](LICENSE)
