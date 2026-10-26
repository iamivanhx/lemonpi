import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
const replacementSource = managedSources[0];
const configuredWithReplaced = [replacedSource, ...managedSources.slice(1)];

test('status reports a declared replaced package as migration drift', async (t) => {
  for (const command of ['status', 'doctor']) {
    const fake = createFakeHost(t);
    await fake.writeGlobalSettings({ packages: configuredWithReplaced });

    const code = await run([command], fake.host);

    assert.ok(fake.stdout.text.includes(
      'subagents (npm:@tintinweb/pi-subagents): drift — npm:pi-subagents still declared — `install` migrates it',
    ));
    assert.equal(code, 1);
    assert.doesNotMatch(fake.stdout.text, /npm:pi-subagents: unmanaged package/);
    assert.deepEqual(fake.runnerCalls.map(({ command: called, args }) => [called, args]), [
      ['pi', ['--version']],
    ]);
  }
});

test('migration removes an identity only once when both unpinned and pinned spellings are declared', async (t) => {
  const fake = createFakeHost(t);
  const pinnedReplacedSource = `${replacedSource}@1.0.0`;
  await fake.writeGlobalSettings({
    packages: [replacedSource, pinnedReplacedSource, replacementSource, ...managedSources.slice(1)],
  });

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['remove', replacedSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    replacementSource,
    ...managedSources.slice(1),
  ]);
});

test('unreadable settings after migration install stops before removal and later packages', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    packages: [replacedSource, ...managedSources.slice(1, 5)],
  });
  const runner = fake.host.runner;
  fake.host.runner = async (command, args, options) => {
    const result = await runner(command, args, options);
    if (command === 'pi' && args[0] === 'install' && args[1] === replacementSource) {
      await writeFile(join(fake.piCodingAgentDir, 'settings.json'), '[]');
    }
    return result;
  };

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Pi settings: can't parse/);
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args), [[
    'install', replacementSource, '--no-approve',
  ]]);
});

test('unreadable settings after migration removal stops before later packages', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    packages: [replacedSource, replacementSource, ...managedSources.slice(1, 5)],
  });
  const runner = fake.host.runner;
  fake.host.runner = async (command, args, options) => {
    const result = await runner(command, args, options);
    if (command === 'pi' && args[0] === 'remove' && args[1] === replacedSource) {
      await writeFile(join(fake.piCodingAgentDir, 'settings.json'), '[]');
    }
    return result;
  };

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Pi settings: can't parse/);
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args), [[
    'remove', replacedSource, '--no-approve',
  ]]);
});

test('migration command diagnostics survive an unreadable post-mutation settings reread', async (t) => {
  const secret = 'migration-reread-secret';
  for (const [subcommand, source, packages] of [
    ['install', replacementSource, [replacedSource, ...managedSources.slice(1, 5)]],
    ['remove', replacedSource, [replacedSource, replacementSource, ...managedSources.slice(1, 5)]],
  ]) {
    const fake = createFakeHost(t, {
      env: { LEMON_ACCESS_TOKEN: secret },
      fakePi: {
        failures: [{
          subcommand,
          source,
          code: 23,
          stdout: 'migration command stdout',
          stderr: `migration command stderr ${secret}`,
        }],
      },
    });
    await fake.writeGlobalSettings({ packages });
    const runner = fake.host.runner;
    fake.host.runner = async (command, args, options) => {
      const result = await runner(command, args, options);
      if (command === 'pi' && args[0] === subcommand && args[1] === source) {
        await writeFile(join(fake.piCodingAgentDir, 'settings.json'), '[]');
      }
      return result;
    };

    const code = await run(['install'], fake.host);

    assert.equal(code, 2);
    assert.match(fake.stdout.text, /Pi settings: can't parse/);
    assert.ok(fake.stdout.text.includes(`pi ${subcommand} ${source} --no-approve`));
    assert.ok(fake.stdout.text.includes('migration command stdout'));
    assert.ok(fake.stdout.text.includes('migration command stderr [redacted]'));
    assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
    assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args), [[
      subcommand, source, '--no-approve',
    ]]);
  }
});

