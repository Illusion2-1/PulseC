#!/usr/bin/env bash
# Run from the repository root with CADDY_BIN, PULSEC_BIN, Chrome and qa's npm dependencies.
set -euo pipefail
umask 077
root=$(pwd)
caddy=${CADDY_BIN:-caddy}
relay=${PULSEC_BIN:-"$root/dist/pulsec"}
port=${QA_CADDY_PORT:-18773}
dir=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait || true
  rm -rf "$dir"
}
trap cleanup EXIT
export XDG_DATA_HOME="$dir/data" XDG_CONFIG_HOME="$dir/config" XDG_CACHE_HOME="$dir/cache"
export PULSEC_DOMAIN="127.0.0.1:$port" PULSEC_UPSTREAM="127.0.0.1:$((port+1))"
export PULSEC_UPSTREAM_NAME=pulsec.internal PULSEC_UPSTREAM_CA="$dir/private-ca.crt"
export NO_PROXY='*' no_proxy='*'

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -subj /CN=private-ca -addext basicConstraints=critical,CA:TRUE \
  -keyout "$dir/ca.key" -out "$PULSEC_UPSTREAM_CA" 2>/dev/null
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj /CN=pulsec.internal -keyout "$dir/origin.key" -out "$dir/origin.csr" 2>/dev/null
openssl x509 -req -in "$dir/origin.csr" -CA "$PULSEC_UPSTREAM_CA" -CAkey "$dir/ca.key" \
  -days 1 -out "$dir/origin.crt" -extfile <(echo 'subjectAltName=DNS:pulsec.internal') 2>/dev/null
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -subj /CN=localhost -addext subjectAltName=IP:127.0.0.1 \
  -keyout "$dir/edge.key" -out "$dir/edge.crt" 2>/dev/null
pin=$(openssl x509 -in "$dir/edge.crt" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A)

"$relay" -addr "$PULSEC_UPSTREAM" -cert "$dir/origin.crt" -key "$dir/origin.key" -source-rate 2 >"$dir/origin.log" 2>&1 &
pids+=("$!")
edge() {
  "$caddy" adapt --config deploy/Caddyfile --adapter caddyfile > "$dir/base.json"
  # Keep production routing/transport unchanged. Use loopback and an isolated front certificate.
  python3 - "$dir" <<'PY'
import json,sys
from pathlib import Path
d=Path(sys.argv[1])
cfg=json.loads((d/"base.json").read_text())
cfg["admin"]={"disabled":True}
apps=cfg["apps"]
apps["tls"]={"certificates":{"load_files":[{"certificate":str(d/"edge.crt"),"key":str(d/"edge.key")}]}}
srv=next(iter(apps["http"]["servers"].values()))
srv["listen"]=["127.0.0.1"+srv["listen"][0]]
srv["automatic_https"]={"disable_redirects":True}
(d/"run.json").write_text(json.dumps(cfg))
PY
  "$caddy" run --config "$dir/run.json" > "$dir/caddy.log" 2>&1 &
  edge_pid=$!
  pids+=("$edge_pid")
}
endpoint="https://$PULSEC_DOMAIN"
edge
for i in {1..50}; do
  if curl --max-time 2 --noproxy '*' --cacert "$dir/edge.crt" -fsS "$endpoint/config" >"$dir/client-config" 2>/dev/null; then break; fi
  if ! kill -0 "$edge_pid" 2>/dev/null; then cat "$dir/caddy.log" >&2; exit 1; fi
  sleep .2
done
python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); assert c["pin"] == "" and c["boot"]' "$dir/client-config"
node qa/container.mjs "$endpoint" "$pin"
PULSEC_QA_EDGE="$endpoint" PULSEC_QA_EDGE_DIR="$dir" go test -count=1 -run '^TestProxiedOrigin$' ./qa

kill "$edge_pid"; wait "$edge_pid"
# A listening edge with the wrong upstream CA must reject both HTTP and WebTransport.
export PULSEC_UPSTREAM_CA="$dir/edge.crt"
edge
status=000
for i in {1..40}; do
  status=$(curl --max-time 2 --noproxy '*' --cacert "$dir/edge.crt" -so /dev/null -w '%{http_code}' "$endpoint/config") && break
  sleep .2
done
test "$status" = 502
PULSEC_QA_EDGE="$endpoint" PULSEC_QA_EDGE_DIR="$dir" PULSEC_QA_REJECT=1 go test -count=1 -run '^TestProxiedOrigin$' ./qa
echo 'PASS Caddy verifies the private origin CA for HTTPS and WebTransport'
