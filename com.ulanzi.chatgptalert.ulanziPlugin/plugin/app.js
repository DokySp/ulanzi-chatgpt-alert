import { pathToFileURL } from 'node:url';
import { AlertState } from './alert-state.js';
import { LogWatcher } from './log-watcher.js';
import { FocusMonitor } from './focus-monitor.js';
import { UlanziClient, ACTION_UUID, keyIdentity } from './ulanzi-client.js';

export class AlertPlugin {
  constructor(client, { now = Date.now } = {}) {
    this.client = client;
    this.now = now;
    this.state = new AlertState();
    this.keys = new Map();
    this.state.on('change', () => this.render());
    client.on('connected', () => {
      for (const entry of this.keys.values()) entry.lastDisplay = null;
      this.render();
    });
    client.on('add', (target) => this.add(target));
    client.on('paramfromapp', (target) => this.add(target));
    client.on('paramfromplugin', (target) => this.add(target));
    client.on('didReceiveSettings', (target) => this.add({ ...target, param: target.settings }));
    client.on('setactive', (target) => this.add(target, target.active !== false));
    client.on('clear', ({ param }) => {
      for (const target of Array.isArray(param) ? param : []) {
        this.keys.delete(keyIdentity(target));
      }
    });
    client.on('run', (target) => {
      if (this.keys.has(keyIdentity(target))) this.state.acknowledge(this.now());
    });
  }

  add(target, active = true) {
    if (target.uuid !== ACTION_UUID || !target.actionid
      || target.key === undefined || target.key === null || target.key === '') return null;
    const id = keyIdentity(target);
    let entry = this.keys.get(id);
    if (!entry) {
      entry = {
        target: { uuid: target.uuid, key: target.key, actionid: target.actionid },
        active, effect: 'blink', lastDisplay: null
      };
      this.keys.set(id, entry);
    }
    if (target.param && typeof target.param === 'object') {
      entry.effect = target.param.effect === 'fade' ? 'fade' : 'blink';
    }
    entry.active = active;
    if (!active) entry.lastDisplay = null;
    this.render();
    return entry;
  }

  render() {
    for (const entry of this.keys.values()) {
      if (!entry.active) continue;
      const display = this.state.pending ? entry.effect : 'idle';
      if (entry.lastDisplay === display) continue;
      if (display === 'idle') this.client.setState(entry.target, 0);
      else this.client.setAnimation(entry.target, './resources/' + display + '.gif');
      entry.lastDisplay = display;
    }
  }
}

export async function start() {
  const [address, port] = process.argv.slice(2);
  const client = new UlanziClient({ address, port });
  const plugin = new AlertPlugin(client);
  const reportError = (error) => console.error('[ChatGPT alert]', error.message);
  const focus = new FocusMonitor({
    onFocus: (focused, at) => plugin.state.setFocus(focused, at), onError: reportError
  });
  const watcher = new LogWatcher({
    onNotification: (event) => plugin.state.notify(event), onError: reportError
  });
  let parentCheck;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(parentCheck);
    watcher.stop();
    focus.stop();
    client.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('exit', stop);
  client.on('connection-error', reportError);
  client.connect();
  try {
    await focus.start();
    if (stopped) return { plugin, stop };
    await watcher.start();
    if (stopped) {
      watcher.stop();
      return { plugin, stop };
    }
    const parents = [
      Number(process.env.ULANZI_CHATGPT_SUPERVISOR_PID) || process.ppid,
      Number(process.env.ULANZI_CHATGPT_HOST_PID) || process.ppid
    ];
    if (parents.every((pid) => pid > 0)) {
      parentCheck = setInterval(() => {
        try {
          for (const pid of parents) process.kill(pid, 0);
        } catch { stop(); }
      }, 1000);
    }
    console.log('[ChatGPT alert] ready');
  } catch (error) {
    stop();
    throw error;
  }
  return { plugin, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error('[ChatGPT alert]', error.message);
    process.exitCode = 1;
  });
}
