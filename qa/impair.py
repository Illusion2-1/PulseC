"""Test-only loopback proxy. Delay/loss apply independently to UDP in either direction."""
import argparse
import asyncio
import random

parser = argparse.ArgumentParser()
parser.add_argument("listen", type=int)
parser.add_argument("upstream", type=int)
parser.add_argument("--block", action="store_true", help="drop all UDP, keep serving HTTP")
args = parser.parse_args()
upstream = ("127.0.0.1", args.upstream)
rng = random.Random(132)


def forward(send, *values):
    if not args.block and rng.random() >= 0.03:
        asyncio.get_running_loop().call_later(.09 + rng.uniform(-.01, .01), send, *values)


class Reply(asyncio.DatagramProtocol):
    def __init__(self, send):
        self.send = send

    def datagram_received(self, data, _addr):
        self.send(data)


class Link(asyncio.DatagramProtocol):
    def __init__(self):
        self.routes = {}

    def connection_made(self, transport):
        self.port = transport

    def datagram_received(self, data, addr):
        if args.block:
            return
        if addr not in self.routes:
            self.routes[addr] = None
            asyncio.create_task(self.open(data, addr))
        elif self.routes[addr] is not None:
            forward(self.routes[addr].sendto, data)

    async def open(self, data, addr):
        t, _ = await asyncio.get_running_loop().create_datagram_endpoint(
            lambda: Reply(lambda reply: forward(self.port.sendto, reply, addr)),
            remote_addr=upstream,
        )
        self.routes[addr] = t
        forward(t.sendto, data)


async def tcp(reader, writer):
    remote_reader, remote_writer = await asyncio.open_connection(*upstream)

    async def copy(r, w):
        try:
            while data := await r.read(65536):
                w.write(data)
                await w.drain()
        finally:
            w.close()

    await asyncio.gather(copy(reader, remote_writer), copy(remote_reader, writer), return_exceptions=True)


async def main():
    loop = asyncio.get_running_loop()
    await loop.create_datagram_endpoint(Link, local_addr=("127.0.0.1", args.listen))
    async with await asyncio.start_server(tcp, "127.0.0.1", args.listen) as server:
        await server.serve_forever()


asyncio.run(main())
