// Each attempt owns its stream and timers. A retired session cannot write into its successor.
export function connect({ status, opened, received, heartbeat }) {
  let active,
    timer,
    stopped = false,
    delay = 500;
  const encoder = new TextEncoder();
  async function attempt() {
    if (stopped) return;
    if (!window.WebTransport) {
      status("此浏览器无法使用 WebTransport");
      return;
    }
    let transport, timeout, pulse, writer;
    const token = {};
    active = token;
    status("正在连接");
    function fail() {
      try {
        transport?.close();
      } catch {}
    }
    try {
      const response = await fetch("/config", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error();
      const { pin, boot } = await response.json();
      if (stopped) return;
      const options = pin
        ? {
            serverCertificateHashes: [
              {
                algorithm: "sha-256",
                value: Uint8Array.from(atob(pin), (c) => c.charCodeAt(0)),
              },
            ],
          }
        : {};
      transport = new WebTransport(
        "https://" + location.host + "/connect",
        options,
      );
      token.close = fail;
      transport.closed.catch(() => {});
      timeout = setTimeout(fail, 12000);
      await transport.ready;
      const stream = await transport.createBidirectionalStream();
      writer = stream.writable.getWriter();
      const reader = stream.readable
        .pipeThrough(new TextDecoderStream())
        .getReader();
      clearTimeout(timeout);
      let last = Date.now();
      token.send = (cmd) =>
        writer.write(encoder.encode(JSON.stringify(cmd) + "\n")).catch(fail);
      opened(boot);
      status("已连接");
      pulse = setInterval(() => {
        if (Date.now() - last > 45000) fail();
        else heartbeat();
      }, 10000);
      let buf = "";
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let pos;
        while ((pos = buf.indexOf("\n")) >= 0) {
          last = Date.now();
          delay = 500;
          received(JSON.parse(buf.slice(0, pos)));
          buf = buf.slice(pos + 1);
        }
      }
    } catch {
    } finally {
      clearTimeout(timeout);
      clearInterval(pulse);
      active = null;
      fail();
      if (!stopped) {
        status("断线 · 正在重连");
        timer = setTimeout(attempt, delay * (0.8 + Math.random() * 0.4));
        delay = Math.min(delay * 2, 15000);
      }
    }
  }
  attempt();
  return {
    send(cmd) {
      active?.send?.(cmd);
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      active?.close?.();
    },
  };
}
