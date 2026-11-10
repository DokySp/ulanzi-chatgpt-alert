import { EventEmitter } from 'node:events';

// Only the native notification service records once per delivered notification.
// Renderer and forwarding messages describe the same notification and are ignored.
const notificationLine = /^(\S+) info \[desktop-notifications\] show notification\s+.*?\bkind=(turn-complete|question|permission)(?=\s|$)/;

export function parseNotification(line) {
  const match = notificationLine.exec(line);
  if (!match) return null;
  const at = Date.parse(match[1]);
  const id = /(?:^|\s)notificationId=(.+)$/.exec(line)?.[1];
  if (!Number.isFinite(at) || !id) return null;
  return { at, id, kind: match[2] };
}

export class AlertState extends EventEmitter {
  pending = false;
  focused = null;
  acknowledgedAt = -Infinity;
  seen = new Set();

  notify(event) {
    if (!event || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
    // A focus change or key press can arrive before the log poll does.
    if (event.at <= this.acknowledgedAt) return;
    this.pending = true;
    this.emit('change');
  }

  acknowledge(at = Date.now()) {
    this.acknowledgedAt = Math.max(this.acknowledgedAt, at);
    if (!this.pending) return;
    this.pending = false;
    this.emit('change');
  }

  setFocus(focused, at) {
    if (focused && this.focused === false) this.acknowledge(at);
    this.focused = focused;
  }

}
