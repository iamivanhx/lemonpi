#!/usr/bin/env node
import { homedir } from 'node:os';
import { run } from '../src/cli.js';

const env = { ...process.env };
if (!env.HOME) env.HOME = homedir();

const host = {
  env,
  platform: process.platform,
  nodeVersion: process.version,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  runner: async () => ({ code: 0, signal: null, stdout: '', stderr: '' }),
  signal: new AbortController().signal,
};

process.exitCode = await run(process.argv.slice(2), host);
