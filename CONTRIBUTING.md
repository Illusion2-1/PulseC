# 贡献指南

从干净检出开始。构建使用的 Go 和 Node.js 工具链见 Dockerfile。工作树根目录运行 `make tools` 安装固定版本的 golangci-lint、govulncheck 和 Gitleaks 到 dist/tools，也可以在 PATH 中提供这些版本。生产机器只需要发行包的 PulseC 可执行文件。

| 命令 | 用途 |
|---|---|
| `make build` | 按锁文件安装前端依赖、生成 CSR 静态资源，构建嵌入资源的 Go 二进制 |
| `make check` | 前端格式、静态检查与单测，Go 格式、race、vet 与 golangci-lint，最后在临时空目录启动真实中继并校验 WebTransport 投递 |
| `make security` | 校验 Go 模块、按调用链查 Go 漏洞、审计前端与测试依赖、检查全部本地 Git 历史中的敏感信息 |
| `make test` | 运行前端单测及 Go race 测试 |

## 修改后端

命令校验与房间权限放在 chat，线上字段与兼容文案放在 protocol，套接字、超时与连接终止放在 server。使用具体类型与函数，只暴露调用方实际需要的操作。按功能组织文件，导出方法的注释说明所有权、并发约定或返回值含义。[架构说明](docs/architecture.md)

- 修改**协议或身份规则**时，用回归测试复现行为变化。涉及线上格式时更新协议说明和对应样例，验证新旧客户端能混用。使用合成身份。私聊用例必须包含一个不应收到消息的第三方。
- 修改**广播或队列**时，检查慢收件人、共享帧只读和去重回执。保留改动前的二进制，用同一压测器及机器交错比较单频道和分散频道。报告应投与实投、P99、入场字节和中继稳态 RSS，并注明并发数和实际环境。[复测步骤](qa/README.md)
- 准备**提交和 PR** 时，每笔提交对应一个可独立验证的行为或边界变化。PR 写明改变的入口、受影响的调用方、运行过的命令和剩余限制。架构变动同步更新阅读入口，性能数据在 PR 中注明所测二进制摘要。

## 修改前端

web/src/lib 按依赖方向分层：`features → chat → platform / i18n → core`，config.ts 和 types.ts 可被任意层引用。core 只放纯函数（身份、文本、时间线、名单、正文解析），platform 封装 WebTransport 与 Web Storage，i18n 持有文案与当前语言。chat 是应用状态：ChatClient 组合各部分并暴露操作，协议事件在 events.ts 逐个处理，斜杠命令在 commands.ts 注册（键顺序即补全顺序），发送队列在 outbox。features 下的组件通过 `useChat()` 读取同一个客户端，不经 props 层层传递。组件一律用 runes 与 TypeScript；样式在 styles 下按区域拆分，index.css 的导入顺序就是层叠顺序。

| 改什么 | 从哪里开始 | 可以单独跑的检查 |
|---|---|---|
| 新的服务端事件或字段 | types.ts 的 `ServerEvent`，再在 [events.ts](web/src/lib/chat/events.ts) 加处理函数 | `npm test --prefix web` |
| 新的斜杠命令 | [commands.ts](web/src/lib/chat/commands.ts) 加一项，返回值决定保留草稿还是发送 | 同上，用 test/helpers.ts 的假中继 |
| 新的界面区域 | features 下新建组件或目录，状态放进 chat 层 | `npm run check --prefix web` |

客户端行为用 test/helpers.ts 的 `signedIn()` 驱动真实 ChatClient 和假中继验证。改动 DOM 结构或 class 时同时核对 qa/browser.mjs 使用的选择器。

仓库文档只记录可由当前实现核对的行为、约定和操作步骤。压测原始数据、机器配置、扫描快照、阶段进度和版本验收记录放在仓库外。尚无明确结论的观察留在调查中。

凭据、真实聊天内容、个人环境文件及临时产物均留在仓库外。

工具升级时同时校验 npm 锁文件、Go 校验和、CI 固定引用及构建、扫描实际结果。生成文件可通过静态构建重建。复查一次 `git diff --cached` 后，仅把所实现功能的文件提交到版本库。安全问题按私下报告流程处理。[安全报告与响应](SECURITY.md)
