import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';

const managedSources = [
  'npm:@tintinweb/pi-subagents',
  'git:github.com/earendil-works/pi-review',
  'npm:@juicesharp/rpiv-todo',
  'git:github.com/earendil-works/pi-claude-code',
  'npm:@juicesharp/rpiv-ask-user-question',
  'npm:pi-web-access',
  'npm:pi-footer',
  'npm:@heyhuynhgiabuu/pi-pretty',
];
const replacedSource = 'npm:pi-subagents';
const packageCalls = (fake) => fake.runnerCalls.slice(1);

function assertScopedUpdateCalls(fake, sources) {
  const calls = packageCalls(fake);
  for (const { command, args, options } of calls) {
    assert.equal(command, 'pi');
    assert.equal(args.at(-1), '--no-approve');
    assert.equal(options.cwd, fake.tmpdir);
    assert.equal(options.signal, fake.host.signal);
  }
  assert.deepEqual(calls.filter(({ args }) => args[0] === 'update').map(({ command, args }) => [
    command, args,
  ]), sources.map((source) => [
    'pi', ['update', source, '--no-approve'],
  ]));
}

test('update installs a missing package immediately before updating it and reports changed', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    packages: [
      ...managedSources.slice(0, 5),
      managedSources[6],
      { source: `${managedSources[7]}@0.6.29`, extensions: ['extensions/*.ts'], autoload: false },
    ],
  });

  const code = await run(['update'], fake.host);

  assert.equal(code, 0);
  const calls = packageCalls(fake).map(({ args }) => args);
  assert.deepEqual(calls, [
    ...managedSources.slice(0, 5).map((source) => ['update', source, '--no-approve']),
    ['install', managedSources[5], '--no-approve'],
    ['update', managedSources[5], '--no-approve'],
    ['update', managedSources[6], '--no-approve'],
    ['install', managedSources[7], '--no-approve'],
    ['update', managedSources[7], '--no-approve'],
  ]);
  const installIndex = calls.findIndex((args) => args[0] === 'install' && args[1] === managedSources[5]);
  assert.deepEqual(calls[installIndex + 1], ['update', managedSources[5], '--no-approve']);
  assert.ok(fake.stdout.text.includes('web-access (npm:pi-web-access): installed'));
  assert.ok(fake.stdout.text.includes(
    `pretty (${managedSources[7]}): unpinned 0.6.29 → ${managedSources[7]}`,
  ));
  assert.match(fake.stdout.text, /Changed:/);
  assertScopedUpdateCalls(fake, managedSources);
});

test('optional update failures preserve upgrade hints and later packages still update', async (t) => {
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'update',
        source: managedSources[5],
        code: 23,
        stdout: 'optional update output',
        stderr: 'Pi must be upgraded before this package can update',
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: managedSources });

  const code = await run(['update'], fake.host);

  assert.equal(code, 1);
  assert.ok(fake.stdout.text.includes(`pi update ${managedSources[5]} --no-approve`));
  assert.ok(fake.stdout.text.includes('optional update output'));
  assert.ok(fake.stdout.text.includes('Pi must be upgraded before this package can update'));
  assertScopedUpdateCalls(fake, managedSources);
  assert.ok(fake.stdout.text.includes('OK: 7 items'));
});

