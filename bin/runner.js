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
    let terminating = false;

    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        // The group may already have exited between lifecycle events and signalling.
        if (error.code !== 'ESRCH') throw error;
      }
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (terminating) killGroup('SIGKILL');
      clearTimeout(timeoutTimer);
      clearTimeout(escalationTimer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const terminate = () => {
      if (!child?.pid || terminating || resolved) return;
      terminating = true;
      killGroup('SIGTERM');
      escalationTimer = setTimeout(() => {
        killGroup('SIGKILL');
        escalationTimer = setTimeout(() => {
          // Even an escaped descendant holding inherited pipes cannot block shutdown.
          child.stdout.destroy();
          child.stderr.destroy();
          finish({ code: child.exitCode, signal: child.signalCode, stdout, stderr });
        }, TERMINATION_GRACE_MS);
      }, TERMINATION_GRACE_MS);
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
        detached: true,
      });
    } catch (error) {
      // Synchronous spawn failures cross the same result boundary as the error event.
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
