#!/bin/sh
# Build only the named Git commit; working tree files are never packaged.
set -eu
rev=$(git rev-parse --verify "${1:-HEAD}^{commit}")
out=$(pwd)/dist/release
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/src"
git archive -o "$work/source.tar" "$rev"
tar -xf "$work/source.tar" -C "$work/src"
cd "$work/src"
make build
version=$(./dist/pulsec -version | cut -d' ' -f2)
platform=$(go env GOOS)-$(go env GOARCH)
name=pulsec-$version-$platform
mkdir "$work/$name"
cp dist/pulsec LICENSE "$work/$name/"
cp web/build/THIRD-PARTY-*.txt "$work/$name/"
mkdir -p "$work/$name/docs" "$work/$name/deploy" "$work/$name/qa"
cp docs/operations.md "$work/$name/docs/"
cp deploy/pulsec.service "$work/$name/deploy/"
cp qa/README.md "$work/$name/qa/"
printf '%s\n' "$rev" > "$work/$name/SOURCE_COMMIT"
go version -m dist/pulsec | sed '1s/^dist\///' > "$work/$name/GO-BUILD.txt"
python3 scripts/go-notices.py > "$work/go-notices.txt"
cmp "$work/go-notices.txt" web/build/THIRD-PARTY-Go.txt
cmp LICENSE web/build/LICENSE.txt
test -s web/build/THIRD-PARTY-Web.txt
# GNU tar and gzip with stable member ordering, permissions, timestamps and headers.
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 --mode='u+rwX,go+rX,go-w' -C "$work" -cf "$work/package.tar" "$name"
gzip -n -9 "$work/package.tar"
cp "$work/package.tar.gz" "$out/$name.tar.gz"
cp dist/pulsec "$out/pulsec"
cd "$out"
sha256sum "$name.tar.gz" pulsec > SHA256SUMS
sha256sum -c SHA256SUMS
