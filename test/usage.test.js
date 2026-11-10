import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexUsageSource, normalizeUsage } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/usage-source.js';
import { gaugeModel, renderUsageGauge } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/usage-gauge.js';
import { UsagePlugin } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/usage-plugin.js';
import { AlertPlugin } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/app.js';
import { USAGE_UUID, ACTION_UUID, UlanziClient } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/ulanzi-client.js';
import { websocketHost } from './websocket-host.js';
import { until } from './helpers.js';

const result = (usedPercent = 25) => ({ rateLimitsByLimitId: { codex: {
  limitId: 'codex', primary: { usedPercent, windowDurationMins: 10080, resetsAt: 2000000 }
} } });
const key = { uuid: USAGE_UUID, key: 'D200X:test:1', actionid: 'usage-instance' };

test('uses the account bucket, preserves actual windows and never treats missing usage as zero', () => {
  const raw = result();
  raw.rateLimits = { limitId: 'legacy', primary: { usedPercent: 99 } };
  raw.rateLimitsByLimitId.other = { limitId: 'other', primary: { usedPercent: 10 } };
  raw.rateLimitsByLimitId.codex.secondary = { usedPercent: 0, windowDurationMins: 300, resetsAt: null };
  const snapshot = normalizeUsage(raw, 123);
  assert.equal(snapshot.limitId, 'codex');
  assert.equal(snapshot.fetchedAt, 123);
  assert.deepEqual(snapshot.windows.map((window) => window.usedPercent), [25, 0]);
  assert.equal(snapshot.windows[1].resetsAt, null);
  assert.throws(() => normalizeUsage({ rateLimits: { primary: { usedPercent: null } } }));
  assert.throws(() => normalizeUsage({}));
  assert.equal(normalizeUsage({ rateLimits: { primary: { usedPercent: 110 } } }).windows[0].usedPercent, 100);
  assert.equal(normalizeUsage({ rateLimits: { primary: { usedPercent: -1 } } }).windows[0].usedPercent, 0);
  assert.equal(normalizeUsage({
    rateLimitsByLimitId: { codex_other: { limitId: 'codex_other', primary: { usedPercent: 90 } } },
    rateLimits: { limitId: 'codex', primary: { usedPercent: 12 } }
  }).windows[0].usedPercent, 12);
  assert.throws(() => normalizeUsage({ rateLimitsByLimitId: {
    codex_other: { limitId: 'codex_other', primary: { usedPercent: 90 } }
  } }));
});

test('gauge labels follow window metadata and expired windows are not displayed as current usage', () => {
  const snapshot = normalizeUsage(result());
  let model = gaugeModel(snapshot, (2000000 - 3600) * 1000);
  assert.deepEqual(model.rows[0], { label: '주간', percent: 25, reset: '초기화 1시간 0분' });
  model = gaugeModel(snapshot, 2000001 * 1000);
  assert.equal(model.rows[0].percent, null);
  assert.equal(model.rows[0].reset, '초기화 확인 중');
  snapshot.windows[0].windowDurationMins = 300;
  snapshot.windows[0].resetsAt = null;
  assert.equal(gaugeModel(snapshot).rows[0].label, '5시간');
  assert.equal(gaugeModel(snapshot).rows[0].reset, '초기화 시간 미제공');
  assert.deepEqual(gaugeModel({ status: 'error' }), { status: 'error', rows: [] });
});

function fakeServer(reply) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.sent = [];
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = new Writable({ write(chunk, encoding, done) {
    const message = JSON.parse(chunk.toString());
    child.sent.push(message);
    queueMicrotask(() => reply(message, (packet) => child.stdout.write(JSON.stringify(packet) + '\n')));
    done();
  } });
  return child;
}

test('usage reader initializes then performs only the read request and closes the helper', async () => {
  const child = fakeServer((message, send) => {
    if (message.id === 1) send({ id: 1, result: {} });
    if (message.id === 2) send({ id: 2, result: result() });
  });
  const source = new CodexUsageSource({ findExecutable: async () => 'codex.exe',
    spawnImpl: () => child, now: () => 42 });
  const snapshot = await source.read();
  assert.equal(snapshot.fetchedAt, 42);
  assert.deepEqual(child.sent.map((packet) => packet.method),
    ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(child.killed, true);
  source.stop();
});

test('usage reader timeout and sign-in errors clean up without forwarding private server messages', async () => {
  let child = fakeServer(() => {});
  let source = new CodexUsageSource({ findExecutable: async () => 'codex.exe',
    spawnImpl: () => child, timeoutMs: 15 });
  await assert.rejects(source.read(), /timed out/);
  assert.equal(child.killed, true);
  child = fakeServer((message, send) => send({ id: message.id, error: { message: 'private-account-data' } }));
  source = new CodexUsageSource({ findExecutable: async () => 'codex.exe', spawnImpl: () => child });
  await assert.rejects(source.read(), (error) => !error.message.includes('private-account-data'));
  assert.equal(child.killed, true);
});

test('stopping during executable discovery cancels it and never starts an app-server', async () => {
  let started = false;
  let aborted = false;
  const source = new CodexUsageSource({
    findExecutable: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); });
    }), spawnImpl: () => { started = true; }
  });
  const reading = source.read();
  source.stop();
  await assert.rejects(reading, /cancelled/);
  assert.equal(aborted, true);
  assert.equal(started, false);
});

