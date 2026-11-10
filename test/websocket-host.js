import http from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

// A local fake Studio host exercises the real native WebSocket transport.
export async function websocketHost(t) {
  const host = new EventEmitter();
  host.messages = [];
  host.sockets = new Set();
  const server = http.createServer();
  const frame = (opcode, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
    header[0] = 0x80 | opcode;
    header[1] = payload.length < 126 ? payload.length : 126;
    if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  };
  host.send = (message) => host.socket.write(frame(1, Buffer.from(JSON.stringify(message))));
  server.on('upgrade', (request, socket, head) => {
    const accept = createHash('sha1')
      .update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
      + 'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    host.socket = socket;
    host.sockets.add(socket);
    socket.on('close', () => {
      host.sockets.delete(socket);
      host.emit('closed');
    });
    socket.on('error', () => {});
    let pending = head;
    const consume = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 15;
        const masked = (pending[1] & 128) !== 0;
        let length = pending[1] & 127;
        let offset = 2;
        if (length === 126) {
          if (pending.length < 4) return;
          length = pending.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (pending.length < 10) return;
          length = Number(pending.readBigUInt64BE(2));
          offset = 10;
        }
        const maskBytes = masked ? 4 : 0;
        if (pending.length < offset + maskBytes + length) return;
        const mask = pending.subarray(offset, offset + maskBytes);
        const payload = Buffer.from(pending.subarray(offset + maskBytes, offset + maskBytes + length));
        if (masked) {
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        pending = pending.subarray(offset + maskBytes + length);
        if (opcode === 8) {
          socket.end(frame(8, payload));
          return;
        }
        if (opcode === 9) socket.write(frame(10, payload));
        if (opcode === 1) {
          host.messages.push(JSON.parse(payload.toString()));
          host.emit('message');
        }
      }
    };
    socket.on('data', consume);
    if (head.length) consume(Buffer.alloc(0));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  host.port = server.address().port;
  t.after(async () => {
    for (const socket of host.sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return host;
}
