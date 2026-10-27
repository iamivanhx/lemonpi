import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import {
  chmod as chmodOnFs,
  lstat as lstatOnFs,
  mkdir as mkdirOnFs,
  readFile as readFileFromFs,
  readlink as readlinkOnFs,
  realpath as realpathOnFs,
  rename as renameOnFs,
  rm as rmOnFs,
  stat as statOnFs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
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

function parsePiSettings(contents) {
  return JSON.parse(contents.replace(/^\uFEFF/, ''));
}

async function fileFacts(stat, path) {
  try {
    const result = await stat(path);
    return {
      isFile: result.isFile(),
      isDirectory: result.isDirectory(),
      isSymbolicLink: result.isSymbolicLink(),
      mode: result.mode,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { notFound: true };
    throw error;
  }
}

async function realpathIncludingDangling(path) {
  try {
    return await realpathOnFs(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const absolutePath = resolve(path);
  let current = parse(absolutePath).root;
  let pending = relative(current, absolutePath).split(sep).filter(Boolean);
  let followedLinks = 0;

  while (pending.length > 0) {
    const component = pending.shift();
    const candidate = join(current, component);
    let result;
    try {
      result = await lstatOnFs(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') return resolve(candidate, ...pending);
      throw error;
    }

    if (!result.isSymbolicLink()) {
      current = candidate;
      continue;
    }

    followedLinks += 1;
    if (followedLinks > 40) {
      const error = new Error(`Too many symbolic links while resolving ${path}`);
      error.code = 'ELOOP';
      throw error;
    }
    const target = await readlinkOnFs(candidate);
    const targetPath = isAbsolute(target) ? resolve(target) : resolve(dirname(candidate), target);
    current = parse(targetPath).root;
    pending = relative(current, targetPath).split(sep).filter(Boolean).concat(pending);
  }

  return current;
}

function isUnderPath(path, root) {
  const remainder = relative(root, path);
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

function accessDenied(path) {
  const error = new Error(`EACCES: permission denied, '${path}'`);
  error.code = 'EACCES';
  return error;
}

function gitIdentity(source) {
  if (typeof source !== 'string') return null;
  if (source.startsWith('npm:')) {
    const nameAndPin = source.slice('npm:'.length);
    const pinSeparator = nameAndPin.lastIndexOf('@');
    const name = pinSeparator > nameAndPin.lastIndexOf('/')
      ? nameAndPin.slice(0, pinSeparator)
      : nameAndPin;
    return name ? `npm:${name}` : null;
  }

  const trimmed = source.trim();
  const hasGitPrefix = trimmed.startsWith('git:');
  const value = hasGitPrefix ? trimmed.slice('git:'.length).trim() : trimmed;
  if (!hasGitPrefix && !/^(?:https?|ssh|git):\/\//i.test(value)) return null;

  let host;
  let path;
  if (/^(?:https?|ssh|git):\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      host = parsed.hostname.toLowerCase();
      path = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  } else if (hasGitPrefix) {
    const scpStyle = /^git@([^/:?#\s]+):(.+)$/i.exec(value);
    if (scpStyle) {
      [, host, path] = scpStyle;
      host = host.toLowerCase();
    } else {
      const shorthand = /^([^/:?#\s]+)\/(.+)$/.exec(value);
      if (!shorthand) return null;
      [, host, path] = shorthand;
      host = host.toLowerCase();
    }
  } else {
    return null;
  }

  const ref = path.indexOf('@');
  if (ref !== -1) path = path.slice(0, ref);
  path = path.replace(/\.git$/i, '');
  return host && path ? `git:${host}/${path}` : null;
}

async function installGitFixture(agentDirectory, source) {
  const settingsPath = join(agentDirectory, 'settings.json');
  let settings;
  try {
    settings = parsePiSettings(await readFileFromFs(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    settings = { packages: [] };
  }
  if (settings.packages === undefined) settings.packages = [];
  if (!Array.isArray(settings.packages)) throw new Error('settings.json packages must be an array');
  const existingIndex = settings.packages.findIndex((entry) => {
    const declaredSource = typeof entry === 'string' ? entry : entry?.source;
    const identity = typeof declaredSource === 'string' ? gitIdentity(declaredSource) : null;
    return identity !== null && identity === gitIdentity(source);
  });
  if (existingIndex === -1) {
    settings.packages.push(source);
  } else {
    const declaration = settings.packages[existingIndex];
    settings.packages[existingIndex] = typeof declaration === 'string'
      ? source
      : { ...declaration, source };
  }
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

async function writeFixture(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

async function removeFixture(agentDirectory, source) {
  const settingsPath = join(agentDirectory, 'settings.json');
  let settings;
  try {
    settings = parsePiSettings(await readFileFromFs(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    settings = { packages: [] };
  }
  if (settings.packages === undefined) settings.packages = [];
  if (!Array.isArray(settings.packages)) throw new Error('settings.json packages must be an array');
  const sourceIdentity = gitIdentity(source);
  settings.packages = settings.packages.filter((entry) => {
    const declaredSource = typeof entry === 'string' ? entry : entry?.source;
    return gitIdentity(declaredSource) !== sourceIdentity;
  });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

export function createFakeHost(t, overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'lemonpi-test-'));
  const piCodingAgentDir = join(home, '.pi', 'agent');
  const cwd = join(home, 'project');
  const temporaryDirectory = join(home, 'tmp');
  mkdirSync(piCodingAgentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(temporaryDirectory, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const stdout = captureStream(overrides.stdoutTTY ?? false);
  const stderr = captureStream(overrides.stderrTTY ?? false);
  const runnerCalls = [];
  const runnerResults = [...(overrides.runnerResults ?? [])];
  const fakePi = overrides.fakePi ?? {};
  const abortController = new AbortController();
  const configuredWriteFailures = typeof overrides.writeFailures === 'function'
    ? overrides.writeFailures({ home, agentDir: piCodingAgentDir })
    : overrides.writeFailures ?? [];
  const writeFailurePaths = configuredWriteFailures.map((path) => resolve(path));
  const fixedNow = new Date(overrides.now ?? '2026-10-26T12:00:00.000Z');
  let successfulRenames = 0;

  const checkWriteTarget = async (path) => {
    const target = await realpathIncludingDangling(path);
    for (const blockedPath of writeFailurePaths) {
      const realBlockedPath = await realpathIncludingDangling(blockedPath);
      if (isUnderPath(target, realBlockedPath)) throw accessDenied(path);
    }
  };
  const stdin = new Proxy(Object.create(null), {
    get() {
      throw new Error('stdin must not be read');
    },
    set() {
      throw new Error('stdin must not be accessed');
    },
  });

  const writeGlobalSettings = (settings) => writeFixture(
    join(piCodingAgentDir, 'settings.json'), settings,
  );
  const writeProjectSettings = (settings) => writeFixture(
    join(cwd, '.pi', 'settings.json'), settings,
  );
  const readGlobalSettings = async () => parsePiSettings(
    await readFileFromFs(join(piCodingAgentDir, 'settings.json'), 'utf8'),
  );

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
    cwd,
    tmpdir: temporaryDirectory,
    readFile: async (path) => {
      try {
        return await readFileFromFs(path, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return { notFound: true };
        throw error;
      }
    },
    readBytes: async (path) => {
      try {
        return await readFileFromFs(path);
      } catch (error) {
        if (error.code === 'ENOENT') return { notFound: true };
        throw error;
      }
    },
    lstat: (path) => fileFacts(lstatOnFs, path),
    stat: (path) => fileFacts(statOnFs, path),
    realpath: realpathIncludingDangling,
    mkdir: async (path, options = {}) => {
      await checkWriteTarget(path);
      return mkdirOnFs(path, options);
    },
    writeFile: async (path, bytes, options = {}) => {
      await checkWriteTarget(path);
      return writeFile(path, bytes, options);
    },
    rename: async (from, to) => {
      await checkWriteTarget(to);
      await renameOnFs(from, to);
      successfulRenames += 1;
      if (successfulRenames === overrides.abortAfterRenames) {
        abortController.abort('SIGINT');
      }
    },
    rm: (path) => rmOnFs(path, { force: true }),
    chmod: (path, mode) => chmodOnFs(path, mode),
    now: () => new Date(fixedNow),
    runner: async (command, args = [], options = {}) => {
      runnerCalls.push({ command, args: [...args], options });
      let result;
      if (runnerResults.length > 0) {
        result = runnerResults.shift();
      } else {
        if (command === 'pi') {
          const failure = fakePi.failures?.find((candidate) => (
            candidate.subcommand === args[0] && candidate.source === args[1]
          ));
          if (failure) {
            const notFound = failure.notFound === true;
            result = {
              code: notFound ? null : failure.code ?? 1,
              signal: null,
              stdout: failure.stdout ?? '',
              stderr: failure.stderr ?? '',
              ...(notFound ? { notFound: true } : {}),
            };
          }
        }
        if (!result && command === 'pi' && args[0] === '--version') {
          result = { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' };
        } else if (!result && command === 'pi' && args[0] === 'update') {
          result = { code: 0, signal: null, stdout: `Updated ${args[1]}\n`, stderr: '' };
        } else if (!result && command === 'pi' && args[0] === 'install') {
          await installGitFixture(piCodingAgentDir, args[1]);
          result = { code: 0, signal: null, stdout: `Installed ${args[1]}\n`, stderr: '' };
        } else if (!result && command === 'pi' && args[0] === 'remove') {
          await removeFixture(piCodingAgentDir, args[1]);
          result = { code: 0, signal: null, stdout: `Removed ${args[1]}\n`, stderr: '' };
        }
        result ??= { code: 0, signal: null, stdout: '', stderr: '' };
      }

      if (fakePi.abortAfterCall === runnerCalls.length) {
        abortController.abort(fakePi.abortReason ?? 'SIGINT');
      }
      return result;
    },
    signal: abortController.signal,
  };

  return {
    host,
    home,
    piCodingAgentDir,
    cwd,
    tmpdir: temporaryDirectory,
    stdout,
    stderr,
    runnerCalls,
    runnerResults,
    abortController,
    writeGlobalSettings,
    writeProjectSettings,
    readGlobalSettings,
  };
}
