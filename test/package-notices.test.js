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

test('install fails duplicated optional and required packages without package calls', async (t) => {
  for (const [id, source, duplicate, expectedCode] of [
    ['footer', 'npm:pi-footer', 'npm:pi-footer@1.0.0', 1],
    ['review', 'git:github.com/earendil-works/pi-review', 'git:github.com/earendil-works/pi-review@v1', 2],
  ]) {
    const fake = createFakeHost(t);
    const packages = [...managedSources];
    packages[managedSources.indexOf(source)] = duplicate;
    packages.push(source);
    await fake.writeGlobalSettings({ packages });

    const code = await run(['install'], fake.host);

    assert.ok(fake.stdout.text.includes(
      `${id} (${source}): declared 2 times in global settings; remove the extra declarations`,
    ));
    assert.equal(code, expectedCode);
    assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
      ['pi', ['--version']],
    ]);
    assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
  }
});

test('install --skip overrides a duplicate declaration', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: [...managedSources, 'npm:pi-footer@1.0.0'] });

  const code = await run(['install', '--skip', 'footer'], fake.host);

  assert.ok(fake.stdout.text.includes('footer (npm:pi-footer): held back by --skip'));
  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
});

test('install renders notices after the ok count without acting on unmanaged packages', async (t) => {
  const fake = createFakeHost(t);
  const packages = [
    'npm:pi-experiment',
    ...managedSources,
    'git:github.com/example/custom-extension',
    './local-package',
    'not-a-package-source',
    'npm:pi-subagents',
  ];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.ok(fake.stdout.text.includes('OK: 8 items'));
  assert.ok(fake.stdout.text.includes('Notices:'));
  for (const source of [
    'npm:pi-experiment',
    'git:github.com/example/custom-extension',
    './local-package',
    'not-a-package-source',
  ]) {
    assert.ok(fake.stdout.text.includes(`- ${source}: unmanaged package`), `${source} is a notice`);
  }
  assert.doesNotMatch(fake.stdout.text, /npm:pi-subagents: unmanaged package/);
  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('dry-run reports required and optional duplicates as failed without package calls', async (t) => {
  for (const [id, source, duplicate] of [
    ['footer', 'npm:pi-footer', 'npm:pi-footer@1.0.0'],
    ['review', 'git:github.com/earendil-works/pi-review', 'git:github.com/earendil-works/pi-review@v1'],
  ]) {
    const fake = createFakeHost(t);
    const packages = [...managedSources];
    packages[managedSources.indexOf(source)] = duplicate;
    packages.push(source);
    await fake.writeGlobalSettings({ packages });

    const code = await run(['install', '--dry-run'], fake.host);

    assert.ok(fake.stdout.text.includes(
      `${id} (${source}): declared 2 times in global settings; remove the extra declarations`,
    ));
    assert.match(fake.stdout.text, /Failed:/);
    assert.equal(code, 0);
    assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
      ['pi', ['--version']],
    ]);
    assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
  }
});

test('project-scope declarations are notices while the global package remains installed', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: managedSources });
  await fake.writeProjectSettings({ packages: ['npm:pi-footer'] });
  const projectPath = join(fake.cwd, '.pi', 'settings.json');
  const before = await readFile(projectPath);

  const statusCode = await run(['status'], fake.host);
  const installCode = await run(['install'], fake.host);

  assert.ok(fake.stdout.text.includes('footer (npm:pi-footer): ok'));
  assert.ok(fake.stdout.text.includes('- npm:pi-footer: project-scope declaration of footer'));
  assert.equal(statusCode, 0);
  assert.equal(installCode, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['--version']],
  ]);
  assert.deepEqual(await readFile(projectPath), before);
});

