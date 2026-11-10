import { readdir, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parseNotification } from './alert-state.js';

export function defaultLogRoot(localAppData = process.env.LOCALAPPDATA) {
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable');
  return path.join(localAppData, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0',
    'LocalCache', 'Local', 'Codex', 'Logs');
}

async function listLogs(root, depth = 0) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const groups = await Promise.all(entries.map(async (entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory() && depth < 3) return listLogs(file, depth + 1);
    if (entry.isFile() && /^codex-desktop-.*\.log$/.test(entry.name)) return [file];
    return [];
  }));
  return groups.flat();
}

function cursor(metadata, offset = 0) {
  return {
    identity: String(metadata.ino) + ':' + metadata.birthtimeMs,
    offset,
    partial: '',
    decoder: new StringDecoder('utf8')
  };
}

export class LogWatcher {
  constructor({ root = defaultLogRoot(), onNotification, onError = console.error,
    intervalMs = 150, now = Date.now } = {}) {
    this.root = root;
    this.onNotification = onNotification;
    this.onError = onError;
    this.intervalMs = intervalMs;
    this.now = now;
    this.files = new Map();
    this.stopped = true;
    this.busy = false;
  }

  async start() {
    this.startedAt = this.now();
    // Existing contents are a baseline, never pending alerts.
    for (const file of await listLogs(this.root)) {
      try {
        const metadata = await stat(file);
        this.files.set(file, cursor(metadata, metadata.size));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.poll().catch(this.onError);
    }, this.intervalMs);
  }

  async poll() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const paths = await listLogs(this.root);
      const present = new Set(paths);
      for (const file of this.files.keys()) {
        if (!present.has(file)) this.files.delete(file);
      }
      for (const file of paths) {
        if (this.stopped) break;
        try {
          await this.readAppended(file);
        } catch (error) {
          if (error.code !== 'ENOENT') this.onError(error);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async readAppended(file) {
    const current = await stat(file);
    const previous = this.files.get(file);
    if (previous && previous.offset === current.size
      && previous.identity === String(current.ino) + ':' + current.birthtimeMs) return;
    const handle = await open(file, 'r');
    try {
      const metadata = await handle.stat();
      const identity = String(metadata.ino) + ':' + metadata.birthtimeMs;
      let state = this.files.get(file);
      if (!state || state.identity !== identity || metadata.size < state.offset) {
        state = cursor(metadata);
        this.files.set(file, state);
      }
      const buffer = Buffer.alloc(Math.min(65536, metadata.size - state.offset));
      while (!this.stopped && state.offset < metadata.size) {
        const { bytesRead } = await handle.read(buffer, 0,
          Math.min(buffer.length, metadata.size - state.offset), state.offset);
        if (!bytesRead) break;
        state.offset += bytesRead;
        state.partial += state.decoder.write(buffer.subarray(0, bytesRead));
        let newline;
        while ((newline = state.partial.indexOf('\n')) !== -1) {
          const line = state.partial.slice(0, newline).replace(/\r$/, '');
          state.partial = state.partial.slice(newline + 1);
          const event = parseNotification(line);
          if (!this.stopped && event && event.at >= this.startedAt) {
            this.onNotification(event);
          }
        }
      }
    } finally {
      await handle.close();
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
