import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

function captureStream(isTTY) {
  let text = '';
  const stream = new Writable({
    write(chunk, encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  stream.isTTY = isTTY;
  Object.defineProperty(stream, 'text', { get: () => text });
  return stream;
}

export function createFakeHost(t, overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'lemonpi-test-'));
  const piCodingAgentDir = join(home, '.pi', 'agent');
  mkdirSync(piCodingAgentDir, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const stdout = captureStream(overrides.stdoutTTY ?? false);
  const stderr = captureStream(overrides.stderrTTY ?? false);
  const runnerCalls = [];
  const runnerResults = [...(overrides.runnerResults ?? [])];
  const abortController = new AbortController();
  const stdin = new Proxy(Object.create(null), {
    get() {
      throw new Error('stdin must not be read');
    },
    set() {
      throw new Error('stdin must not be accessed');
    },
  });

  const host = {
    env: {
      ...overrides.env,
      HOME: home,
      PI_CODING_AGENT_DIR: piCodingAgentDir,
    },
    platform: overrides.platform ?? 'linux',
    nodeVersion: overrides.nodeVersion ?? 'v22.19.0',
    stdout,
    stderr,
    stdin,
    runner: async (command, args = [], options = {}) => {
      runnerCalls.push({ command, args: [...args], options });
      return runnerResults.shift() ?? {
        code: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
    signal: abortController.signal,
  };

  return {
    host,
    home,
    piCodingAgentDir,
    stdout,
    stderr,
    runnerCalls,
    runnerResults,
    abortController,
  };
}
