#!/usr/bin/env python3
"""Tag HEAD with the next patch in VERSION's major.minor series."""

import pathlib
import re
import subprocess
import sys


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def main():
    version = pathlib.Path("VERSION").read_text().strip()
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        sys.exit("VERSION must contain major.minor (for example, 0.1)")
    pattern = re.compile(r"refs/tags/v" + re.escape(version) + r"\.(0|[1-9][0-9]*)")
    sha = git("rev-parse", "HEAD")
    for _ in range(10):
        patches = []
        existing = []
        for line in git("ls-remote", "--tags", "--refs", "origin").splitlines():
            target, ref = line.split()
            match = pattern.fullmatch(ref)
            if match:
                patch = int(match[1])
                patches.append(patch)
                if target == sha:
                    existing.append(patch)
        # A rerun must reuse this commit's tag, even after later releases.
        if existing:
            print(f"v{version}.{max(existing)}")
            return
        tag = f"v{version}.{max(patches, default=0) + 1}"
        # Creating a ref is atomic; a competing run forces a fresh lookup.
        result = subprocess.run(
            ["git", "push", "origin", f"{sha}:refs/tags/{tag}"], stdout=sys.stderr
        )
        if result.returncode == 0:
            print(tag)
            return
    sys.exit("Could not create a release tag after 10 attempts")


if __name__ == "__main__":
    main()
