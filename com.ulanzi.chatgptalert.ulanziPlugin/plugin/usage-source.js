import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

export function normalizeUsage(result, fetchedAt = Date.now()) {
  const mapped = result?.rateLimitsByLimitId;
  const buckets = mapped && typeof mapped === 'object' ? Object.values(mapped).filter(Boolean) : [];
  const legacy = result?.rateLimits;
  const bucket = mapped?.codex || buckets.find((item) => item.limitId === 'codex')
    || (legacy && (!legacy.limitId || legacy.limitId === 'codex') ? legacy : null);
  if (bucket?.limitId && bucket.limitId !== 'codex') throw new Error('Codex usage limits are unavailable');
  const windows = [bucket?.primary, bucket?.secondary].filter((window) =>
    window && typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent))
    .map((window) => ({
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
      windowDurationMins: typeof window.windowDurationMins === 'number'
        && Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0
        ? window.windowDurationMins : null,
      resetsAt: typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt)
        && window.resetsAt > 0 ? window.resetsAt : null
    }));
  if (!windows.length) throw new Error('Usage limits are unavailable');
  return { status: 'ready', limitId: bucket.limitId || 'codex', windows, fetchedAt };
}

export async function findCodexExecutable({ signal } = {}) {
  const executable = path.join(process.env.SystemRoot,
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Ask Windows for the current package location so Store app updates keep working.
  const command = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $candidate = Get-Process -Name ChatGPT -ErrorAction SilentlyContinue |
      Where-Object { $_.Path } | Select-Object -First 1 -ExpandProperty Path
    if ($candidate) {
      $candidate = Join-Path (Split-Path -Parent $candidate) 'resources\\codex.exe'
      if (Test-Path -LiteralPath $candidate) { [Console]::WriteLine($candidate); exit 0 }
    }
    $package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if ($package) {
      $candidate = Join-Path $package.InstallLocation 'app\\resources\\codex.exe'
      if (Test-Path -LiteralPath $candidate) { [Console]::WriteLine($candidate); exit 0 }
    }
    exit 1`;
  return new Promise((resolve, reject) => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 10000, encoding: 'utf8', signal }, (error, stdout) => {
        const candidate = stdout?.trim();
        if (error || !candidate) reject(new Error('ChatGPT Windows app was not found'));
        else resolve(candidate);
      });
  });
}

export class CodexUsageSource {
  constructor({ findExecutable = findCodexExecutable, spawnImpl = spawn,
    timeoutMs = 15000, now = Date.now } = {}) {
    this.findExecutable = findExecutable;
    this.spawn = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.stopped = false;
  }

  async read() {
    if (this.stopped) throw new Error('Usage reader stopped');
    if (!this.executable) {
      this.discovery = new AbortController();
      try { this.executable = await this.findExecutable({ signal: this.discovery.signal }); }
      finally { this.discovery = null; }
    }
    if (this.stopped) throw new Error('Usage reader stopped');
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.executable, ['app-server'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
      this.child = child;
      const lines = createInterface({ input: child.stdout });
      let finished = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        lines.close();
        child.kill();
        if (error) reject(error);
        else resolve(result);
      };
      this.cancel = () => finish(new Error('Usage reader stopped'));
      const timer = setTimeout(() => finish(new Error('Usage query timed out')), this.timeoutMs);
      const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
      child.on('error', () => {
        this.executable = null;
        finish(new Error('Cannot start the ChatGPT usage reader'));
      });
      child.stdin.on('error', () => finish(new Error('Usage reader connection closed')));
      child.stderr.on('data', () => {}); // Do not forward account details or tokens to logs.
      child.once('exit', () => finish(new Error('Usage reader exited before responding')));
      lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id !== 1 && message.id !== 2) return;
        if (message.error) { finish(new Error('Usage unavailable; check ChatGPT sign-in')); return; }
        if (message.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ method: 'account/rateLimits/read', id: 2 });
        } else {
          try { finish(null, normalizeUsage(message.result, this.now())); }
          catch (error) { finish(error); }
        }
      });
      send({ method: 'initialize', id: 1, params: {
        clientInfo: { name: 'ulanzi_usage_gauge', title: 'Ulanzi Usage Gauge', version: '1.2.0' }
      } });
    });
  }

  stop() {
    this.stopped = true;
    this.discovery?.abort();
    this.cancel?.();
  }
}