test('catalog alternatives are noticed while a missing canonical source is installed', async (t) => {
  const fake = createFakeHost(t);
  const alternative = 'git:github.com/wobondar/pi-footer';
  const packages = [...managedSources.slice(0, 6), alternative, managedSources[7]];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['install'], fake.host);

  assert.ok(fake.stdout.text.includes(
    `- ${alternative}: footer declared from a different source type`,
  ));
  assert.ok(fake.stdout.text.includes('footer (npm:pi-footer): installed'));
  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args, options }) => [command, args, options.cwd]), [
    ['pi', ['--version'], undefined],
    ['pi', ['install', 'npm:pi-footer', '--no-approve'], fake.tmpdir],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, [...packages, 'npm:pi-footer']);
});

test('unmanaged URL notices redact credentials and environment secrets', async (t) => {
  const secret = 'notice-source-secret';
  const fake = createFakeHost(t, { env: { LEMON_ACCESS_TOKEN: secret } });
  const source = 'https://user:secret@example.com/x';
  const secretSource = `git:github.com/${secret}/extension`;
  const packages = [...managedSources, source, secretSource];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['status'], fake.host);

  assert.ok(fake.stdout.text.includes('https://[redacted]@example.com/x: unmanaged package'));
  assert.ok(fake.stdout.text.includes('git:github.com/[redacted]/extension: unmanaged package'));
  assert.doesNotMatch(fake.stdout.text, /user:secret|notice-source-secret/);
  assert.equal(code, 0);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('project notices remain readable when global settings are unparseable', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: [] });
  await writeFile(join(fake.piCodingAgentDir, 'settings.json'), '{"packages": [');
  await fake.writeProjectSettings({ packages: ['npm:pi-footer'] });
  const projectPath = join(fake.cwd, '.pi', 'settings.json');
  const before = await readFile(projectPath);

  const statusCode = await run(['status'], fake.host);
  const installCode = await run(['install'], fake.host);

  assert.ok(fake.stdout.text.includes('- npm:pi-footer: project-scope declaration of footer'));
  assert.equal(statusCode, 2);
  assert.equal(installCode, 2);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['--version']],
  ]);
  assert.deepEqual(await readFile(projectPath), before);
});

test('unparseable project settings are silently ignored', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: managedSources });
  await fake.writeProjectSettings({ packages: [] });
  const projectPath = join(fake.cwd, '.pi', 'settings.json');
  await writeFile(projectPath, '{"packages": [');
  const before = await readFile(projectPath);

  const statusCode = await run(['status'], fake.host);
  const installCode = await run(['install'], fake.host);

  assert.equal(statusCode, 0);
  assert.equal(installCode, 0);
  assert.doesNotMatch(fake.stdout.text, /Notices:/);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['--version']],
  ]);
  assert.deepEqual(await readFile(projectPath), before);
});

test('status reports unmanaged declarations without changing their settings positions', async (t) => {
  const fake = createFakeHost(t);
  const packages = [
    'npm:pi-experiment',
    managedSources[0],
    'npm:pi-subagents',
    'git:github.com/example/custom-extension',
    managedSources[1],
    './local-package',
    ...managedSources.slice(2, 4),
    'not-a-package-source',
    { unrelated: 'must-not-be-printed' },
    ...managedSources.slice(4),
  ];
  await fake.writeGlobalSettings({ packages });

  const statusCode = await run(['status'], fake.host);
  const doctorCode = await run(['doctor'], fake.host);

  for (const source of [
    'npm:pi-experiment',
    'git:github.com/example/custom-extension',
    './local-package',
    'not-a-package-source',
    'unparseable package declaration',
  ]) {
    assert.ok(fake.stdout.text.includes(`- ${source}: unmanaged package`), `${source} is a notice`);
  }
  assert.doesNotMatch(fake.stdout.text, /must-not-be-printed|npm:pi-subagents: unmanaged package/);
  assert.equal(statusCode, 0);
  assert.equal(doctorCode, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['--version']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('status reports duplicate managed declarations as drift', async (t) => {
  const fake = createFakeHost(t);
  const packages = [...managedSources, 'npm:pi-footer@1.0.0'];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['status'], fake.host);

  assert.match(fake.stdout.text, /footer \(npm:pi-footer\): drift — declared 2 times — remove the extras/);
  assert.equal(code, 1);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
  ]);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});
