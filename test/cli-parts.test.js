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

test('an interrupted part prevents later parts and summarizes its collected items', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  let secondPartCalls = 0;
  let announcePartStarted;
  let finishPart;
  const partStarted = new Promise((resolve) => { announcePartStarted = resolve; });
  const finishRunningPart = new Promise((resolve) => { finishPart = resolve; });
  const parts = [
    {
      name: 'A',
      commands: ['install'],
      run: async () => {
        announcePartStarted();
        await finishRunningPart;
        return [{ name: 'A item', kind: 'action', outcome: 'changed' }];
      },
    },
    {
      name: 'B',
      commands: ['install'],
      run: async () => {
        secondPartCalls += 1;
        return [{ name: 'B item', kind: 'action', outcome: 'changed' }];
      },
    },
  ];

  const execution = run(['install'], fake.host, { parts });
  await partStarted;
  fake.abortController.abort('SIGINT');
  finishPart();
  const code = await execution;

  assert.equal(secondPartCalls, 0);
  assert.equal(code, 130);
  assert.match(fake.stdout.text, /interrupted/i);
  assert.match(fake.stdout.text, /A item/);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130 means lemonpi stopped on SIGINT/);
  assert.doesNotMatch(fake.stdout.text, /B item/);
});

test('SIGTERM interrupts a running part with exit 143', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  let secondPartCalls = 0;
  const parts = [
    {
      name: 'A',
      commands: ['install'],
      run: async () => {
        fake.abortController.abort('SIGTERM');
        return [{ name: 'A item', kind: 'action', outcome: 'changed' }];
      },
    },
    {
      name: 'B',
      commands: ['install'],
      run: async () => {
        secondPartCalls += 1;
        return [];
      },
    },
  ];

  const code = await run(['install'], fake.host, { parts });

  assert.equal(secondPartCalls, 0);
  assert.equal(code, 143);
  assert.match(fake.stdout.text, /interrupted/);
  assert.match(fake.stdout.text, /A item/);
  assert.match(fake.stdout.text, /Result: interrupted — exit 143 means lemonpi stopped on SIGTERM/);
});

test('an abort during the prerequisite probe interrupts before any part starts', async (t) => {
  const fake = createFakeHost(t);
  let secondProbeOptions;
  let partCalls = 0;
  fake.host.runner = async (command, args, options) => {
    secondProbeOptions = options;
    fake.abortController.abort('SIGTERM');
    return { code: null, signal: 'SIGTERM', stdout: '', stderr: '' };
  };
  const parts = [{
    name: 'never started',
    commands: ['install'],
    run: async () => {
      partCalls += 1;
      return [];
    },
  }];

  const code = await run(['install'], fake.host, { parts });

  assert.equal(code, 143);
  assert.equal(secondProbeOptions?.signal, fake.host.signal);
  assert.equal(partCalls, 0);
  assert.match(fake.stdout.text, /interrupted/);
  assert.match(fake.stdout.text, /Result: interrupted — exit 143 means lemonpi stopped on SIGTERM/);
  assert.doesNotMatch(fake.stdout.text, /Result: failed/);
});

test('an abort before run starts launches no prerequisite child or part', async (t) => {
  const fake = createFakeHost(t);
  fake.abortController.abort('SIGINT');
  let partCalls = 0;
  const parts = [{
    name: 'never started',
    commands: ['status'],
    run: async () => {
      partCalls += 1;
      return [];
    },
  }];

  const code = await run(['status'], fake.host, { parts });

  assert.deepEqual(fake.runnerCalls, []);
  assert.equal(partCalls, 0);
  assert.equal(code, 130);
  assert.match(fake.stdout.text, /interrupted/);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130 means lemonpi stopped on SIGINT/);
});

test('interrupted inventory summaries retain collected items and signal result', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  let laterPartCalls = 0;
  const parts = [
    {
      name: 'inventory A',
      commands: ['status'],
      run: async () => {
        fake.abortController.abort('SIGINT');
        return [{ name: 'A setting', kind: 'inventory', outcome: 'ok' }];
      },
    },
    {
      name: 'inventory B',
      commands: ['status'],
      run: async () => {
        laterPartCalls += 1;
        return [];
      },
    },
  ];

  const code = await run(['status'], fake.host, { parts });

  assert.equal(code, 130);
  assert.equal(laterPartCalls, 0);
  assert.match(fake.stdout.text, /A setting: ok/);
  assert.match(fake.stdout.text, /interrupted/);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130 means lemonpi stopped on SIGINT/);
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

