#!/usr/bin/env bash
# Run from the repository root with CADDY_BIN, PULSEC_BIN, Chrome and qa's npm dependencies.
set -euo pipefail
umask 077
caddy=${CADDY_BIN:-caddy}
relay=$(realpath "${PULSEC_BIN:-dist/pulsec}")
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
export NO_PROXY='*' no_proxy='*'

# Only the operator's front end needs a certificate. Start PulseC in a completely empty directory.
mkdir "$dir/relay"
(cd "$dir/relay" && exec "$relay" -behind-proxy -addr "127.0.0.1:$((port+1))" -source-rate 2) > "$dir/origin.log" 2>&1 &
pids+=("$!")
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -subj /CN=existing.example.test -addext subjectAltName=DNS:existing.example.test,IP:127.0.0.1 \
  -keyout "$dir/edge.key" -out "$dir/edge.crt" 2>/dev/null
pin=$(openssl x509 -in "$dir/edge.crt" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A)

# Bring up the operator's existing site first. Isolate the admin socket and listeners.
cat > "$dir/Caddyfile" <<CFG
{
	admin unix/$dir/admin.sock
	auto_https disable_redirects
	default_bind 127.0.0.1
	grace_period 2s
	servers {
		webtransport
	}
}

https://existing.example.test:$port {
	tls $dir/edge.crt $dir/edge.key
	respond "existing-site"
}
CFG
"$caddy" run --config "$dir/Caddyfile" --adapter caddyfile > "$dir/caddy.log" 2>&1 &
pids+=("$!")
existing() {
  curl -fsS --max-time 2 --cacert "$dir/edge.crt" --resolve "existing.example.test:$port:127.0.0.1" "https://existing.example.test:$port/"
}
for _ in {1..50}; do
  if [[ $(existing 2>/dev/null) == existing-site ]]; then break; fi
  sleep .2
done
[[ $(existing) == existing-site ]]

# The test substitutes only its site address and port numbers into the shipped example.
sed -e "s/^chat\.example\.org {/https:\/\/127.0.0.1:$port {/" \
    -e "s/127\.0\.0\.1:8443/127.0.0.1:$((port+1))/" deploy/Caddyfile > "$dir/chat.caddy"
printf '\nimport chat.caddy\n' >> "$dir/Caddyfile"
"$caddy" reload --config "$dir/Caddyfile" --adapter caddyfile
endpoint="https://127.0.0.1:$port"
curl -fsS --max-time 5 --cacert "$dir/edge.crt" "$endpoint/config" > "$dir/client-config"
python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); assert not c.get("pin") and c["boot"]' "$dir/client-config"
node qa/container.mjs "$endpoint" "$pin"
PULSEC_QA_EDGE="$endpoint" PULSEC_QA_EDGE_DIR="$dir" go test -count=1 -run '^TestProxiedOrigin$' ./qa
[[ $(existing) == existing-site ]]
[[ -z $(ls -A "$dir/relay") ]]
echo 'PASS imported PulseC site preserves existing site, serves public config, and needs no private origin files'