test('update stops after an optional mutation makes global settings unreadable', async (t) => {
  const secret = 'settings-reread-secret';
  const fake = createFakeHost(t, {
    env: { LEMON_ACCESS_TOKEN: secret },
    fakePi: {
      failures: [{
        subcommand: 'update',
        source: managedSources[5],
        code: 23,
        stdout: 'optional update failure output',
        stderr: `Pi upgrade required ${secret}`,
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: managedSources });
  const runner = fake.host.runner;
  fake.host.runner = async (command, args, options) => {
    const result = await runner(command, args, options);
    if (command === 'pi' && args[0] === 'update' && args[1] === managedSources[5]) {
      await writeFile(join(fake.piCodingAgentDir, 'settings.json'), '{"packages": [');
    }
    return result;
  };

  const code = await run(['update'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Pi settings: can't parse/);
  assert.ok(fake.stdout.text.includes(`pi update ${managedSources[5]} --no-approve`));
  assert.ok(fake.stdout.text.includes('optional update failure output'));
  assert.ok(fake.stdout.text.includes('Pi upgrade required [redacted]'));
  assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
  assert.match(fake.stdout.text, /OK: 5 items/);
  assert.deepEqual(packageCalls(fake).map(({ args }) => args), managedSources
    .slice(0, 6)
    .map((source) => ['update', source, '--no-approve']));
});

test('required update failures set exit 2 and do not stop later package updates', async (t) => {
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'update',
        source: managedSources[0],
        code: 23,
        stderr: 'required update failed',
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: managedSources });

  const code = await run(['update'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('required update failed'));
  assertScopedUpdateCalls(fake, managedSources);
});

test('--skip review prevents install and update for that package', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: managedSources });

  const code = await run(['update', '--skip', 'review'], fake.host);

  assert.equal(code, 0);
  assert.ok(fake.stdout.text.includes('review (git:github.com/earendil-works/pi-review): held back by --skip'));
  assert.ok(packageCalls(fake).every(({ args }) => args[1] !== managedSources[1]));
  assertScopedUpdateCalls(fake, managedSources.filter((_, index) => index !== 1));
});

test('duplicated package is failed without an update while other managed packages proceed', async (t) => {
  const fake = createFakeHost(t);
  const packages = [...managedSources, 'npm:pi-footer@1.0.0'];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['update'], fake.host);

  assert.equal(code, 1);
  assert.ok(fake.stdout.text.includes(
    'footer (npm:pi-footer): declared 2 times in global settings; remove the extra declarations',
  ));
  assertScopedUpdateCalls(fake, managedSources.filter((source) => source !== 'npm:pi-footer'));
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('abort after the first package update prevents every later package call', async (t) => {
  const fake = createFakeHost(t, { fakePi: { abortAfterCall: 2 } });
  await fake.writeGlobalSettings({ packages: managedSources });

  const code = await run(['update'], fake.host);

  assert.equal(code, 130);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['update', managedSources[0], '--no-approve']],
  ]);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130/);
});

test('update dry-run combines reconciliation and update previews without mutating settings', async (t) => {
  const fake = createFakeHost(t);
  const packages = [
    replacedSource,
    { source: `${managedSources[0]}@^0.22.0`, extensions: ['extensions/*.ts'], autoload: false },
    ...managedSources.slice(1, 5),
    'npm:pi-footer',
    'npm:pi-footer@1.0.0',
    { source: `${managedSources[7]}@0.6.29`, skills: ['skills/*.md'], autoload: false },
  ];
  await fake.writeGlobalSettings({ packages });
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const before = await readFile(settingsPath);

  const code = await run(['update', '--dry-run', '--skip', 'review'], fake.host);

  assert.equal(code, 0);
  assert.ok(fake.stdout.text.includes(
    `subagents (${managedSources[0]}): would migrate ${replacedSource} → ${managedSources[0]}; would update`,
  ));
  assert.ok(fake.stdout.text.includes('review (git:github.com/earendil-works/pi-review): held back by --skip'));
  assert.ok(fake.stdout.text.includes('web-access (npm:pi-web-access): would install; would update'));
  assert.ok(fake.stdout.text.includes(
    `pretty (${managedSources[7]}): would unpin 0.6.29 → ${managedSources[7]}; would update`,
  ));
  assert.ok(fake.stdout.text.includes(
    'footer (npm:pi-footer): declared 2 times in global settings; remove the extra declarations',
  ));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual(await readFile(settingsPath), before);
});

