#!/bin/sh
set -eu

if [ -n "${VERSION:-}" ]; then
    printf '%s\n' "$VERSION"
    exit
fi

rev=${1:-HEAD}
if ! hash=$(git rev-parse --short "$rev" 2>/dev/null); then
    printf 'dev\n'
    exit
fi
tag=$(git describe --tags --abbrev=0 "$rev" 2>/dev/null || printf 'untagged')
printf '%s-%s\n' "$tag" "$hash"
