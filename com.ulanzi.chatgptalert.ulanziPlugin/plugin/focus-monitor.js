import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

export class FocusMonitor {
  constructor({ onFocus, onError = console.error } = {}) {
    this.onFocus = onFocus;
    this.onError = onError;
    this.stopped = false;
  }

  async start() {
    const script = await readFile(new URL('./foreground.ps1', import.meta.url), 'utf8');
    const executable = path.join(process.env.SystemRoot,
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const command = '& {\n' + script + '\n} -ParentProcessId ' + process.pid;
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    await new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        reject(new Error('ChatGPT focus detection did not start'));
        this.stop();
      }, 10000);
      const fail = (error) => {
        clearTimeout(timer);
        if (!ready) reject(error);
        else if (!this.stopped) this.onError(error);
      };
      this.lines.on('line', (line) => {
        try {
          const event = JSON.parse(line);
          if (typeof event.focused !== 'boolean' || !Number.isFinite(event.at)) return;
          this.onFocus(event.focused, event.at);
          if (!ready) {
            ready = true;
            clearTimeout(timer);
            resolve();
          }
        } catch (error) {
          fail(error);
        }
      });
      child.once('error', fail);
      child.once('exit', (code) => {
        if (!this.stopped) fail(new Error('ChatGPT focus detection exited (' + code + ')'));
      });
      child.stderr.on('data', () => {
        fail(new Error('ChatGPT focus detection reported a PowerShell error'));
      });
    });
  }

  stop() {
    this.stopped = true;
    this.lines?.close();
    this.child?.kill();
  }
}
