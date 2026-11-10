import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function durationLabel(minutes) {
  if (minutes === 10080) return '주간';
  if (minutes === 1440) return '일간';
  if (minutes === null) return '사용량';
  if (minutes % 1440 === 0) return minutes / 1440 + '일';
  if (minutes % 60 === 0) return minutes / 60 + '시간';
  return minutes + '분';
}

export function gaugeModel(snapshot, now = Date.now()) {
  if (snapshot.status !== 'ready') return { status: snapshot.status, rows: [] };
  return {
    status: 'ready',
    rows: snapshot.windows.map((window) => {
      const minutes = window.resetsAt === null ? null : Math.ceil((window.resetsAt * 1000 - now) / 60000);
      const expired = minutes !== null && minutes <= 0;
      let reset = '초기화 시간 미제공';
      if (expired) reset = '초기화 확인 중';
      else if (minutes !== null) {
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor(minutes % 1440 / 60);
        reset = '초기화 ' + (days ? days + '일 ' + hours + '시간'
          : hours ? hours + '시간 ' + minutes % 60 + '분' : minutes + '분');
      }
      return { label: durationLabel(window.windowDurationMins),
        percent: expired ? null : Math.round(window.usedPercent), reset };
    })
  };
}

let renderScript;
export async function renderUsageGauge(snapshot, now = Date.now()) {
  renderScript ||= await readFile(new URL('./usage-gauge.ps1', import.meta.url), 'utf8');
  const executable = path.join(process.env.SystemRoot,
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = execFile(executable,
      ['-NoProfile', '-NonInteractive', '-Command', '& {\n' + renderScript + '\n}'],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) reject(new Error('Cannot draw the usage gauge'));
        else resolve('data:image/png;base64,' + stdout.trim());
      });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(gaugeModel(snapshot, now)));
  });
}
