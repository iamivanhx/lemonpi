import assert from 'node:assert/strict';
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

test('status sanitizes a configured secret used as a git ref pin', async (t) => {
  const secret = 'branch-secret-value';
  const fake = createFakeHost(t, { env: { LEMON_SECRET_TOKEN: secret } });
  const packages = [...managedSources];
  packages[1] = `git:github.com/earendil-works/pi-review@${secret}`;
  await fake.writeGlobalSettings({ packages });

  const code = await run(['status'], fake.host);

  assert.ok(fake.stdout.text.includes(
    'review (git:github.com/earendil-works/pi-review): drift — pinned to [redacted] — `install` unpins it',
  ));
  assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
  assert.equal(code, 1);
});

test('install leaves an unpinned git spelling variation alone', async (t) => {
  const fake = createFakeHost(t);
  const packages = [...managedSources];
  packages[1] = 'https://github.com/earendil-works/pi-review.git';
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
  assert.equal(code, 0);
});

test('a second install after unpinning makes no package call', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    packages: [...managedSources.slice(0, -1), 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29'],
  });

  const firstCode = await run(['install'], fake.host);
  const firstPackageCalls = fake.runnerCalls.filter(({ args }) => args[0] !== '--version');
  const callsAfterFirst = fake.runnerCalls.length;
  const secondCode = await run(['install'], fake.host);
  const secondPackageCalls = fake.runnerCalls.slice(callsAfterFirst)
    .filter(({ args }) => args[0] !== '--version');

  assert.equal(firstCode, 0);
  assert.equal(secondCode, 0);
  assert.deepEqual(firstPackageCalls.map(({ args }) => args.slice(0, 2)), [
    ['install', managedSources[7]],
  ]);
  assert.deepEqual(secondPackageCalls, []);
  assert.deepEqual((await fake.readGlobalSettings()).packages, managedSources);
});

test('install --skip leaves a pinned package unchanged without a package call', async (t) => {
  const fake = createFakeHost(t);
  const packages = [...managedSources.slice(0, -1), 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29'];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install', '--skip', 'pretty'], fake.host);

  assert.ok(fake.stdout.text.includes(
    'pretty (npm:@heyhuynhgiabuu/pi-pretty): held back by --skip',
  ));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
  assert.equal(code, 0);
});

