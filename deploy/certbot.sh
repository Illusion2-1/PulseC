#!/bin/sh
# Run in the official Certbot container. Only the served PEM leaves its private state volume.
set -eu
: "${PULSEC_DOMAIN:?Set PULSEC_DOMAIN}"
live=/etc/letsencrypt/live/$PULSEC_DOMAIN
umask 077
publish() (
    tmp=$(mktemp /tls/.site.XXXXXXXX) || exit 1
    trap 'rm -f "$tmp"' EXIT
    cat "$live/fullchain.pem" "$live/privkey.pem" > "$tmp" || exit 1
    if cmp -s "$tmp" /tls/site.pem && [ "$(stat -c '%a:%g' /tls/site.pem)" = 640:65532 ]; then
        exit 0
    fi
    python -c 'import ssl, sys; ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER).load_cert_chain(sys.argv[1])' "$tmp" &&
        chgrp 65532 "$tmp" && chmod 0640 "$tmp" && mv -f "$tmp" /tls/site.pem
)

# Recover a lost publication volume on startup even while the CA is unreachable.
if [ -f "$live/fullchain.pem" ]; then publish || echo "Could not restore TLS certificate" >&2; fi
if [ -n "${PULSEC_ACME_EMAIL:-}" ]; then
    set -- "$@" --email "$PULSEC_ACME_EMAIL"
else
    set -- "$@" --register-unsafely-without-email
fi

trap 'exit 0' TERM INT
retry=300
while :; do
    if certbot certonly --webroot -w /acme -d "$PULSEC_DOMAIN" --cert-name "$PULSEC_DOMAIN" \
            --non-interactive --agree-tos --keep-until-expiring "$@" && publish; then
        delay=43200
        retry=300
    else
        delay=$retry
        retry=$((retry * 2))
        if [ "$retry" -gt 21600 ]; then retry=21600; fi
        echo "Certificate check failed; retrying in $delay seconds" >&2
    fi
    sleep "$delay" & wait "$!"
done
