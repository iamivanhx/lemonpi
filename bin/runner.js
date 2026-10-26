import { spawn } from 'node:child_process';

const TERMINATION_GRACE_MS = 250;

function errorResult(error, stdout = '', stderr = '') {
  const result = { code: null, signal: null, stdout, stderr };
  if (error?.code === 'ENOENT') result.notFound = true;
  else if (error) {
    const name = error.name ?? 'Error';
    const code = error.code ? ` (${error.code})` : '';
    result.error = `${name}${code}: ${error.message ?? 'subprocess failed'}`;
  }
  return result;
}

export function runner(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let timeoutTimer;
    let escalationTimer;
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      clearTimeout(escalationTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const terminate = () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      if (!child.kill('SIGTERM')) return;
      escalationTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, TERMINATION_GRACE_MS);
      escalationTimer.unref?.();
    };

    const onAbort = () => terminate();

    if (!Array.isArray(args)) {
      finish(errorResult(new TypeError('args must be an array')));
      return;
    }
    if (options.signal?.aborted) {
      finish({ code: null, signal: null, stdout, stderr });
      return;
    }

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      finish(errorResult(error));
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.once('error', (error) => finish(errorResult(error, stdout, stderr)));
    child.once('close', (code, signal) => finish({ code, signal, stdout, stderr }));

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
      if (options.signal.aborted) onAbort();
    }

    if (Number.isFinite(options.timeout) && options.timeout >= 0) {
      timeoutTimer = setTimeout(terminate, options.timeout);
      timeoutTimer.unref?.();
    }
  });
}