test('unreadable global settings stop update before any package command', async (t) => {
  const fake = createFakeHost(t);
  await writeFile(join(fake.piCodingAgentDir, 'settings.json'), '{"packages": [');

  const code = await run(['update'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Pi settings: can't parse/);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
});

test('failed install or unpin suppresses that package update while later packages continue', async (t) => {
  const missing = createFakeHost(t, {
    fakePi: {
      failures: [{ subcommand: 'install', source: managedSources[5], code: 17, stderr: 'install failed' }],
    },
  });
  await missing.writeGlobalSettings({ packages: managedSources.filter((_, index) => index !== 5) });

  const missingCode = await run(['update'], missing.host);

  assert.equal(missingCode, 1);
  const missingCalls = packageCalls(missing).map(({ args }) => args);
  assert.ok(missingCalls.some((args) => args[0] === 'install' && args[1] === managedSources[5]));
  assert.ok(!missingCalls.some((args) => args[0] === 'update' && args[1] === managedSources[5]));
  assert.ok(missingCalls.some((args) => args[0] === 'update' && args[1] === managedSources[7]));

  const pinned = createFakeHost(t, {
    fakePi: {
      failures: [{ subcommand: 'install', source: managedSources[7], code: 17, stderr: 'unpin failed' }],
    },
  });
  await pinned.writeGlobalSettings({
    packages: [...managedSources.slice(0, 7), `${managedSources[7]}@0.6.29`],
  });

  const pinnedCode = await run(['update'], pinned.host);

  assert.equal(pinnedCode, 1);
  const pinnedCalls = packageCalls(pinned).map(({ args }) => args);
  assert.ok(pinnedCalls.some((args) => args[0] === 'install' && args[1] === managedSources[7]));
  assert.ok(!pinnedCalls.some((args) => args[0] === 'update' && args[1] === managedSources[7]));
});

test('update unpins a pinned object declaration and keeps its tuning fields', async (t) => {
  const fake = createFakeHost(t);
  const pinned = {
    source: `${managedSources[7]}@0.6.29`,
    extensions: ['extensions/*.ts'],
    skills: ['skills/*.md'],
    autoload: false,
  };
  await fake.writeGlobalSettings({ packages: [...managedSources.slice(0, 7), pinned] });

  const code = await run(['update'], fake.host);

  assert.equal(code, 0);
  const calls = packageCalls(fake).map(({ args }) => args);
  assert.deepEqual(calls.slice(-2), [
    ['install', managedSources[7], '--no-approve'],
    ['update', managedSources[7], '--no-approve'],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...managedSources.slice(0, 7),
    { ...pinned, source: managedSources[7] },
  ]);
  assert.ok(fake.stdout.text.includes(
    `pretty (${managedSources[7]}): unpinned 0.6.29 → ${managedSources[7]}`,
  ));
});

test('update safely installs, verifies and removes before updating a replacement', async (t) => {
  const fake = createFakeHost(t);
  const replacement = {
    source: `${managedSources[0]}@^0.22.0`,
    extensions: ['extensions/*.ts'],
    skills: ['skills/*.md'],
    autoload: false,
  };
  await fake.writeGlobalSettings({ packages: [replacedSource, replacement, ...managedSources.slice(1)] });

  const code = await run(['update'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(packageCalls(fake).map(({ args }) => args), [
    ['install', managedSources[0], '--no-approve'],
    ['remove', replacedSource, '--no-approve'],
    ...managedSources.map((source) => ['update', source, '--no-approve']),
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    { ...replacement, source: managedSources[0] },
    ...managedSources.slice(1),
  ]);
  assert.ok(fake.stdout.text.includes(
    `subagents (${managedSources[0]}): migrated ${replacedSource} → ${managedSources[0]}`,
  ));
});

test('failed migration suppresses subagents update while later packages still update', async (t) => {
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'remove',
        source: replacedSource,
        code: 23,
        stderr: 'migration removal failed',
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: [replacedSource, ...managedSources.slice(1)] });

  const code = await run(['update'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('migration removal failed'));
  const calls = packageCalls(fake).map(({ args }) => args);
  assert.deepEqual(calls.slice(0, 2), [
    ['install', managedSources[0], '--no-approve'],
    ['remove', replacedSource, '--no-approve'],
  ]);
  assert.ok(!calls.some((args) => args[0] === 'update' && args[1] === managedSources[0]));
  assertScopedUpdateCalls(fake, managedSources.slice(1));
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    replacedSource,
    ...managedSources.slice(1),
    managedSources[0],
  ]);
});

test('failed replacement install suppresses subagents update while later packages still update', async (t) => {
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'install',
        source: managedSources[0],
        code: 23,
        stderr: 'replacement install failed',
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: [replacedSource, ...managedSources.slice(1)] });

  const code = await run(['update'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('replacement install failed'));
  const calls = packageCalls(fake).map(({ args }) => args);
  assert.deepEqual(calls[0], ['install', managedSources[0], '--no-approve']);
  assert.ok(!calls.some((args) => args[0] === 'update' && args[1] === managedSources[0]));
  assertScopedUpdateCalls(fake, managedSources.slice(1));
  assert.deepEqual((await fake.readGlobalSettings()).packages, [replacedSource, ...managedSources.slice(1)]);
});

