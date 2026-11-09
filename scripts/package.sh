#!/bin/sh
# Build only the named Git commit; working tree files are never packaged.
set -eu
rev=$(git rev-parse --verify "${1:-HEAD}^{commit}")
out=$(pwd)/dist/release
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/src"
git archive --prefix=pulsec/ -o "$work/source.tar" "$rev"
tar -xf "$work/source.tar" --strip-components=1 -C "$work/src"
cd "$work/src"
make build
version=$(./dist/pulsec -version | cut -d' ' -f2)
platform=$(go env GOOS)-$(go env GOARCH)
name=pulsec-$version-$platform
mkdir "$work/$name"
cp dist/pulsec LICENSE Dockerfile compose.yaml compose.local.yaml compose.direct.yaml compose.caddy.yaml .dockerignore .env.example "$work/$name/"
printf 'PULSEC_TARGET=artifact\nPULSEC_BINARY=pulsec\n' > "$work/$name/.env"
cp web/build/THIRD-PARTY-*.txt "$work/$name/"
mkdir -p "$work/$name/deploy"
cp deploy/pulsec.service deploy/certbot-deploy deploy/Caddyfile deploy/Dockerfile.caddy deploy/Dockerfile.caddy.dockerignore "$work/$name/deploy/"
cp docs/operations.md "$work/$name/README.md"
printf '%s\n' "$rev" > "$work/$name/SOURCE_COMMIT"
go version -m dist/pulsec | sed '1s/^dist\///' > "$work/$name/GO-BUILD.txt"
test -s web/build/THIRD-PARTY-Go.txt
cmp LICENSE web/build/LICENSE.txt
test -s web/build/THIRD-PARTY-Web.txt
# GNU tar and gzip with stable member ordering, permissions, timestamps and headers.
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 --mode='u+rwX,go+rX,go-w' -C "$work" -cf "$work/package.tar" "$name"
gzip -n -9 "$work/package.tar"
cp "$work/package.tar.gz" "$out/$name.tar.gz"
cp dist/pulsec "$out/pulsec"
gzip -n -9 -c "$work/source.tar" > "$out/pulsec-$version-source.tar.gz"
cd "$out"
sha256sum "pulsec-$version-source.tar.gz" "$name.tar.gz" pulsec > SHA256SUMS
sha256sum -c SHA256SUMS
