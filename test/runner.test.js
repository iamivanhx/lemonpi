import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
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

test('runner starts a child in the requested working directory', async () => {
  const result = await runner(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: tmpdir() });

  assert.equal(result.stdout, await realpath(tmpdir()));
  assert.equal(result.code, 0);
});
