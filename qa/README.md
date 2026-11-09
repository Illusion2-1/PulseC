# 运行验收测试

在仓库根目录运行 `make build`。测试使用本地临时服务和合成消息。

| 场景 | 命令 |
|---|---|
| 独立启动与 TLS 证书轮换 | `PULSEC_BIN="$PWD/dist/pulsec" go test -count=1 ./qa -run TestProductionTLSRotation` |
| 反复进出、临时状态过期及日志隐私 | `PULSEC_CHURN_BIN="$PWD/dist/pulsec" go test -timeout=12m -count=1 ./qa -run TestWebTransportChurn` |
| 双语浏览器、弱网、私聊隔离、刷新与重连 | 安装 Chrome 与 Python 3，运行 `npm ci --prefix qa && node qa/browser.mjs`。设置 `ROLLBACK_BIN` 可测试旧服务接管已打开的标签页。 |
| Docker 端口映射后真实收发 | 有 Docker、Compose、OpenSSL 和浏览器测试依赖时运行 `qa/compose.sh`。 |
| 单条广播的开销和分配 | `go test -run '^TestSharedBroadcast$' -bench '^BenchmarkBroadcast$' -benchmem ./internal/chat` |

在 Linux 上比较两个版本的端到端延迟、吞吐和中继 RSS 时，使用同一压测器，从库外指定两份中继。按机器拓扑给两个进程选择不同物理核。

```sh
work=$(mktemp -d)
go build -o "$work/pulsec-load" ./cmd/pulsec-load
python3 qa/compare.py /path/to/baseline /path/to/candidate "$work/pulsec-load" \
  --labels baseline candidate --rooms 1 32 > "$work/comparison.jsonl"
```

脚本交替运行两个版本，并校验确认数、收件人和投递份数。用 `python3 qa/compare.py --help` 查看负载、CPU 绑定和监听端口参数。
