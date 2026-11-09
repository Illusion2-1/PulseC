# 0.1 发布候选的安全检查

2026-11-09 在 Linux amd64 上检查了单文件中继、压测器、浏览器源码、构建/测试依赖和已有 Git 历史。中继侧的输入、身份、权限、资源上界及日志验证另有测试记录。[中继审查与攻击复现](security-relay.md)

| 检查 | 复现与结果 |
|---|---|
| Go 可达漏洞 | Go 1.26.10、govulncheck 1.9.0，对 `./...` 做源码与调用链分析。标准库及第三方依赖中，命中的调用路径 0，受影响的导入包 0。官方漏洞库最后更新于 2026-11-05 23:49:57 UTC，所用数据库归档 SHA-256 为 `0aad3871c535cb19dd5a37f4d0caa6422cc46f6f5d44692125d7e9ed2b56bfc1` |
| Go 静态与依赖检查 | `go mod tidy -diff`、`go mod verify`、vet、golangci-lint 2.11.3（含 gosec）。压测器仅连接 loopback，显式校验证书指纹，G402 例外只匹配该文件。测试通过环境变量选择本机候选程序，相关子进程检查有单行理由 |
| npm | npm 10.9.8 对 web 与 qa 两份锁文件运行 `npm audit --audit-level=high`。web 共报告 5 个 Low 包项，对应下列 3 个独立公告；Moderate、High、Critical 均为 0。qa 共 0 项。两份锁的 128 个 tarball 均指向 npm 公共注册表，并含 SHA-512 完整性值 |
| Git 历史与构建权限 | Gitleaks 8.30.1 检查本地全部 refs 的可达提交，未命中其内置秘密规则。CI 的工作流 token 仅读仓库内容，三个官方 action 均固定为完整 commit SHA，检出凭据不持久化；前端依赖由 npm ci 按锁文件安装 |
| 浏览器入口 | CSP 仅允许同源连接和脚本，构建器为启动脚本添加精确哈希，路由读屏提示的样式属性单独按哈希放行。通过真实 Chrome 在回环页面加入、广播、接收消息，未触发 CSP 违规。中继响应另限制嵌套、Referrer 和内容嗅探 |

## 发现与处置