test('install dry-run previews unpinning without Pi package calls or fixture changes', async (t) => {
  const fake = createFakeHost(t);
  const packages = [...managedSources.slice(0, -1), 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29'];
  await fake.writeGlobalSettings({ packages });
  const before = await fake.readGlobalSettings();

  const code = await run(['install', '--dry-run'], fake.host);

  assert.ok(fake.stdout.text.includes(
    'pretty (npm:@heyhuynhgiabuu/pi-pretty): would unpin 0.6.29 → npm:@heyhuynhgiabuu/pi-pretty',
  ));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  assert.deepEqual(await fake.readGlobalSettings(), before);
  assert.equal(code, 0);
});

test('a successful Pi install that leaves a pin reports sanitized command diagnostics at catalog severity', async (t) => {
  const secret = 'pi-unpin-success-output-secret';
  for (const [id, index, pinnedSource, expectedCode] of [
    ['pretty', 7, 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29', 1],
    ['review', 1, 'git:github.com/earendil-works/pi-review@v1', 2],
  ]) {
    const fake = createFakeHost(t, {
      env: { LEMON_ACCESS_TOKEN: secret },
      runnerResults: [
        { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' },
        {
          code: 0,
          signal: null,
          stdout: 'Pi claimed the pinned package was installed',
          stderr: `Upgrade Pi before trying again: ${secret}`,
        },
      ],
    });
    const packages = [...managedSources];
    packages[index] = pinnedSource;
    await fake.writeGlobalSettings({ packages });

    const code = await run(['install'], fake.host);

    assert.ok(fake.stdout.text.includes(`${id} (${managedSources[index]}): still pinned after pi install`));
    assert.ok(fake.stdout.text.includes(`pi install ${managedSources[index]} --no-approve`));
    assert.ok(fake.stdout.text.includes('Pi claimed the pinned package was installed'));
    assert.ok(fake.stdout.text.includes('Upgrade Pi before trying again: [redacted]'));
    assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
    assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
    assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args), [[
      'install', managedSources[index], '--no-approve',
    ]]);
    assert.equal(code, expectedCode);
  }
});

test('failed Pi unpin calls report sanitized diagnostics and retain the pin', async (t) => {
  const secret = 'pi-unpin-output-secret';
  const fake = createFakeHost(t, {
    env: { LEMON_ACCESS_TOKEN: secret },
    fakePi: {
      failures: [{
        subcommand: 'install',
        source: managedSources[7],
        code: 23,
        stdout: 'unpin failed stdout',
        stderr: `unpin failed stderr ${secret}`,
      }],
    },
  });
  const packages = [...managedSources.slice(0, -1), `${managedSources[7]}@0.6.29`];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.equal(code, 1);
  assert.ok(fake.stdout.text.includes(
    `pi install ${managedSources[7]} --no-approve`,
  ));
  assert.ok(fake.stdout.text.includes('unpin failed stdout'));
  assert.ok(fake.stdout.text.includes('unpin failed stderr [redacted]'));
  assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args), [[
    'install', managedSources[7], '--no-approve',
  ]]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('install keeps filters and autoload on an object-form pinned declaration', async (t) => {
  const fake = createFakeHost(t);
  const packages = [
    ...managedSources.slice(0, -1),
    {
      source: 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29',
      extensions: ['extensions/*.ts'],
      skills: ['skills/*.md'],
      autoload: false,
    },
  ];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args), [[
    'install', managedSources[7], '--no-approve',
  ]]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...managedSources.slice(0, -1),
    {
      source: managedSources[7],
      extensions: ['extensions/*.ts'],
      skills: ['skills/*.md'],
      autoload: false,
    },
  ]);
  assert.equal(code, 0);
});

test('install unpins Git tag and slash-containing branch refs', async (t) => {
  for (const [ref, pin] of [['v1', 'v1'], ['feature/next', 'feature/next']]) {
    const fake = createFakeHost(t);
    const packages = [...managedSources];
    packages[1] = `git:github.com/earendil-works/pi-review@${ref}`;
    await fake.writeGlobalSettings({ packages });

    const code = await run(['install'], fake.host);

    assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args.slice(0, 2)), [
      ['install', managedSources[1]],
    ]);
    assert.deepEqual((await fake.readGlobalSettings()).packages, managedSources);
    assert.ok(fake.stdout.text.includes(`review (${managedSources[1]}): unpinned ${pin} → ${managedSources[1]}`));
    assert.equal(code, 0);
  }
});

test('install unpins a pinned npm declaration in place through canonical Pi install', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    packages: [...managedSources.slice(0, -1), 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29'],
  });

  const code = await run(['install'], fake.host);

  assert.deepEqual(fake.runnerCalls.slice(1).map(({ command, args }) => [command, args]), [
    ['pi', ['install', 'npm:@heyhuynhgiabuu/pi-pretty', '--no-approve']],
  ]);
  assert.deepEqual(await fake.readGlobalSettings(), { packages: managedSources });
  assert.equal(code, 0);
});

test('status and doctor report a pinned optional npm package as drift with its pin', async (t) => {
  for (const command of ['status', 'doctor']) {
    const fake = createFakeHost(t);
    await fake.writeGlobalSettings({
      packages: [...managedSources.slice(0, -1), 'npm:@heyhuynhgiabuu/pi-pretty@0.6.29'],
    });

    const code = await run([command], fake.host);

    assert.ok(fake.stdout.text.includes(
      'pretty (npm:@heyhuynhgiabuu/pi-pretty): drift — pinned to 0.6.29 — `install` unpins it',
    ));
    assert.equal(code, 1);
  }
});
