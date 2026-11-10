import { EventEmitter } from 'node:events';

export const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.chatgptalert';
export const ACTION_UUID = PLUGIN_UUID + '.alert';

export function keyIdentity(target) {
  return JSON.stringify([target.uuid, target.key, target.actionid]);
}

// Message envelopes follow UlanziTechnology/plugin-common-node's public protocol.
// The transport uses Node's built-in WebSocket; no npm packages are required.
export class UlanziClient extends EventEmitter {
  constructor({ address = '127.0.0.1', port = 3906, WebSocketImpl = globalThis.WebSocket } = {}) {
    super();
    this.url = 'ws://' + address + ':' + port;
    this.WebSocketImpl = WebSocketImpl;
    this.stopped = false;
  }

  connect() {
    this.socket = new this.WebSocketImpl(this.url);
    this.socket.addEventListener('open', () => {
      this.send({ cmd: 'connected', uuid: PLUGIN_UUID, code: 0 });
      this.emit('connected');
    });
    this.socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (!message || typeof message !== 'object' || !message.cmd) return;
      if (message.code !== undefined && message.cmdType !== 'REQUEST') return;
      this.send({ ...message, code: 0 });
      this.emit(message.cmd, message);
    });
    this.socket.addEventListener('error', () => {
      this.emit('connection-error', new Error('Cannot connect to Ulanzi Studio'));
    });
    this.socket.addEventListener('close', () => {
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), 1000);
    });
  }

  send(message) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  setState(target, state) {
    this.setDisplay(target, { type: 0, state });
  }

  setAnimation(target, gifpath) {
    this.setDisplay(target, { type: 4, gifpath });
  }

  setDisplay(target, display) {
    this.send({
      cmd: 'state',
      uuid: PLUGIN_UUID,
      key: target.key,
      actionid: target.actionid,
      param: {
        statelist: [{
          uuid: target.uuid,
          key: target.key,
          actionid: target.actionid,
          ...display,
          textData: '',
          showtext: false
        }]
      }
    });
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
  }
}
