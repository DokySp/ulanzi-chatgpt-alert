import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (typeof globalThis.WebSocket === 'function') {
  const { start } = await import('./app.js');
  await start();
} else {
  // Ulanzi Studio 3.4.8 ships Node 20.12.2, whose built-in WebSocket needs this flag.
  // Keep the launcher alive so Studio retains ownership of the plugin process.
  const child = spawn(process.execPath,
    ['--experimental-websocket', fileURLToPath(new URL('./app.js', import.meta.url)),
      ...process.argv.slice(2)],
    {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        ULANZI_CHATGPT_SUPERVISOR_PID: String(process.pid),
        ULANZI_CHATGPT_HOST_PID: String(process.ppid)
      }
    });
  child.once('error', (error) => {
    console.error('[ChatGPT alert]', error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
  const stop = () => child.kill();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('exit', stop);
}
