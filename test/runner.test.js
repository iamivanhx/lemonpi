import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runner } from '../bin/runner.js';

test('runner captures child stdout and stderr and reports its exit code', async () => {
  const result = await runner(process.execPath, [
    '-e',
    'process.stdout.write("child stdout"); process.stderr.write("child stderr"); process.exit(7)',
  ]);

  assert.equal(result.stdout, 'child stdout');
  assert.equal(result.stderr, 'child stderr');
  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
});

test('runner gives a child immediate stdin EOF', { timeout: 3000 }, async () => {
  const result = await runner(process.execPath, [
    '-e',
    'process.stdin.once("end", () => process.stdout.write("stdin eof")); process.stdin.resume()',
  ], { timeout: 2000 });

  assert.equal(result.stdout, 'stdin eof');
  assert.equal(result.code, 0);
});

test('runner reports a missing executable as notFound', async () => {
  const result = await runner(`lemonpi-missing-command-${process.pid}`, []);

  assert.equal(result.notFound, true);
  assert.equal(result.code, null);
  assert.equal(result.signal, null);
});

test('runner terminates a child when its timeout expires', { timeout: 3000 }, async () => {
  const result = await runner(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 50 });

  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('runner terminates a child when its abort signal fires', { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const run = runner(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  const result = await run;

  assert.equal(result.code, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('runner bounds shutdown when an escaped descendant retains output pipes', { timeout: 4000 }, async () => {
  const result = await runner(process.execPath, ['-e', `
    const child = require('node:child_process').spawn(process.execPath, [
      '-e', 'process.stdout.write("escaped-ready"); setInterval(() => {}, 1000)',
    ], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    process.stdout.write(String(child.pid) + '\\n');
    child.unref();
  `], { timeout: 1000 });

  const descendantPid = Number(result.stdout.split('\n')[0]);
  try {
    assert.match(result.stdout, /escaped-ready/);
    assert.equal(result.code, 0);
  } finally {
    try {
      process.kill(descendantPid, 'SIGKILL');
    } catch (error) {
      // Cleanup may race with descendant exit; other signal errors must fail the test.
      if (error.code !== 'ESRCH') throw error;
    }
  }
});

test('runner retains the error name and code for a non-executable command', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lemonpi-runner-'));
  const executable = join(directory, 'not-executable');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(executable, 'non-executable fixture');
  await chmod(executable, 0o600);

  const result = await runner(executable, []);

  assert.equal(result.code, null);
  assert.match(result.error, /Error/);
  assert.match(result.error, /EACCES/);
  assert.equal(result.notFound, undefined);
});

test('runner starts a child in the requested working directory', async () => {
  const result = await runner(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: tmpdir() });

  assert.equal(result.stdout, await realpath(tmpdir()));
  assert.equal(result.code, 0);
});
