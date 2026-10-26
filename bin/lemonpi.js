#!/usr/bin/env node
import { homedir } from 'node:os';
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
  };

  process.exitCode = await run(process.argv.slice(2), host);
}
