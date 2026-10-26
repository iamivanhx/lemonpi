import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';

const passingPi = { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' };

test('parts run only for registered commands', async (t) => {
  const seen = [];
  const part = {
    name: 'updates',
    commands: ['update'],
    run: async ({ command }) => {
      seen.push(command);
      return [];
    },
  };

  const update = createFakeHost(t, { runnerResults: [passingPi] });
  const install = createFakeHost(t, { runnerResults: [passingPi] });
  await run(['update'], update.host, { parts: [part] });
  await run(['install'], install.host, { parts: [part] });

  assert.deepEqual(seen, ['update']);

  let invokedAfterMissingPi = false;
  const missingPi = createFakeHost(t, {
    runnerResults: [{ notFound: true, code: null, signal: null, stdout: '', stderr: '' }],
  });
  const refused = await run(['install'], missingPi.host, {
    parts: [{ name: 'install-only', commands: ['install'], run: async () => { invokedAfterMissingPi = true; return []; } }],
  });
  assert.equal(refused, 2);
  assert.equal(invokedAfterMissingPi, false);
  assert.match(missingPi.stdout.text, /Pi: failed/);

  const fullInstall = createFakeHost(t, { runnerResults: [passingPi] });
  const installed = await run(['install'], fullInstall.host, {
    parts: [{ name: 'stdin-safe', commands: ['install'], run: async () => [{ name: 'configured', kind: 'action', outcome: 'changed' }] }],
  });
  assert.equal(installed, 0);
  assert.match(fullInstall.stdout.text, /configured/);

  const order = [];
  const continued = createFakeHost(t, { runnerResults: [passingPi] });
  const afterRequiredFailure = await run(['install'], continued.host, {
    parts: [
      {
        name: 'required failure',
        commands: ['install'],
        run: async () => {
          order.push('first');
          return [{ name: 'required action', kind: 'action', outcome: 'failed', required: true }];
        },
      },
      {
        name: 'later part',
        commands: ['install'],
        run: async () => {
          order.push('second');
          return [];
        },
      },
    ],
  });
  assert.equal(afterRequiredFailure, 2);
  assert.deepEqual(order, ['first', 'second']);
});

test('parts receive parsed context and the injected agent directory', async (t) => {
  const contexts = [];
  const part = {
    name: 'context',
    commands: ['install'],
    run: async (context) => {
      contexts.push(context);
      return [];
    },
  };
  const configured = createFakeHost(t, { runnerResults: [passingPi] });
  configured.host.env.PI_CODING_AGENT_DIR = '/configured/pi-agent';
  const fallback = createFakeHost(t, { runnerResults: [passingPi] });
  delete fallback.host.env.PI_CODING_AGENT_DIR;

  await run(['install', '--skip', 'one,two', '--skip-skills', '--dry-run'], configured.host, { parts: [part] });
  await run(['install'], fallback.host, { parts: [part] });

  assert.deepEqual(contexts.map(({ command, flags, dryRun, agentDir, piVersion, runner, signal }) => ({
    command, flags, dryRun, agentDir, piVersion, runner, signal,
  })), [
    {
      command: 'install',
      flags: { skip: ['one', 'two'], skipSkills: true },
      dryRun: true,
      agentDir: '/configured/pi-agent',
      piVersion: '1.4.0',
      runner: configured.host.runner,
      signal: configured.host.signal,
    },
    {
      command: 'install',
      flags: { skip: [], skipSkills: false },
      dryRun: false,
      agentDir: `${fallback.home}/.pi/agent`,
      piVersion: '1.4.0',
      runner: fallback.host.runner,
      signal: fallback.host.signal,
    },
  ]);
});

test('a required failed action exits 2', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  const part = {
    name: 'required failure',
    commands: ['install'],
    run: async () => [{ name: 'required item', kind: 'action', outcome: 'failed', reason: 'could not install', required: true }],
  };

  const code = await run(['install'], fake.host, { parts: [part] });

  assert.equal(code, 2);

  const runItems = async (command, items) => {
    const host = createFakeHost(t, { runnerResults: [passingPi] });
    const itemPart = { name: 'cases', commands: [command], run: async () => items };
    return run([command], host.host, { parts: [itemPart] });
  };
  const optionalFailure = { name: 'optional', kind: 'action', outcome: 'failed', required: false };
  const requiredFailure = { name: 'required', kind: 'action', outcome: 'failed', required: true };
  assert.equal(await runItems('install', [optionalFailure]), 1);
  assert.equal(await runItems('install', [requiredFailure, optionalFailure]), 2);
  assert.equal(await runItems('install', [
    { name: 'warn', kind: 'action', outcome: 'warning' },
    { name: 'unknown', kind: 'action', outcome: 'unknown' },
    { name: 'skip', kind: 'action', outcome: 'skipped' },
    { name: 'notice', kind: 'notice' },
    { name: 'ready warning', kind: 'readiness', outcome: 'warning' },
    { name: 'ready unknown', kind: 'readiness', outcome: 'unknown' },
    { name: 'ready failed', kind: 'readiness', outcome: 'failed' },
  ]), 0);
});