class Host extends EventEmitter {
  frames = [];
  setImage(target, data) { this.frames.push({ target, data }); }
  setState() {}
  setAnimation() {}
}

test('usage activation, refresh, failure, reconnect and removal remain separate from alert dismissal', async (t) => {
  const host = new Host();
  let calls = 0;
  let fail = false;
  const source = { read: async () => {
    calls++;
    if (fail) throw new Error('offline');
    return normalizeUsage(result(calls));
  }, stop() {} };
  const usage = new UsagePlugin(host, { source, intervalMs: 60000,
    render: async (snapshot) => snapshot.status + ':' + (snapshot.windows?.[0].usedPercent ?? '') });
  t.after(() => usage.stop());
  const alert = new AlertPlugin(host);
  host.emit('add', { ...key, uuid: ACTION_UUID });
  alert.state.notify({ id: 'pending', at: 1 });
  host.emit('add', key);
  await until(() => host.frames.at(-1)?.data === 'ready:1');
  host.emit('run', { ...key, actionid: 'unrelated' });
  assert.equal(calls, 1);
  host.emit('run', key);
  await until(() => host.frames.at(-1)?.data === 'ready:2');
  assert.equal(alert.state.pending, true);
  fail = true;
  host.emit('run', key);
  await until(() => host.frames.at(-1)?.data === 'error:');
  const count = host.frames.length;
  host.emit('connected');
  await until(() => host.frames.length > count);
  host.emit('setactive', { ...key, active: false });
  assert.equal(usage.timer, null);
  const inactiveCount = host.frames.length;
  host.emit('run', key);
  await usage.render();
  assert.equal(host.frames.length, inactiveCount);
  host.emit('clear', { param: [key] });
  assert.equal(usage.keys.size, 0);
});

test('overlapping refreshes are coalesced and late drawings cannot overwrite a newer snapshot', async (t) => {
  const host = new Host();
  let readDone;
  let readCount = 0;
  const drawings = [];
  const source = { read: () => { readCount++; return new Promise((resolve) => { readDone = resolve; }); }, stop() {} };
  const usage = new UsagePlugin(host, { source, render: (snapshot) => new Promise((resolve) => {
    drawings.push({ status: snapshot.status, resolve });
  }) });
  t.after(() => usage.stop());
  host.emit('add', key);
  host.emit('run', key);
  assert.equal(readCount, 1);
  readDone(normalizeUsage(result()));
  await until(() => drawings.some((drawing) => drawing.status === 'ready'));
  drawings.find((drawing) => drawing.status === 'ready').resolve('latest');
  await until(() => host.frames.length === 1);
  drawings.find((drawing) => drawing.status === 'loading').resolve('old');
  await Promise.resolve();
  assert.equal(host.frames.at(-1).data, 'latest');
  usage.stop();
  const before = host.frames.length;
  await usage.render();
  assert.equal(host.frames.length, before);
});

test('real WebSocket routes the usage image and the physical press refreshes it', async (t) => {
  const host = await websocketHost(t);
  const client = new UlanziClient({ port: host.port });
  let value = 4;
  const usage = new UsagePlugin(client, { source: {
    read: async () => normalizeUsage(result(value++)), stop() {}
  }, render: async (snapshot) => 'image:' + (snapshot.windows?.[0].usedPercent ?? snapshot.status) });
  t.after(() => { usage.stop(); client.close(); });
  client.connect();
  await until(() => host.messages.some((packet) => packet.cmd === 'connected'));
  host.send({ ...key, cmd: 'add', cmdType: 'REQUEST' });
  const frames = () => host.messages.filter((packet) => packet.cmd === 'state')
    .map((packet) => packet.param.statelist[0]);
  await until(() => frames().at(-1)?.data === 'image:4');
  assert.equal(frames().at(-1).type, 1);
  assert.equal(frames().at(-1).uuid, USAGE_UUID);
  host.send({ ...key, cmd: 'run', cmdType: 'REQUEST' });
  await until(() => frames().at(-1)?.data === 'image:5');
});

test('Windows renderer produces a real 196px PNG for ready, two-window, loading and error states',
  { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
    const ready = normalizeUsage(result());
    const dual = { ...ready, windows: [...ready.windows, { usedPercent: 75,
      windowDurationMins: 300, resetsAt: null }] };
    for (const snapshot of [ready, dual, { status: 'loading' }, { status: 'error' }]) {
      const data = await renderUsageGauge(snapshot, 1000000);
      assert.ok(data.startsWith('data:image/png;base64,'));
      const bytes = Buffer.from(data.split(',')[1], 'base64');
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), 196);
      assert.equal(bytes.readUInt32BE(20), 196);
    }
  });
