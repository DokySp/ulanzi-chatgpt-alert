import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { AlertPlugin } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/app.js';
import { ACTION_UUID, USAGE_UUID, UlanziClient, PLUGIN_UUID } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/ulanzi-client.js';
import { pluginRoot } from './helpers.js';

class Host extends EventEmitter {
  frames = [];
  setState(target, state) { this.frames.push({ target, state }); }
  setAnimation(target, gifpath) { this.frames.push({ target, gifpath }); }
}
const key = { uuid: ACTION_UUID, key: 'D200X:test-key:0', actionid: 'instance-42' };

test('accepts Ulanzi action UUID and separate instance ID; pressing the assigned key dismisses', () => {
  const host = new Host();
  const plugin = new AlertPlugin(host, { now: () => 20 });
  host.emit('add', key);
  assert.equal(host.frames.at(-1).state, 0);
  plugin.state.notify({ at: 10, id: 'one' });
  assert.equal(host.frames.at(-1).gifpath, './resources/blink.gif');
  host.emit('run', { ...key, actionid: 'unrelated-instance' });
  assert.equal(plugin.state.pending, true);
  host.emit('run', key);
  assert.equal(host.frames.at(-1).state, 0);
});

test('restored keys receive the pending state, inactive and removed keys receive no blink updates', () => {
  const host = new Host();
  const plugin = new AlertPlugin(host);
  plugin.state.notify({ at: 10, id: 'one' });
  host.emit('setactive', { ...key, active: true });
  assert.equal(host.frames.at(-1).gifpath, './resources/blink.gif');
  host.emit('setactive', { ...key, active: false });
  const count = host.frames.length;
  plugin.state.notify({ at: 11, id: 'two' });
  assert.equal(host.frames.length, count);
  host.emit('setactive', { ...key, active: true });
  assert.equal(host.frames.at(-1).gifpath, './resources/blink.gif');
  host.emit('clear', { param: [key] });
  const removedCount = host.frames.length;
  plugin.state.notify({ at: 12, id: 'three' });
  assert.equal(host.frames.length, removedCount);
  host.emit('add', { ...key, uuid: 'com.ulanzi.other.action' });
  assert.equal(plugin.keys.size, 0);
});

test('manifest exposes the alert and usage actions with present D200X keypad resources', async () => {
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.UUID, PLUGIN_UUID);
  assert.equal(manifest.Actions.length, 2);
  const action = manifest.Actions[0];
  assert.equal(action.UUID, ACTION_UUID);
  assert.equal(manifest.Actions[1].UUID, USAGE_UUID);
  for (const entry of manifest.Actions) {
    assert.deepEqual(entry.Devices, ['D200X']);
    assert.deepEqual(entry.Controllers, ['Keypad']);
    assert.equal(entry.DisableAutomaticStates, true);
  }
  for (const file of [manifest.CodePath, manifest.Icon,
    ...manifest.Actions.flatMap((entry) => [entry.Icon, entry.PropertyInspectorPath,
      ...entry.States.map((state) => state.Image)]), 'resources/blink.gif', 'resources/fade.gif']) {
    await access(path.join(pluginRoot, file));
  }
});

test('restores a saved effect and changes it live without restarting an unchanged animation', () => {
  const host = new Host();
  const plugin = new AlertPlugin(host);
  host.emit('add', { ...key, param: { effect: 'fade' } });
  plugin.state.notify({ at: 10, id: 'first' });
  assert.equal(host.frames.at(-1).gifpath, './resources/fade.gif');
  const count = host.frames.length;
  host.emit('paramfromapp', { ...key, param: { effect: 'fade' } });
  plugin.state.notify({ at: 11, id: 'second' });
  assert.equal(host.frames.length, count);
  host.emit('paramfromplugin', { ...key, param: { effect: 'blink' } });
  assert.equal(host.frames.at(-1).gifpath, './resources/blink.gif');
  plugin.state.setFocus(false, 12);
  plugin.state.setFocus(true, 13);
  assert.equal(host.frames.at(-1).state, 0);
});

test('state packets preserve the physical key and instance ID in the documented Ulanzi envelope', () => {
  const client = new UlanziClient();
  const packets = [];
  client.socket = { readyState: 1, send: (data) => packets.push(JSON.parse(data)) };
  client.setState(key, 2);
  assert.equal(packets[0].uuid, PLUGIN_UUID);
  assert.deepEqual(packets[0].param.statelist[0], {
    ...key, type: 0, state: 2, textData: '', showtext: false
  });
  client.setAnimation(key, './resources/fade.gif');
  assert.deepEqual(packets[1].param.statelist[0], {
    ...key, type: 4, gifpath: './resources/fade.gif', textData: '', showtext: false
  });
  const usageKey = { ...key, uuid: USAGE_UUID };
  client.setImage(usageKey, 'data:image/png;base64,test');
  assert.deepEqual(packets[2].param.statelist[0], {
    ...usageKey, type: 1, data: 'data:image/png;base64,test', textData: '', showtext: false
  });
});
