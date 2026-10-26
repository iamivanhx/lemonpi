import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';

test('shared fake host supplies isolated homes, captured streams, runner, stdin, and abort control', async (t) => {
  const fake = createFakeHost(t, {
    platform: 'test-platform',
    nodeVersion: 'v22.19.0',
    runnerResults: [
      { code: 7, signal: null, stdout: 'captured out', stderr: 'captured err' },
      { notFound: true },
    ],
  });

  assert.ok(fake.host.env.HOME);
  assert.ok(fake.host.env.PI_CODING_AGENT_DIR);
  await access(fake.host.env.HOME);
  await access(fake.host.env.PI_CODING_AGENT_DIR);
  assert.equal(fake.host.platform, 'test-platform');
  assert.equal(fake.host.nodeVersion, 'v22.19.0');

  fake.stdout.isTTY = true;
  fake.stdout.write('hello');
  fake.stderr.write('problem');
  assert.equal(fake.stdout.isTTY, true);
  assert.equal(fake.stdout.text, 'hello');
  assert.equal(fake.stderr.text, 'problem');

  const result = await fake.host.runner('pi', ['--version']);
  assert.deepEqual(result, { code: 7, signal: null, stdout: 'captured out', stderr: 'captured err' });
  assert.deepEqual(fake.runnerCalls, [{ command: 'pi', args: ['--version'], options: {} }]);
  assert.deepEqual(await fake.host.runner('missing-command'), { notFound: true });
  assert.throws(() => fake.host.stdin.isTTY, /stdin must not be read/);
  assert.equal(fake.host.signal, fake.abortController.signal);
  fake.abortController.abort('SIGINT');
  assert.equal(fake.host.signal.reason, 'SIGINT');
});