test('install removes the replaced package without reinstalling an existing replacement', async (t) => {
  const fake = createFakeHost(t);
  const packages = [...configuredWithReplaced, replacementSource];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['remove', replacedSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...managedSources.slice(1),
    replacementSource,
  ]);
});

test('a failed replacement install keeps the replaced package and reports sanitized output', async (t) => {
  const secret = 'migration-install-output-secret';
  const fake = createFakeHost(t, {
    env: { LEMON_ACCESS_TOKEN: secret },
    fakePi: {
      failures: [{
        subcommand: 'install',
        source: replacementSource,
        code: 17,
        stdout: `install output ${secret}`,
        stderr: 'install diagnostic',
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('replacement not installed; npm:pi-subagents kept'));
  assert.ok(fake.stdout.text.includes(
    `pi install ${replacementSource} --no-approve`,
  ));
  assert.ok(fake.stdout.text.includes('install output [redacted]'));
  assert.ok(fake.stdout.text.includes('install diagnostic'));
  assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['install', replacementSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, configuredWithReplaced);
});

test('an unverifiable replacement install keeps the replaced package and preserves diagnostics', async (t) => {
  const fake = createFakeHost(t, {
    runnerResults: [
      { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' },
      { code: 0, signal: null, stdout: 'Pi claimed the package was installed', stderr: '' },
    ],
  });
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('replacement not installed; npm:pi-subagents kept'));
  assert.ok(fake.stdout.text.includes(`pi install ${replacementSource} --no-approve`));
  assert.ok(fake.stdout.text.includes('Pi claimed the package was installed'));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['install', replacementSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, configuredWithReplaced);
});

test('a failed remove reports the command and leaves the replacement declared', async (t) => {
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'remove',
        source: replacedSource,
        code: 23,
        stdout: 'remove output',
        stderr: 'remove diagnostic',
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes(`pi remove ${replacedSource} --no-approve`));
  assert.ok(fake.stdout.text.includes('remove output'));
  assert.ok(fake.stdout.text.includes('remove diagnostic'));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['install', replacementSource, '--no-approve']],
    ['pi', ['remove', replacedSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...configuredWithReplaced,
    replacementSource,
  ]);
});

test('abort after replacement install stops before removing the replaced package', async (t) => {
  const fake = createFakeHost(t, { fakePi: { abortAfterCall: 2 } });
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });

  const code = await run(['install'], fake.host);

  assert.equal(code, 130);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['install', replacementSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...configuredWithReplaced,
    replacementSource,
  ]);
});

test('install dry-run previews migration without mutating the fixture', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });
  const before = await fake.readGlobalSettings();

  const code = await run(['install', '--dry-run'], fake.host);

  assert.equal(code, 0);
  assert.ok(fake.stdout.text.includes(
    `subagents (${replacementSource}): would migrate ${replacedSource} → ${replacementSource}`,
  ));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual(await fake.readGlobalSettings(), before);
});

test('install --skip subagents leaves the replaced package alone', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });
  const before = await fake.readGlobalSettings();

  const code = await run(['install', '--skip', 'subagents'], fake.host);

  assert.equal(code, 0);
  assert.ok(fake.stdout.text.includes(
    `subagents (${replacementSource}): held back by --skip`,
  ));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual(await fake.readGlobalSettings(), before);
});

test('migration preserves filters and autoload on an object-form replacement', async (t) => {
  const fake = createFakeHost(t);
  const replacement = {
    source: replacementSource,
    extensions: ['extensions/*.ts'],
    skills: ['skills/*.md'],
    autoload: false,
  };
  await fake.writeGlobalSettings({
    packages: [replacedSource, replacement, ...managedSources.slice(1)],
  });

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['remove', replacedSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    replacement,
    ...managedSources.slice(1),
  ]);
  assert.ok(fake.stdout.text.includes(
    `subagents (${replacementSource}): migrated ${replacedSource} → ${replacementSource}`,
  ));
});

