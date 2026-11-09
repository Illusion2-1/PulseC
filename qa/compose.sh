#!/bin/sh
# Run from repo root, after npm ci --prefix qa. PULSEC_TARGET defaults to source.
set -eu
dir=$(mktemp -d)
export COMPOSE_PROJECT_NAME=pulsec-qa-$$
export PULSEC_CERT_DIR="$dir/tls" PULSEC_TLS_GID="$(id -g)" PULSEC_BIND_IP=127.0.0.1
export PULSEC_PORT=${QA_COMPOSE_PORT:-18661} PULSEC_IMAGE=pulsec-qa:local-$$
compose() { docker compose -f compose.yaml "$@"; }
cleanup() {
    compose down --timeout 5 >/dev/null 2>&1 || :
    docker image rm "$PULSEC_IMAGE" >/dev/null 2>&1 || :
    rm -rf "$dir"
}
trap cleanup EXIT
mkdir -m 750 "$PULSEC_CERT_DIR"
openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -days 1 -subj /CN=localhost -addext subjectAltName=IP:127.0.0.1 \
    -keyout "$PULSEC_CERT_DIR/privkey.pem" -out "$PULSEC_CERT_DIR/fullchain.pem" 2>/dev/null
chmod 640 "$PULSEC_CERT_DIR/privkey.pem"
pin=$(openssl x509 -in "$PULSEC_CERT_DIR/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A)
compose config -q
compose up --build --pull never -d
origin=https://127.0.0.1:$PULSEC_PORT
curl --retry 8 --retry-connrefused --max-time 15 --noproxy '*' --cacert "$PULSEC_CERT_DIR/fullchain.pem" -fsS "$origin/config" > "$dir/config"
python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); assert c["pin"] == "" and c["boot"]' "$dir/config"
node qa/container.mjs "$origin" "$pin"
