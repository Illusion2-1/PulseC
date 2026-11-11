#!/bin/sh
set -eu

version=${VERSION:-}
if [ -z "$version" ]; then
    rev=${1:-HEAD}
    if ! hash=$(git rev-parse --short "$rev" 2>/dev/null); then
        printf 'dev\n'
        exit
    fi
    tag=$(git describe --tags --abbrev=0 "$rev" 2>/dev/null || printf 'untagged')
    version=$tag-$hash
fi
# The same value becomes a linker argument, a CI output and a filename.
case "$version" in
    [!a-zA-Z0-9]*|*[!a-zA-Z0-9._+-]*) echo "Invalid release version" >&2; exit 1 ;;
esac
printf '%s\n' "$version"