test('status lists every inventory item exactly once with its outcome', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  const items = [
    { name: 'managed package', kind: 'inventory', outcome: 'ok' },
    { name: 'owned setting', kind: 'inventory', outcome: 'drift' },
    { name: 'shipped file', kind: 'inventory', outcome: 'unknown' },
  ];
  const part = { name: 'inventory', commands: ['status'], run: async () => items };

  const code = await run(['status'], fake.host, { parts: [part] });

  assert.equal(code, 1);
  assert.ok(fake.stdout.text.startsWith('lemonpi status — Pi 1.4.0\n'));
  assert.equal(
    fake.stdout.text.trimEnd().split('\n').at(-1),
    'Result: partial — exit 1 means the inventory has drift.',
  );
  for (const { name, outcome } of items) {
    assert.equal(fake.stdout.text.split(name).length - 1, 1, `${name} should appear once`);
    assert.ok(fake.stdout.text.includes(`${name}: ${outcome}`), `${name} should show ${outcome}`);
  }
});

test('status shows the reason for a drifted inventory item', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  const part = {
    name: 'inventory',
    commands: ['status'],
    run: async () => [{
      name: 'managed package',
      kind: 'inventory',
      outcome: 'drift',
      reason: '`install` restores it',
    }],
  };

  await run(['status'], fake.host, { parts: [part] });

  assert.ok(fake.stdout.text.includes('managed package: drift — `install` restores it'));
});

test('status lists notices in their own section after inventory', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  const part = {
    name: 'inventory',
    commands: ['status'],
    run: async () => [
      { name: 'managed package', kind: 'inventory', outcome: 'ok' },
      { name: 'unmanaged package', kind: 'notice', reason: 'preserved' },
    ],
  };

  await run(['status'], fake.host, { parts: [part] });

  const output = fake.stdout.text;
  assert.ok(output.includes('Notices:'));
  assert.ok(output.indexOf('Inventory:') < output.indexOf('Notices:'));
  assert.ok(output.indexOf('unmanaged package: preserved') > output.indexOf('Notices:'));
  assert.ok(output.indexOf('unmanaged package: preserved') < output.indexOf('Result:'));
  assert.equal(output.split('unmanaged package').length - 1, 1);
});

test('doctor includes readiness while status hides the same readiness item', async (t) => {
  const part = {
    name: 'inventory and readiness',
    commands: ['status', 'doctor'],
    run: async () => [
      { name: 'owned setting', kind: 'inventory', outcome: 'ok' },
      { name: 'unmanaged package', kind: 'notice', reason: 'preserved' },
      { name: 'runtime check', kind: 'readiness', outcome: 'warning', reason: 'restart required' },
    ],
  };
  const status = createFakeHost(t, { runnerResults: [passingPi] });
  const doctor = createFakeHost(t, { runnerResults: [passingPi] });

  await run(['status'], status.host, { parts: [part] });
  await run(['doctor'], doctor.host, { parts: [part] });

  assert.ok(status.stdout.text.startsWith('lemonpi status — Pi 1.4.0\n'));
  assert.ok(doctor.stdout.text.startsWith('lemonpi doctor — Pi 1.4.0\n'));
  assert.doesNotMatch(status.stdout.text, /Readiness:|runtime check/);
  assert.ok(doctor.stdout.text.includes('Readiness:'));
  assert.ok(doctor.stdout.text.includes('runtime check: Warning — restart required'));
  assert.ok(doctor.stdout.text.indexOf('Notices:') < doctor.stdout.text.indexOf('Readiness:'));
  assert.ok(doctor.stdout.text.indexOf('Readiness:') < doctor.stdout.text.indexOf('Result:'));
});

test('status and doctor exit codes follow inventory outcomes', async (t) => {
  const runWithItems = async (command, items) => {
    const fake = createFakeHost(t, { runnerResults: [passingPi] });
    const part = { name: 'outcomes', commands: [command], run: async () => items };
    const code = await run([command], fake.host, { parts: [part] });
    return { code, output: fake.stdout.text };
  };

  const allOk = await runWithItems('status', [
    { name: 'managed package', kind: 'inventory', outcome: 'ok' },
  ]);
  assert.equal(allOk.code, 0);
  assert.equal(
    allOk.output.trimEnd().split('\n').at(-1),
    'Result: ok — exit 0 means the run completed successfully.',
  );
  assert.equal((await runWithItems('status', [
    { name: 'managed package', kind: 'inventory', outcome: 'drift' },
  ])).code, 1);
  const failed = await runWithItems('status', [
    { name: 'managed package', kind: 'inventory', outcome: 'failed' },
    { name: 'owned setting', kind: 'inventory', outcome: 'drift' },
  ]);
  assert.equal(failed.code, 2);
  assert.equal(
    failed.output.trimEnd().split('\n').at(-1),
    'Result: failed — exit 2 means a prerequisite or inventory item failed.',
  );
  assert.equal((await runWithItems('doctor', [
    { name: 'unverified check', kind: 'inventory', outcome: 'unknown' },
    { name: 'deferred check', kind: 'inventory', outcome: 'skipped' },
    { name: 'unmanaged package', kind: 'notice', reason: 'preserved' },
    { name: 'runtime check', kind: 'readiness', outcome: 'warning', reason: 'restart required' },
  ])).code, 0);
});

