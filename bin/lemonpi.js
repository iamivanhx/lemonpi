#!/usr/bin/env node
import { readFile as readFileFromFs } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { checkNodeVersion } from '../src/prerequisites.js';
import { runner } from './runner.js';

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
  };

  process.exitCode = await run(process.argv.slice(2), host);
}
