#!/bin/sh
set -eu

script=$(pwd)/scripts/version.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
unset VERSION
cd "$work"
test "$(sh "$script")" = dev
test "$(VERSION=custom sh "$script")" = custom

git init -q
git config user.name 'Version Test'
git config user.email 'version@example.invalid'
git -c commit.gpgsign=false commit -q --allow-empty -m first
first=$(git rev-parse --short HEAD)
test "$(sh "$script")" = "untagged-$first"
git tag v1.0.0
git -c commit.gpgsign=false commit -q --allow-empty -m second
second=$(git rev-parse --short HEAD)
test "$(sh "$script")" = "v1.0.0-$second"
git tag v1.1.0
test "$(sh "$script")" = "v1.1.0-$second"
test "$(sh "$script" HEAD~1)" = "v1.0.0-$first"
test "$(VERSION=custom sh "$script")" = custom
printf 'Version checks passed\n'
