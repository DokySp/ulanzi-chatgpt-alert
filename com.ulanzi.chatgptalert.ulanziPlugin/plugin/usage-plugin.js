import { USAGE_UUID, keyIdentity } from './ulanzi-client.js';
import { CodexUsageSource } from './usage-source.js';
import { renderUsageGauge } from './usage-gauge.js';

export class UsagePlugin {
  constructor(client, { source = new CodexUsageSource(), render = renderUsageGauge,
    intervalMs = 60000, onError = () => {} } = {}) {
    this.client = client;
    this.source = source;
    this.draw = render;
    this.intervalMs = intervalMs;
    this.onError = onError;
    this.keys = new Map();
    this.snapshot = { status: 'loading' };
    this.renderSequence = 0;
    this.stopped = false;
    client.on('connected', () => {
      for (const entry of this.keys.values()) entry.lastDisplay = null;
      this.render();
    });
    for (const event of ['add', 'paramfromapp', 'paramfromplugin', 'didReceiveSettings']) {
      client.on(event, (target) => this.add(target));
    }
    client.on('setactive', (target) => this.add(target, target.active !== false));
    client.on('clear', ({ param }) => {
      for (const target of Array.isArray(param) ? param : []) this.keys.delete(keyIdentity(target));
      this.syncTimer();
    });
    client.on('run', (target) => {
      if (this.keys.get(keyIdentity(target))?.active) this.refresh();
    });
  }

  add(target, active = true) {
    if (this.stopped || target.uuid !== USAGE_UUID || !target.actionid
      || target.key === undefined || target.key === null || target.key === '') return;
    const id = keyIdentity(target);
    const entry = this.keys.get(id) || { target: {
      uuid: target.uuid, key: target.key, actionid: target.actionid
    }, lastDisplay: null };
    entry.active = active;
    if (!active) entry.lastDisplay = null;
    this.keys.set(id, entry);
    this.syncTimer();
    this.render();
  }

  syncTimer() {
    const active = [...this.keys.values()].some((entry) => entry.active);
    if (!active || this.stopped) {
      clearInterval(this.timer);
      this.timer = null;
    } else if (!this.timer) {
      this.timer = setInterval(() => this.refresh(), this.intervalMs);
      this.refresh();
    }
  }

  async refresh() {
    if (this.stopped || this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try { this.snapshot = await this.source.read(); }
      catch (error) {
        this.snapshot = { status: 'error' };
        if (!this.stopped) this.onError(error);
      }
      if (!this.stopped) await this.render();
    })();
    try { await this.refreshing; }
    finally { this.refreshing = null; }
  }

  async render() {
    if (this.stopped || ![...this.keys.values()].some((entry) => entry.active)) return;
    const sequence = ++this.renderSequence;
    try {
      const data = await this.draw(this.snapshot);
      if (this.stopped || sequence !== this.renderSequence) return;
      for (const entry of this.keys.values()) {
        if (!entry.active || entry.lastDisplay === data) continue;
        this.client.setImage(entry.target, data);
        entry.lastDisplay = data;
      }
    } catch (error) {
      if (!this.stopped) this.onError(error);
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.source.stop();
  }
}