test('update reports notices but preserves and never acts on unmanaged or project declarations', async (t) => {
  const fake = createFakeHost(t);
  const alternative = 'git:github.com/wobondar/pi-footer';
  const unmanaged = 'npm:pi-experiment';
  const packages = [...managedSources.filter((_, index) => index !== 6), alternative, unmanaged];
  await fake.writeGlobalSettings({ packages });
  await fake.writeProjectSettings({ packages: ['npm:pi-footer'] });

  const code = await run(['update'], fake.host);

  assert.equal(code, 0);
  assert.ok(fake.stdout.text.includes(`- ${alternative}: footer declared from a different source type`));
  assert.ok(fake.stdout.text.includes(`- ${unmanaged}: unmanaged package`));
  assert.ok(fake.stdout.text.includes('- npm:pi-footer: project-scope declaration of footer'));
  const calls = packageCalls(fake).map(({ args }) => args);
  assert.ok(calls.every((args) => ![alternative, unmanaged].includes(args[1])));
  assert.ok(calls.some((args) => args[0] === 'install' && args[1] === managedSources[6]));
  assert.ok(calls.some((args) => args[0] === 'update' && args[1] === managedSources[6]));
  assert.deepEqual((await fake.readGlobalSettings()).packages, [...packages, managedSources[6]]);
});

test('Pi not-found and runner errors are reported and subsequent package updates continue', async (t) => {
  const notFound = createFakeHost(t, {
    fakePi: { failures: [{ subcommand: 'update', source: managedSources[0], notFound: true }] },
  });
  await notFound.writeGlobalSettings({ packages: managedSources });

  const notFoundCode = await run(['update'], notFound.host);

  assert.equal(notFoundCode, 2);
  assert.ok(notFound.stdout.text.includes(`pi update ${managedSources[0]} --no-approve`));
  assertScopedUpdateCalls(notFound, managedSources);

  const runnerError = createFakeHost(t, {
    env: { LEMON_TEST_SECRET: 'update-runner-secret' },
    runnerResults: [
      { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' },
      { code: null, signal: null, stdout: '', stderr: '', error: 'spawn denied update-runner-secret' },
    ],
  });
  await runnerError.writeGlobalSettings({ packages: managedSources });

  const runnerCode = await run(['update'], runnerError.host);

  assert.equal(runnerCode, 2);
  assert.ok(runnerError.stdout.text.includes('spawn denied [redacted]'));
  assert.doesNotMatch(runnerError.stdout.text, /update-runner-secret/);
  assertScopedUpdateCalls(runnerError, managedSources);
});
