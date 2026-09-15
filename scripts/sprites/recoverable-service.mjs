import { spawn } from 'node:child_process';

// A failed media service must not restart the identity service or web shell.
// Each service owns a process group so its encoders cannot survive a crash and
// compete with the replacement. Credentials stay in the unchanged environment.
export function startRecoverableService({label, command, args, cwd, env, onChild = () => {}, report = message => process.stderr.write(message + '\n'), restartDelayMs = 1000, maximumDelayMs = 30000}) {
  let current, timer, closed = false, failures = 0, closing;
  const grouped = process.platform !== 'win32';
  function signal(child, value) {
    if (!child?.pid) return;
    try { if (grouped) process.kill(-child.pid, value); else child.kill(value); }
    catch (error) { if (error.code !== 'ESRCH') report(`${label}: process cleanup failed (${error.code})`); }
  }
  function launch() {
    if (closed) return;
    const started = Date.now();
    const child = current = spawn(command, args, {cwd, env, detached:grouped, stdio:'inherit'});
    let settled = false;
    const exited = (code, reason) => {
      if (settled) return;
      settled = true;
      // The parent may have died without stopping its FFmpeg children.
      signal(child, 'SIGKILL');
      if (current === child) current = undefined;
      if (closed) return;
      failures = Date.now() - started >= 60000 ? 1 : failures + 1;
      const delay = Math.min(maximumDelayMs, restartDelayMs * 2 ** Math.min(failures - 1, 5));
      report(`${label}: exited (code=${code ?? 'none'}, signal=${reason ?? 'none'}); restarting in ${delay}ms`);
      timer = setTimeout(launch, delay);
    };
    child.once('error', error => exited(null, error.code ?? 'spawn-error'));
    child.once('exit', exited);
    onChild(child);
  }
  launch();
  return {
    get current() { return current; },
    // Readiness continues polling the same endpoint across a startup retry.
    get exitCode() { return null; },
    close() {
      if (closing) return closing;
      closed = true;
      clearTimeout(timer);
      const child = current;
      closing = !child || child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => {
        const killTimer = setTimeout(() => signal(child, 'SIGKILL'), 2000);
        const finish = () => { clearTimeout(killTimer); signal(child, 'SIGKILL'); resolve(); };
        child.once('exit', finish);
        child.once('error', finish);
        signal(child, 'SIGTERM');
      });
      return closing;
    },
  };
}
