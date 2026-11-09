"""Verify the Linux release image contains only its executable; optionally compare it."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

image = sys.argv[1]
metadata, = json.loads(subprocess.check_output(["docker", "image", "inspect", image]))
config = metadata["Config"]
if (config["User"] != "65532:65532" or config["Entrypoint"] != ["/pulsec"]
        or set(config["ExposedPorts"]) != {"8443/tcp", "8443/udp"}
        or len(metadata["RootFS"]["Layers"]) != 1):
    raise SystemExit("unexpected image user, entrypoint, ports, or filesystem layer count")

with tempfile.TemporaryFile() as archive:
    subprocess.run(["docker", "image", "save", image], stdout=archive, check=True)
    archive.seek(0)
    with tarfile.open(fileobj=archive) as saved:
        manifests = json.load(saved.extractfile("manifest.json"))
        manifest, = (m for m in manifests if m["RepoTags"])
        layer, = manifest["Layers"]
        with tarfile.open(fileobj=saved.extractfile(layer), mode="r|*") as rootfs:
            entry = rootfs.next()
            if not entry or entry.name != "pulsec" or not entry.isfile() or entry.mode != 0o555:
                raise SystemExit("expected /pulsec with file mode 0555")
            binary_hash = hashlib.file_digest(rootfs.extractfile(entry), "sha256").hexdigest()
            if rootfs.next():
                raise SystemExit("unexpected extra file in the runtime image")

if len(sys.argv) == 3:
    with Path(sys.argv[2]).open("rb") as expected:
        if hashlib.file_digest(expected, "sha256").hexdigest() != binary_hash:
            raise SystemExit("container binary differs from the supplied release file")
print(f"{image}: /pulsec sha256={binary_hash}, one file, non-root, TCP+UDP")
