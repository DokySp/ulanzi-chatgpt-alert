import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { FocusMonitor } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/focus-monitor.js';

// Keep the Windows process integration separate from the transport test process.
test('Windows focus helper reports real foreground state and exits when stopped',
  { skip: process.platform !== 'win32' }, async () => {
    const events = [];
    const errors = [];
    const monitor = new FocusMonitor({
      onFocus: (focused, at) => events.push({ focused, at }),
      onError: (error) => errors.push(error)
    });
    try {
      await monitor.start();
      assert.equal(typeof events[0].focused, 'boolean');
      assert.ok(Math.abs(Date.now() - events[0].at) < 5000);
      const exited = once(monitor.child, 'exit');
      monitor.stop();
      await exited;
      assert.equal(errors.length, 0);
    } finally { monitor.stop(); }
  });
