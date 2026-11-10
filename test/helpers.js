import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const pluginRoot = path.join(projectRoot, 'com.ulanzi.chatgptalert.ulanziPlugin');

export async function tempDirectory(t) {
  const directory = await mkdtemp(path.join(projectRoot, '.test-'));
  t.after(async () => {
    const relative = path.relative(projectRoot, directory);
    assert.ok(relative.startsWith('.test-') && !relative.includes(path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

export function notification(at, id = 'test-notification', kind = 'turn-complete') {
  return new Date(at).toISOString()
    + ' info [desktop-notifications] show notification actionCount=0 kind='
    + kind + ' notificationId=' + id + '\n';
}

export async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
