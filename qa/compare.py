"""Linux release gate: compare two local relay executables using one load generator."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument("baseline", type=Path)
ap.add_argument("candidate", type=Path)
ap.add_argument("load", type=Path)
ap.add_argument("--labels", nargs=2, default=("m0", "rc"), metavar=("BASELINE", "CANDIDATE"),
                help="names written into each result row (default: m0 rc)")
ap.add_argument("--rooms", type=int, nargs="+", default=[1, 32])
ap.add_argument("--clients", type=int, default=512)
ap.add_argument("--seconds", type=int, default=30)
ap.add_argument("--rate", type=int, default=128)
ap.add_argument("--join-rate", type=int, default=24)
ap.add_argument("--rounds", type=int, default=3)
ap.add_argument("--port", type=int, default=18509)
ap.add_argument("--server-cpus", default="0-3")
ap.add_argument("--load-cpus", default="4-7")
args = ap.parse_args()
addr = f"127.0.0.1:{args.port}"
load_hash = hashlib.sha256(args.load.read_bytes()).hexdigest()


def mem(pid, key):
    for ln in Path(f"/proc/{pid}/status").read_text().splitlines():
        if ln.startswith(key + ":"):
            return int(ln.split()[1]) / 1024
    raise RuntimeError("no process memory metric")


def run(label, binary, rooms, rep):
    server = subprocess.Popen(["taskset", "-c", args.server_cpus, binary.resolve(), "-addr", addr],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError("server failed at startup")
            try:
                with urllib.request.urlopen(f"http://{addr}/config", timeout=.4):
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError("server not ready")
        with tempfile.TemporaryFile() as log:
            command = ["taskset", "-c", args.load_cpus, args.load.resolve(), "-addr", addr,
                       "-clients", str(args.clients), "-rooms", str(rooms), "-rate", str(args.rate),
                       "-join-rate", str(args.join_rate), "-seconds", str(args.seconds)]
            proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log)
            peak = 0
            joined = False
            deadline = time.monotonic() + 120 + args.seconds + args.clients / args.join_rate
            try:
                while proc.poll() is None:
                    if time.monotonic() > deadline:
                        raise TimeoutError("load failed to finish")
                    joined = joined or b"joined\n" in os.pread(log.fileno(), 4096, 0)
                    if joined:
                        peak = max(peak, mem(server.pid, "VmRSS"))
                    time.sleep(.05)
                out, _ = proc.communicate()
                if not out:
                    raise RuntimeError(os.pread(log.fileno(), 4096, 0).decode())
                data = json.loads(out)
                data.update(label=label, round=rep, peak_RSS_MiB=peak, sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
                            load_sha256=load_hash, rate=args.rate, join_rate=args.join_rate, seconds=args.seconds,
                            server_cpus=args.server_cpus, load_cpus=args.load_cpus, returncode=proc.returncode)
                print(json.dumps(data), flush=True)
                if proc.returncode or not joined or data["Ack"] != args.rate * args.seconds or data["Delivered"] != data["Expected"]:
                    raise RuntimeError("incomplete or invalid deliveries")
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
    finally:
        server.terminate()
        server.wait()


for rep in range(1, args.rounds + 1):
    pair = [(args.labels[0], args.baseline), (args.labels[1], args.candidate)]
    for rooms in args.rooms:
        for name, exe in (pair if rep % 2 else reversed(pair)):
            run(name, exe, rooms, rep)
