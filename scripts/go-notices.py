#!/usr/bin/env python3
"""Collect license files along paths of packages compiled into the relay."""
import json
import os
from pathlib import Path
import subprocess
import sys

def go(*args):
    return subprocess.check_output(["go", *args], env={**os.environ, "CGO_ENABLED": "0"}, text=True)

root = Path(go("env", "GOROOT").strip())
seen = {}
sources = go("list", "-deps", "-json", ".")
decoder = json.JSONDecoder()
while sources.strip():
    pkg, end = decoder.raw_decode(sources.lstrip())
    sources = sources.lstrip()[end:]
    mod = pkg.get("Module", {})
    if mod.get("Main"):
        continue
    base = root if pkg.get("Standard") else Path(mod["Dir"])
    label = "Go" if pkg.get("Standard") else mod["Path"] + "@" + mod["Version"]
    directory = Path(pkg["Dir"])
    for parent in (directory, *directory.parents):
        for f in parent.iterdir():
            if f.is_file() and f.name.upper().split(".")[0] in ("LICENSE", "LICENCE", "COPYING", "NOTICE", "PATENTS"):
                seen[label + "/" + str(f.relative_to(base))] = f.read_text().strip()
        if parent == base:
            break
    if base == root and "Go/LICENSE" not in seen:
        # Fedora installs the Go license separately from GOROOT.
        system = Path("/usr/share/licenses/golang")
        for name in ("LICENSE", "PATENTS"):
            if (system / name).exists():
                seen["Go/" + name] = (system / name).read_text().strip()
    if not any(key.startswith(label + "/") for key in seen):
        sys.exit(f"No license found for {label}")
print("Third-party notices for Go code compiled into PulseC")
for label, text in sorted(seen.items()):
    print("\n" + label + "\n\n" + text)