test('inventory color follows TTY and NO_COLOR rules', async (t) => {
  const part = {
    name: 'inventory',
    commands: ['status'],
    run: async () => [{ name: 'managed package', kind: 'inventory', outcome: 'drift' }],
  };
  const nonTty = createFakeHost(t, { runnerResults: [passingPi] });
  const tty = createFakeHost(t, { stdoutTTY: true, runnerResults: [passingPi] });
  delete tty.host.env.NO_COLOR;
  const noColor = createFakeHost(t, {
    stdoutTTY: true,
    env: { NO_COLOR: '' },
    runnerResults: [passingPi],
  });

  await run(['status'], nonTty.host, { parts: [part] });
  await run(['status'], tty.host, { parts: [part] });
  await run(['status'], noColor.host, { parts: [part] });

  assert.doesNotMatch(nonTty.stdout.text, /\u001b\[/);
  assert.match(tty.stdout.text, /\u001b\[/);
  assert.doesNotMatch(noColor.stdout.text, /\u001b\[/);
});

test('status and doctor without parts retain the Pi-only summary', async (t) => {
  const status = createFakeHost(t, { runnerResults: [passingPi] });
  const doctor = createFakeHost(t, { runnerResults: [passingPi] });
  const missingPi = createFakeHost(t, {
    runnerResults: [{ notFound: true, code: null, signal: null, stdout: '', stderr: '' }],
  });

  await run(['status'], status.host);
  await run(['doctor'], doctor.host);
  const missingPiCode = await run(['status'], missingPi.host);

  for (const output of [status.stdout.text, doctor.stdout.text]) {
    assert.match(output, /Pi: ok \(1\.4\.0\)/);
    assert.doesNotMatch(output, /Inventory:|Notices:|Readiness:/);
  }
  assert.equal(missingPiCode, 2);
  assert.match(missingPi.stdout.text, /Pi: failed/);
  assert.doesNotMatch(missingPi.stdout.text, /Inventory:|Notices:|Readiness:/);
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
  const dryRunItems = async (items) => {
    const host = createFakeHost(t, { runnerResults: [passingPi] });
    const itemPart = { name: 'dry-run failures', commands: ['install'], run: async () => items };
    return run(['install', '--dry-run'], host.host, { parts: [itemPart] });
  };
  assert.equal(await dryRunItems([requiredFailure]), 0);
  assert.equal(await dryRunItems([optionalFailure]), 0);
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

test('install --dry-run labels changed and skipped items as an unchanged preview', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });
  const part = {
    name: 'preview',
    commands: ['install'],
    run: async () => [
      { name: 'preview package', kind: 'action', outcome: 'changed' },
      { name: 'skipped package', kind: 'action', outcome: 'skipped' },
    ],
  };

  await run(['install', '--dry-run'], fake.host, { parts: [part] });

  assert.match(fake.stdout.text, /lemonpi install — Pi 1\.4\.0 — dry run \(nothing was changed\)/);
  assert.match(fake.stdout.text, /Would change:\n  - preview package/);
  assert.match(fake.stdout.text, /Would skip:\n  - skipped package/);

  const normal = createFakeHost(t, { runnerResults: [passingPi] });
  const normalCode = await run(['install'], normal.host, { parts: [part] });

  assert.equal(normalCode, 0);
  assert.match(normal.stdout.text, /Changed:/);
  assert.match(normal.stdout.text, /Skipped:/);
  assert.doesNotMatch(normal.stdout.text, /Would change|Would skip|dry run/);
});

test('update and skills --dry-run use the exceptions preview summary', async (t) => {
  const part = {
    name: 'preview',
    commands: ['update', 'skills'],
    run: async () => [
      { name: 'preview package', kind: 'action', outcome: 'changed' },
      { name: 'skipped package', kind: 'action', outcome: 'skipped' },
    ],
  };

  for (const command of ['update', 'skills']) {
    const fake = createFakeHost(t, { runnerResults: [passingPi] });
    const code = await run([command, '--dry-run'], fake.host, { parts: [part] });

    assert.equal(code, 0, `${command} preview exits successfully`);
    assert.match(fake.stdout.text, new RegExp(`lemonpi ${command} — Pi 1\\.4\\.0 — dry run \\(nothing was changed\\)`));
    assert.match(fake.stdout.text, /Would change:/);
    assert.match(fake.stdout.text, /Would skip:/);
  }
});
