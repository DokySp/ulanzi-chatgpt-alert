import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertState, parseNotification } from '../com.ulanzi.chatgptalert.ulanziPlugin/plugin/alert-state.js';
import { notification } from './helpers.js';

test('recognizes completion, question and permission; ignores duplicate log layers and other sounds', () => {
  for (const kind of ['turn-complete', 'question', 'permission']) {
    assert.deepEqual(parseNotification(notification(1000, 'id', kind).trim()),
      { at: 1000, id: 'id', kind });
  }
  const line = notification(1000).trim();
  for (const invalid of [
    line.replace('[desktop-notifications]', '[electron-message-handler] [desktop-notifications]'),
    line.replace('[desktop-notifications]', '[notifications-service] [desktop-notifications]'),
    line.replace('turn-complete', 'agent-message'),
    line.replace(' info ', ' error '),
    line.replace(/^\S+/, 'invalid-date'),
    line.replace(/ notificationId=.+$/, '')
  ]) assert.equal(parseNotification(invalid), null);
});

test('keeps the alert pending until acknowledged and accepts the next notification', () => {
  const state = new AlertState();
  assert.equal(state.pending, false);
  state.notify({ at: 10, id: 'first' });
  assert.equal(state.pending, true);
  state.acknowledge(20);
  assert.equal(state.pending, false);
  state.notify({ at: 10, id: 'first' });
  assert.equal(state.pending, false);
  state.notify({ at: 21, id: 'second' });
  assert.equal(state.pending, true);
});

test('returning to the app dismisses an alert; a repeated focused sample does not simulate a return', () => {
  const state = new AlertState();
  state.setFocus(true, 1);
  state.notify({ at: 2, id: 'first' });
  state.setFocus(true, 3);
  assert.equal(state.pending, true);
  state.setFocus(false, 4);
  state.setFocus(true, 5);
  assert.equal(state.pending, false);
});

test('delayed log delivery cannot rearm an alert already acknowledged by focus or key press', () => {
  const state = new AlertState();
  state.setFocus(false, 1);
  state.setFocus(true, 30);
  state.notify({ at: 20, id: 'late-after-focus' });
  assert.equal(state.pending, false);
  state.acknowledge(50);
  state.notify({ at: 40, id: 'late-after-key' });
  assert.equal(state.pending, false);
  state.notify({ at: 51, id: 'new' });
  assert.equal(state.pending, true);
});