test('duplicate replacement declarations outrank migration for status, install, and update', async (t) => {
  const packages = [replacedSource, replacementSource, replacementSource, ...managedSources.slice(1)];
  const duplicateDrift = `subagents (${replacementSource}): drift — declared 2 times — remove the extras`;
  const duplicateFailure = `subagents (${replacementSource}): declared 2 times in global settings; remove the extra declarations`;

  const status = createFakeHost(t);
  await status.writeGlobalSettings({ packages });
  const statusCode = await run(['status'], status.host);
  assert.equal(statusCode, 1);
  assert.ok(status.stdout.text.includes(duplicateDrift));
  assert.deepEqual(status.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual((await status.readGlobalSettings()).packages, packages);

  for (const command of ['install', 'update']) {
    const fake = createFakeHost(t);
    await fake.writeGlobalSettings({ packages });

    const code = await run([command], fake.host);

    assert.equal(code, 2, `${command} fails the required duplicate`);
    assert.ok(fake.stdout.text.includes(duplicateFailure), `${command} reports duplicate drift`);
    const packageCalls = fake.runnerCalls.slice(1);
    assert.ok(packageCalls.every(({ args }) => args[1] !== replacementSource),
      `${command} does not call Pi for the duplicate`);
    assert.deepEqual(packageCalls.map(({ args }) => args), command === 'update'
      ? managedSources.slice(1).map((source) => ['update', source, '--no-approve'])
      : []);
    assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
  }
});

test('skip overrides duplicate replacement declarations and migration', async (t) => {
  const packages = [replacedSource, replacementSource, replacementSource, ...managedSources.slice(1)];
  for (const command of ['install', 'update']) {
    const fake = createFakeHost(t);
    await fake.writeGlobalSettings({ packages });

    const code = await run([command, '--skip', 'subagents'], fake.host);

    assert.equal(code, 0, command);
    assert.ok(fake.stdout.text.includes(
      `subagents (${replacementSource}): held back by --skip`,
    ));
    const packageCalls = fake.runnerCalls.slice(1);
    assert.ok(packageCalls.every(({ args }) => args[1] !== replacementSource));
    assert.deepEqual(packageCalls.map(({ args }) => args), command === 'update'
      ? managedSources.slice(1).map((source) => ['update', source, '--no-approve'])
      : []);
    assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
  }
});

test('update migrates then updates subagents before later catalog packages', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });

  const code = await run(['update'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args, options }) => [command, args, options.cwd]), [
    ['pi', ['--version'], undefined],
    ['pi', ['install', replacementSource, '--no-approve'], fake.tmpdir],
    ['pi', ['remove', replacedSource, '--no-approve'], fake.tmpdir],
    ...managedSources.map((source) => [
      'pi', ['update', source, '--no-approve'], fake.tmpdir,
    ]),
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...managedSources.slice(1),
    replacementSource,
  ]);
  assert.ok(fake.stdout.text.includes(
    `subagents (${replacementSource}): migrated ${replacedSource} → ${replacementSource}`,
  ));
});

test('a successful remove that leaves the replaced declaration is not reported as migrated', async (t) => {
  const fake = createFakeHost(t, {
    runnerResults: [
      { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' },
      { code: 0, signal: null, stdout: 'Pi claimed remove success', stderr: '' },
    ],
  });
  const packages = [replacedSource, replacementSource, ...managedSources.slice(1)];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('replaced package still declared after pi remove'));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['remove', replacedSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('migration unpins an existing replacement while preserving its object fields', async (t) => {
  const fake = createFakeHost(t);
  const replacement = {
    source: `${replacementSource}@^0.22.0`,
    extensions: ['extensions/*.ts'],
    skills: ['skills/*.md'],
    autoload: false,
  };
  await fake.writeGlobalSettings({
    packages: [replacedSource, replacement, ...managedSources.slice(1)],
  });

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['install', replacementSource, '--no-approve']],
    ['pi', ['remove', replacedSource, '--no-approve']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    { ...replacement, source: replacementSource },
    ...managedSources.slice(1),
  ]);
});

test('install verifies the replacement before removing the replaced package', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: configuredWithReplaced });

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args, options }) => [command, args, options.cwd]), [
    ['pi', ['--version'], undefined],
    ['pi', ['install', replacementSource, '--no-approve'], fake.tmpdir],
    ['pi', ['remove', replacedSource, '--no-approve'], fake.tmpdir],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [
    ...managedSources.slice(1),
    replacementSource,
  ]);
  assert.ok(fake.stdout.text.includes(
    `subagents (${replacementSource}): migrated ${replacedSource} → ${replacementSource}`,
  ));
});
