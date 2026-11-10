import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { AlertPlugin } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/app.js';
import { UlanziClient, ACTION_UUID, PLUGIN_UUID } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/ulanzi-client.js';
import { LogWatcher } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/log-watcher.js';
import { websocketHost } from './websocket-host.js';
import { notification, tempDirectory, until, pluginRoot } from './helpers.js';

const key = { uuid: ACTION_UUID, key: 'D200X:test-key:0', actionid: 'instance-42' };

test('real WebSocket carries log-triggered blinking and both dismissal paths', async (t) => {
  const host = await websocketHost(t);
  const root = await tempDirectory(t);
  const client = new UlanziClient({ port: host.port });
  let now = 1000;
  const plugin = new AlertPlugin(client, { now: () => now });
  plugin.state.setFocus(false, now);
  const watcher = new LogWatcher({
    root, now: () => now, intervalMs: 60000,
    onNotification: (event) => plugin.state.notify(event)
  });
  t.after(() => { watcher.stop(); client.close(); });
  await watcher.start();
  client.connect();
  await until(() => host.messages.some((packet) => packet.cmd === 'connected'));
  assert.equal(host.messages[0].uuid, PLUGIN_UUID);
  host.send({ ...key, cmd: 'add', cmdType: 'REQUEST' });
  const frames = () => host.messages.filter((packet) => packet.cmd === 'state')
    .map((packet) => {
      const item = packet.param.statelist[0];
      return item.type === 4 ? item.gifpath : 'idle';
    });
  await until(() => frames().length === 1);
  const log = path.join(root, 'codex-desktop-live.log');
  await appendFile(log, notification(1100, 'completed'));
  await watcher.poll();
  await until(() => frames().at(-1) === './resources/blink.gif');
  now = 1200;
  host.send({ ...key, cmd: 'run', cmdType: 'REQUEST' });
  await until(() => frames().at(-1) === 'idle');
  await appendFile(log, notification(1300, 'question', 'question'));
  await watcher.poll();
  await until(() => frames().at(-1) === './resources/blink.gif');
  host.send({ ...key, cmd: 'paramfromplugin', param: { effect: 'fade' } });
  await until(() => frames().at(-1) === './resources/fade.gif');
  plugin.state.setFocus(true, 1400);
  await until(() => frames().at(-1) === 'idle');
  await appendFile(log, notification(1350, 'late-question', 'question'));
  await watcher.poll();
  assert.equal(plugin.state.pending, false);
  assert.deepEqual(frames(), ['idle', './resources/blink.gif', 'idle',
    './resources/blink.gif', './resources/fade.gif', 'idle']);
  const disconnected = once(client.socket, 'close');
  client.close();
  await disconnected;
});

const studioNode = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Ulanzi Studio', 'nodejs', 'node.exe');

test('complete plugin starts with Ulanzi Studio Node 20 and shuts down its worker with the launcher',
  { skip: process.platform !== 'win32' || !existsSync(studioNode), timeout: 20000 }, async (t) => {
    const host = await websocketHost(t);
    const child = spawn(studioNode,
      [path.join(pluginRoot, 'plugin', 'bootstrap.js'), '127.0.0.1', String(host.port), 'ko-KR', '3.4.8'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    t.after(() => child.kill());
    await until(() => stdout.includes('[ChatGPT alert] ready') || child.exitCode !== null, 12000);
    assert.ok(stdout.includes('[ChatGPT alert] ready'), stderr);
    assert.ok(host.messages.some((packet) => packet.cmd === 'connected'));
    host.send({ ...key, cmd: 'setactive', active: true });
    await until(() => host.messages.some((packet) => packet.cmd === 'state'));
    assert.equal(host.messages.find((packet) => packet.cmd === 'state').param.statelist[0].state, 0);
    const closed = once(host, 'closed');
    child.kill();
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Plugin worker survived its launcher')), 7000);
        timer.unref();
      })
    ]);
  });