test('install groups action exceptions and counts ok items with readiness last', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  const part = {
    name: 'summary',
    commands: ['install'],
    run: async () => [
      { name: 'changed package', kind: 'action', outcome: 'changed', reason: 'installed' },
      { name: 'skipped package', kind: 'action', outcome: 'skipped', reason: 'requested' },
      { name: 'warning package', kind: 'action', outcome: 'warning', reason: 'needs attention' },
      { name: 'unknown package', kind: 'action', outcome: 'unknown', reason: 'could not verify' },
      { name: 'failed package', kind: 'action', outcome: 'failed', reason: 'npm install foo\nnpm error: unavailable', required: true },
      ...['one', 'two', 'three', 'four', 'five'].map((name) => ({ name: `ok ${name}`, kind: 'action', outcome: 'ok' })),
      { name: 'unmanaged package', kind: 'notice', reason: 'preserved' },
      { name: 'Pi readiness', kind: 'readiness', outcome: 'warning', reason: 'restart required' },
    ],
  };

  await run(['install'], fake.host, { parts: [part] });

  const output = fake.stdout.text;
  const groupPositions = ['Changed:', 'Skipped:', 'Warning:', 'Unknown:', 'Failed:', 'Readiness:']
    .map((group) => output.indexOf(group));
  assert.ok(groupPositions.every((position) => position >= 0));
  assert.deepEqual(groupPositions, [...groupPositions].sort((left, right) => left - right));
  for (const detail of [
    'changed package: installed',
    'skipped package: requested',
    'warning package: needs attention',
    'unknown package: could not verify',
    'failed package: npm install foo',
    'npm error: unavailable',
    'Notices:',
    'unmanaged package: preserved',
    'Pi readiness: Warning — restart required',
  ]) {
    assert.ok(output.includes(detail), `summary should show ${detail}`);
  }
  assert.match(output, /OK: 5 items/);
  for (const name of ['ok one', 'ok two', 'ok three', 'ok four', 'ok five']) {
    assert.ok(!output.includes(name), `summary should collapse ${name}`);
  }

  const colorPart = { name: 'color', commands: ['install'], run: async () => [{ name: 'colored action', kind: 'action', outcome: 'changed' }] };
  const tty = createFakeHost(t, { stdoutTTY: true, runnerResults: [passingPi] });
  delete tty.host.env.NO_COLOR;
  await run(['install'], tty.host, { parts: [colorPart] });
  assert.match(tty.stdout.text, /\u001b\[/);

  const emptyNoColor = createFakeHost(t, {
    stdoutTTY: true,
    env: { NO_COLOR: '' },
    runnerResults: [passingPi],
  });
  await run(['install'], emptyNoColor.host, { parts: [colorPart] });
  assert.doesNotMatch(emptyNoColor.stdout.text, /\u001b\[/);

  const nonTty = createFakeHost(t, { runnerResults: [passingPi] });
  await run(['install'], nonTty.host, { parts: [colorPart] });
  assert.doesNotMatch(nonTty.stdout.text, /\u001b\[/);
});
