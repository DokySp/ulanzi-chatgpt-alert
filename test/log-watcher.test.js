import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { LogWatcher } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/log-watcher.js';
import { notification, tempDirectory } from './helpers.js';

async function setup(t, now = 1000) {
  const root = await tempDirectory(t);
  const events = [];
  const errors = [];
  const watcher = new LogWatcher({
    root, now: () => now, intervalMs: 60000,
    onNotification: (event) => events.push(event), onError: (error) => errors.push(error)
  });
  t.after(() => watcher.stop());
  return { root, events, errors, watcher };
}

test('does not replay history and handles split lines and UTF-8 boundaries', async (t) => {
  const { root, events, errors, watcher } = await setup(t);
  const file = path.join(root, 'codex-desktop-current.log');
  await writeFile(file, notification(900, 'old'));
  await watcher.start();
  await watcher.poll();
  assert.equal(events.length, 0);
  const bytes = Buffer.from(notification(1100, '한글-id', 'question'));
  const split = bytes.indexOf(Buffer.from('한')) + 1;
  await appendFile(file, bytes.subarray(0, split));
  await watcher.poll();
  assert.equal(events.length, 0);
  await appendFile(file, bytes.subarray(split, bytes.length - 1));
  await watcher.poll();
  assert.equal(events.length, 0);
  await appendFile(file, '\n');
  await watcher.poll();
  assert.deepEqual(events, [{ at: 1100, id: '한글-id', kind: 'question' }]);
  assert.equal(errors.length, 0);
});

test('follows a new date folder and a replaced log without replaying old timestamps', async (t) => {
  const { root, events, errors, watcher } = await setup(t);
  await watcher.start();
  const folder = path.join(root, '2026', '11', '11');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'codex-desktop-rotated.log');
  await writeFile(file, notification(900, 'copied-history') + notification(1100, 'new-day'));
  await watcher.poll();
  await rename(file, path.join(folder, 'previous.txt'));
  await writeFile(file, notification(1200, 'replacement'));
  await watcher.poll();
  await writeFile(file, '');
  await watcher.poll();
  await appendFile(file, notification(1300, 'after-truncate', 'permission'));
  await watcher.poll();
  assert.deepEqual(events.map((event) => event.id), ['new-day', 'replacement', 'after-truncate']);
  assert.equal(errors.length, 0);
});

test('can start before the app log folder exists and stops delivering after stop', async (t) => {
  const { root, events, watcher } = await setup(t);
  watcher.root = path.join(root, 'not-created-yet');
  await watcher.start();
  await mkdir(watcher.root);
  const file = path.join(watcher.root, 'codex-desktop-new.log');
  await writeFile(file, notification(1100, 'first'));
  await watcher.poll();
  assert.equal(events.length, 1);
  watcher.stop();
  await appendFile(file, notification(1200, 'stopped'));
  await watcher.poll();
  assert.equal(events.length, 1);
});
