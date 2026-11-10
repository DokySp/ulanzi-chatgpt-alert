import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginRoot } from './helpers.js';

test('settings page restores the saved mode and asks the host to persist the selected mode', async () => {
  const source = await readFile(path.join(pluginRoot, 'property-inspector', 'inspector.js'), 'utf8');
  const listeners = {};
  const select = { disabled: true, value: 'blink', addEventListener: (name, fn) => { listeners[name] = fn; } };
  let socket;
  class Socket {
    readyState = 1;
    sent = [];
    handlers = {};
    constructor() { socket = this; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    send(data) { this.sent.push(JSON.parse(data)); }
  }
  const target = { uuid: 'com.ulanzi.ulanzistudio.chatgptalert.alert', key: '1_0', actionid: 'saved-instance' };
  vm.runInNewContext(source, {
    location: { search: '?' + new URLSearchParams(target).toString() },
    URLSearchParams, WebSocket: Socket, document: { getElementById: () => select }
  });
  socket.handlers.open();
  assert.equal(socket.sent[0].uuid, target.uuid);
  socket.handlers.message({ data: JSON.stringify({
    ...target, cmd: 'paramfromapp', param: { effect: 'fade', preserved: 'value' }
  }) });
  assert.equal(select.disabled, false);
  assert.equal(select.value, 'fade');
  select.value = 'blink';
  listeners.change();
  assert.deepEqual(socket.sent.at(-1), {
    ...target, cmd: 'paramfromplugin', param: { effect: 'blink', preserved: 'value' }
  });
  socket.handlers.close();
  assert.equal(select.disabled, true);
});

function gifFrames(data) {
  assert.equal(data.subarray(0, 6).toString(), 'GIF89a');
  assert.equal(data.readUInt16LE(6), 196);
  assert.equal(data.readUInt16LE(8), 196);
  assert.ok(data.includes(Buffer.from('NETSCAPE2.0')));
  const frames = [];
  let offset = 13;
  let delay = 0;
  if (data[10] & 128) offset += 3 * 2 ** ((data[10] & 7) + 1);
  while (data[offset] !== 59) {
    const tag = data[offset++];
    if (tag === 33) {
      const label = data[offset++];
      if (label === 249) delay = data.readUInt16LE(offset + 2);
      while (data[offset]) offset += 1 + data[offset];
      offset++;
    } else {
      assert.equal(tag, 44);
      const packed = data[offset + 8];
      offset += 9;
      assert.ok(packed & 128);
      const size = 3 * 2 ** ((packed & 7) + 1);
      const palette = data.subarray(offset, offset + size);
      frames.push({ delay, light: palette.reduce((sum, value) => sum + value, 0) });
      offset += size + 1;
      while (data[offset]) offset += 1 + data[offset];
      offset++;
    }
  }
  return frames;
}

test('GIFs loop and contain distinct blink frames and a steadily darkening fade', async () => {
  const blink = gifFrames(await readFile(path.join(pluginRoot, 'resources', 'blink.gif')));
  assert.equal(blink.length, 2);
  assert.deepEqual(blink.map((frame) => frame.delay), [50, 50]);
  assert.ok(blink[0].light > 0);
  assert.equal(blink[1].light, 0);
  const fade = gifFrames(await readFile(path.join(pluginRoot, 'resources', 'fade.gif')));
  assert.equal(fade.length, 21);
  for (let index = 1; index < fade.length; index++) assert.ok(fade[index].light < fade[index - 1].light);
  assert.equal(fade.at(-1).light, 0);
  assert.equal(fade.at(-1).delay, 50);
});