- **已修复。** 构建依赖 cookie 0.6.0 的序列化器允许非法字符。为 SvelteKit 2.x 锁定 cookie 0.7.2，重新构建并验证嵌入页面、浏览器检查和依赖扫描。跟随 SvelteKit 升级时重新核对覆盖项。[公告](https://github.com/jshttp/cookie/security/advisories/GHSA-pxg6-pf52-xh8x)
- **SvelteKit 的两项低危公告。** 站外重定向需要增强表单提交。PulseC 的入口表单在浏览器内处理。缓存头注入需要部署侧经由相关预渲染响应路径处理不受信输入。发行物从 Go 的 embed FS 读取固定 CSR 入口和静态文件，无 Node.js 应用服务、增强表单或服务端 actions。前端维护者在引入这些功能或升级框架主版本时复核，最迟下次候选发布时重扫。[增强表单公告](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r) · [缓存头公告](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj)
- **deepmerge 的构建期低危公告。** 它由 Vite 的 Svelte 插件合并本地构建配置，运行中的中继和静态页面均不接收可传给该合并器的用户对象。构建负责人在更换插件、允许第三方配置或下次候选发布时复核。仅在信任的检出上运行发行构建。[公告](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
- **Go 的 12 项模块级提示。** 分布在 x/net 的 HTML 与 HTTP/2、x/text 的 PRECIS、x/crypto 的 SSH 与 OpenPGP。按实际导入包和调用链重跑后均不可达。Go 维护者在引入对应包、升级模块或下次候选发布时复核。当前源于标准库的网络调用按实际 Go 补丁版本单独纳入扫描。
- **人工发现。** 已修复临时身份轮换绕过限速、房间和回执表缺少容量限制、部分入口遗漏 Host 校验等问题。详见中继复现报告中的边界与剩余风险。[中继审查](security-relay.md)

## 复扫

在干净检出安装工具后运行 `make check security`。需要复用某次官方漏洞库快照时，解压 `https://vuln.go.dev/vulndb.zip` 到本地目录，通过 `GOVULNDB=file:///绝对路径 make security` 指定，并记录快照的时间及校验和。检测 Fedora Go 的 `-X:nodwarf5` 构建时以同一 Go 补丁号识别标准库。npm 可用 `npm audit --json` 查看直接公告与上游派生项。公网域名、反代、宿主机日志、容器运行环境及证书私钥权限需要部署方另行验证。[部署手册](operations.md)

## 容器产物

Dockerfile 固定两个构建阶段的多架构镜像索引。Node 22.23.1 bookworm-slim 为 `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`，Go 1.26.10 bookworm 为 `sha256:5de7c99eb78ca5e515a4c340235d0955ec5964a5071c492c15503d7c267da473`。两者均已与官方仓库的 tag 元数据核对。维护者应在升级工具链时同步检查新摘要与公告，并重跑源码构建。[Node 官方镜像](https://hub.docker.com/_/node) · [Go 官方镜像](https://hub.docker.com/_/golang)

本机通过 Docker image inspect 和 save 检查了 Linux amd64 候选镜像。运行阶段基于 scratch，镜像的唯一文件系统层只含 0555 模式的 `/pulsec`，以 UID/GID 65532 运行，声明 8443/TCP 与 UDP。已验收文件打包所得镜像中，提取到的可执行文件与本地候选二进制的 SHA-256 相同。可用 `python3 tools/check-image.py 镜像名 [待对照二进制]` 复验。此检查覆盖最终运行层的文件清单和 Go 程序，构建镜像仍要按其各自的更新周期维护。

CI 在每次 PR 校验 Compose 配置。定时和手动检查会分别从源码与现有二进制构建镜像，校验运行层，再通过 Compose 暴露的真实 TCP/UDP 端口，用两个浏览器客户端收发消息。命令见[CI 工作流](../.github/workflows/check.yml)与[发布验证](../qa/README.md)。

## 剥离符号的发行文件

对 RC1 的 `govulncheck -mode=binary` 输出有 12 项 “Symbol Results”。复核使用同一天的数据库、同一 Go 1.26.10 Fedora 工具链和 git 提交 `3bdbb1b53ef124cf74c99a94e45d97b7e388387a`。干净检出的常规构建与受测交付文件逐字节相同，SHA-256 为 `85291bac10b70af76d983d5b75bb886224e4ec5419b44ca86d2ece4f9113d80c`。仅去掉链接器的 `-s -w` 后再次编译，两个 ELF 的可执行代码段 `.text` 也逐字节相同，SHA-256 为 `aa60ef97124876cc8f8310fd923e78127b58c30aea4da932ef1537a3053de382`。

govulncheck 1.9.0 从剥离符号的 ELF 只能提取构建元数据。此时它调用 `allKnownVulnerableSymbols`，把受影响模块公告里的符号列表用作保守估计。保留符号的中继实际得到 **0 个受影响符号、0 个受影响导入包、12 个模块级提示**，与源码扫描一致。[ELF 信息提取实现](https://github.com/golang/vuln/blob/v1.9.0/internal/buildinfo/additions_scan.go#L80-L95) · [二进制扫描回退实现](https://github.com/golang/vuln/blob/v1.9.0/internal/vulncheck/binary.go#L105-L120)

| GO-2026 公告编号 | 发布程序对应的证据 |
|---|---|
| 6866、6860 | `go list -deps .` 与实际符号表均无 `golang.org/x/net/html` |
| 6629 | 发布程序使用 x/text 的双向文本等子包，无 `golang.org/x/text/secure/precis` |
| 6617、6612、6611、6610、6603 | 每条公告分别记录了标准库与外部 x/net 实现。Go 1.26 的 `net/http` 路径修复于 **1.26.9**，实际编译器是 **1.26.10**。符号表有标准库内置的 `net/http.http2…` 与 `golang.org/x/net/http2/hpack` 子包；受影响的外部包 `golang.org/x/net/http2` 本身没有进入发布程序。[Go 漏洞库示例](https://pkg.go.dev/vuln/GO-2026-6617) |
| 6355、6354、6303 | 无 `golang.org/x/crypto/ssh` |
| 5932 | 无 `golang.org/x/crypto/openpgp` 或其子包 |

安装工具并按锁文件完成前端构建后，在同一份源码和静态资源上执行。两个扫描必须使用同一漏洞库 URL 或同一份文件快照。以下命令中的 GNU objcopy 用于复核 Linux ELF 的代码段。升级 Go、QUIC 模块、扫描器或改变导入关系时，应重新执行配对扫描。

```sh
make build
CGO_ENABLED=0 go build -trimpath -buildvcs=false -o dist/pulsec-symbols .
govulncheck -mode=binary -show=verbose dist/pulsec            # 此次保守输出 12 项
govulncheck -mode=binary -show=verbose dist/pulsec-symbols    # 此次符号命中 0 项
CGO_ENABLED=0 go list -deps .
go tool nm dist/pulsec-symbols > dist/symbols.txt
objcopy -O binary --only-section=.text dist/pulsec dist/relay.text
objcopy -O binary --only-section=.text dist/pulsec-symbols dist/with-symbols.text
cmp dist/relay.text dist/with-symbols.text
```
