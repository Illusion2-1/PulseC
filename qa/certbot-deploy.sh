#!/bin/sh
# Exercise the real deploy hook with disposable keys; no listeners or ACME account needed.
set -eu
umask 077
hook=$(cd -- "$(dirname -- "$0")/../deploy" && pwd)/certbot-deploy
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
cd "$tmp"
gid=$(id -g)
if [ "$(id -u)" -eq 0 ]; then gid=65532; fi
issue() {
    mkdir "$1"
    openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -noenc \
        -days 1 -subj "/CN=$1.test" -keyout "$1/privkey.pem" -out "$1/fullchain.pem" 2>/dev/null
}
issue one
issue two
mkdir mixed
cp one/privkey.pem two/fullchain.pem mixed/
cat > notify <<'EOF'
#!/bin/sh
set -eu
# A service launched by this hook must not inherit fd 9 or the publisher's lock.
test ! -e /proc/self/fd/9
printf '%s\n' "$1" >> invoked
if [ -f fail-next ]; then rm fail-next; exit 1; fi
EOF
chmod +x notify
deploy() { RENEWED_LINEAGE="$tmp/$1" "$hook" "$tmp/tls" "$gid" ./notify "$1"; }
bad() { if "$@"; then echo "unexpected success: $*" >&2; exit 1; fi; }

# The first valid pair remains available when its first notification fails.
touch fail-next; bad deploy one
cmp one/fullchain.pem tls/fullchain.pem
cmp one/privkey.pem tls/privkey.pem
first=$(readlink tls/current)
chmod 0600 tls/privkey.pem
deploy one
test "$(readlink tls/current)" = "$first"
test "$(wc -l < invoked)" -eq 2
test "$(stat -Lc '%a:%g' tls)" = "750:$gid"
test "$(stat -Lc '%a:%g' tls/current)" = "750:$gid"
test "$(stat -Lc '%a:%g' tls/privkey.pem)" = "640:$gid"

# A publication succeeds independently of its notification. Replaying the same
# lineage retries it without changing current or discarding the previous valid pair.
touch fail-next; bad deploy two
second=$(readlink tls/current)
test "$second" != "$first"
cmp two/fullchain.pem tls/fullchain.pem
cmp two/privkey.pem tls/privkey.pem
test "$(wc -l < invoked)" -eq 3
deploy two
test "$(readlink tls/current)" = "$second"
bad deploy mixed
cmp two/fullchain.pem tls/fullchain.pem
cmp two/privkey.pem tls/privkey.pem
cmp one/fullchain.pem "tls/$first/fullchain.pem"
cmp one/privkey.pem "tls/$first/privkey.pem"
test "$(wc -l < invoked)" -eq 4
test -z "$(find tls -name '.certbot.*' -print -quit)"

if [ "$(id -u)" -eq 0 ]; then
    chmod 0711 "$tmp"
    setpriv --reuid=65534 --regid="$gid" --clear-groups test -r tls/privkey.pem
    setpriv --reuid=65534 --regid=65534 --clear-groups test ! -r tls/privkey.pem
fi

# A directory managed by hand must not be converted implicitly.
mkdir manual
cp one/privkey.pem manual/privkey.pem
bad env RENEWED_LINEAGE="$tmp/two" "$hook" "$tmp/manual" "$gid"
cmp one/privkey.pem manual/privkey.pem
test ! -e manual/current
test "$(stat -c '%a' manual)" = 700
echo "PASS publication, consumer permissions, failed-pair isolation, notification failure and retry"
