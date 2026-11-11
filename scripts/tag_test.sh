#!/bin/sh
set -eu

script=$(pwd)/scripts/tag.py
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q --bare "$work/remote.git"
git init -q "$work/repo"
cd "$work/repo"
git config user.name 'Tag Test'
git config user.email 'tag@example.invalid'
git remote add origin "$work/remote.git"
printf '0.1\n' > VERSION
git add VERSION
git -c commit.gpgsign=false commit -qm first
git tag v0.1
git tag v0.1.0-rc.1
git push -q origin --tags
test "$(python3 "$script")" = v0.1.1
test "$(python3 "$script")" = v0.1.1
git -c commit.gpgsign=false commit -q --allow-empty -m second
test "$(python3 "$script")" = v0.1.2
git tag v0.1.9
git tag v0.1.10
git push -q origin --tags
git -c commit.gpgsign=false commit -q --allow-empty -m third
test "$(python3 "$script")" = v0.1.11

# Two simultaneous main pushes must get distinct patch numbers.
for name in a b; do
    git clone -q --no-checkout "$work/repo" "$work/$name"
    (
        cd "$work/$name"
        git checkout -q --detach origin/HEAD
        git remote set-url origin "$work/remote.git"
        git -c user.name='Tag Test' -c user.email='tag@example.invalid' \
            -c commit.gpgsign=false commit -q --allow-empty -m "$name"
        python3 "$script" > "$work/$name.tag"
    ) &
    if [ "$name" = a ]; then first_pid=$!; else second_pid=$!; fi
done
wait "$first_pid"
wait "$second_pid"
test "$(cat "$work/a.tag" "$work/b.tag" | sort -V)" = "$(printf 'v0.1.12\nv0.1.13')"

git checkout -q HEAD~2
test "$(python3 "$script")" = v0.1.1
printf '1.0\n' > VERSION
test "$(python3 "$script")" = v1.0.1
printf 'invalid\n' > VERSION
if python3 "$script" >/dev/null 2>&1; then exit 1; fi
printf 'Tag checks passed\n'
