"""Check the standalone binary can serve its embedded UI and a real broadcast."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import ProxyHandler, build_opener

relay, load = (str(Path(arg).resolve()) for arg in sys.argv[1:])
fetch = build_opener(ProxyHandler({})).open
with socket.socket() as pick:
    pick.bind(("127.0.0.1", 0))
    address = "127.0.0.1:%d" % pick.getsockname()[1]

with tempfile.TemporaryDirectory() as empty:
    proc = subprocess.Popen([relay, "-addr", address], cwd=empty)
    try:
        for _ in range(100):
            if proc.poll() is not None:
                raise RuntimeError("relay exited during startup")
            try:
                with fetch("http://" + address + "/config", timeout=1) as response:
                    assert json.load(response)["pin"]
                break
            except OSError:
                time.sleep(0.05)
        else:
            raise TimeoutError("relay failed readiness check")

        with fetch("http://" + address, timeout=2) as response:
            if b"<script" not in response.read():
                raise ValueError("missing embedded UI")
        subprocess.run([load, "-addr", address, "-clients", "4", "-rooms", "2",
                        "-rate", "4", "-seconds", "1"], check=True, timeout=30)
    finally:
        proc.terminate()
        proc.wait(timeout=10)
