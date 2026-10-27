#!/usr/bin/env node
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
  writeFile as writeFileOnFs,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { checkNodeVersion } from '../src/prerequisites.js';
import { runner } from './runner.js';

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

  const absolutePath = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
  let current = parse(absolutePath).root;
  let pending = absolutePath.slice(current.length).split(sep).filter(Boolean);
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
    // Expand each link before processing later components, especially `..`.
    const root = parse(target).root;
    if (isAbsolute(target)) current = root;
    pending = target.slice(root.length).split(sep).filter(Boolean).concat(pending);
  }

  return current;
}

const runtime = checkNodeVersion(process.version);
if (!runtime.ok) {
  process.stderr.write(`${runtime.message}\n`);
  process.exitCode = 2;
} else {
  const { run } = await import('../src/cli.js');
  const env = { ...process.env };
  if (!env.HOME) env.HOME = homedir();

  const abortController = new AbortController();
  process.once('SIGINT', () => abortController.abort('SIGINT'));
  process.once('SIGTERM', () => abortController.abort('SIGTERM'));

  const host = {
    env,
    platform: process.platform,
    nodeVersion: process.version,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    runner,
    signal: abortController.signal,
    cwd: process.cwd(),
    tmpdir: tmpdir(),
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
    mkdir: (path, options) => mkdirOnFs(path, options),
    writeFile: (path, bytes, options) => writeFileOnFs(path, bytes, options),
    rename: (from, to) => renameOnFs(from, to),
    rm: (path) => rmOnFs(path, { force: true }),
    chmod: (path, mode) => chmodOnFs(path, mode),
    now: () => new Date(),
  };

  process.exitCode = await run(process.argv.slice(2), host);
}
