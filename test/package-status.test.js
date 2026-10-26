import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';

const managedPackages = [
  { id: 'subagents', source: 'npm:@tintinweb/pi-subagents' },
  { id: 'review', source: 'git:github.com/earendil-works/pi-review' },
  { id: 'todo', source: 'npm:@juicesharp/rpiv-todo' },
  { id: 'claude-code', source: 'git:github.com/earendil-works/pi-claude-code' },
  { id: 'ask-user', source: 'npm:@juicesharp/rpiv-ask-user-question' },
  { id: 'web-access', source: 'npm:pi-web-access' },
  { id: 'footer', source: 'npm:pi-footer' },
  { id: 'pretty', source: 'npm:@heyhuynhgiabuu/pi-pretty' },
];

test('status lists every missing managed package as drift in catalog order', async (t) => {
  for (const [fixture, settings] of [
    ['missing settings', undefined],
    ['empty settings object', {}],
    ['empty package inventory', { packages: [] }],
  ]) {
    const fake = createFakeHost(t);
    if (settings !== undefined) await fake.writeGlobalSettings(settings);

    const code = await run(['status'], fake.host);
    const positions = managedPackages.map(({ id, source }) => {
      const item = `${id} (${source}): drift — not installed — \`install\` adds it`;
      assert.ok(fake.stdout.text.includes(item), `${fixture}: expected ${item}`);
      assert.equal(fake.stdout.text.split(item).length - 1, 1, `${fixture}: one item for ${id}`);
      return fake.stdout.text.indexOf(item);
    });

    assert.equal(code, 1, `${fixture}: missing packages are drift`);
    assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  }
});

test('status recognizes all eight unpinned declarations and Pi git spellings', async (t) => {
  const claudeCodeSpellings = [
    'https://github.com/earendil-works/pi-claude-code',
    'https://github.com/earendil-works/pi-claude-code.git',
    'ssh://git@github.com/earendil-works/pi-claude-code.git',
    'git:git@github.com:earendil-works/pi-claude-code.git',
  ];

  for (const claudeCodeSource of claudeCodeSpellings) {
    const fake = createFakeHost(t);
    const packages = managedPackages.map(({ source }) => (
      source === 'git:github.com/earendil-works/pi-claude-code' ? claudeCodeSource : source
    ));
    await fake.writeGlobalSettings({ packages });

    const code = await run(['status'], fake.host);

    assert.equal(code, 0, `${claudeCodeSource} is the managed git identity`);
    const positions = managedPackages.map(({ id, source }) => {
      const item = `${id} (${source}): ok`;
      assert.ok(fake.stdout.text.includes(item), `${id} is declared`);
      assert.equal(fake.stdout.text.split(item).length - 1, 1, `${id} appears once`);
      return fake.stdout.text.indexOf(item);
    });
    assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
    assert.doesNotMatch(fake.stdout.text, /: drift/);
  }
});

test('managed identity recognizes npm pins and git refs as pinned drift in object declarations', async (t) => {
  const fake = createFakeHost(t);
  const packages = [
    'npm:@tintinweb/pi-subagents@^0.22.0',
    'git:github.com/earendil-works/pi-review@feature/next',
    'npm:@juicesharp/rpiv-todo@>=2 <3',
    { source: 'git:github.com/earendil-works/pi-claude-code@v1', extensions: ['extensions/*.ts'] },
    'npm:@juicesharp/rpiv-ask-user-question@next',
    'npm:pi-web-access@1.2.3',
    'npm:pi-footer@~0.5.0',
    'npm:@heyhuynhgiabuu/pi-pretty@0.8.0',
  ];
  await fake.writeGlobalSettings({ packages });

  const code = await run(['status'], fake.host);

  assert.equal(code, 1);
  for (const [id, source, pin] of [
    ['subagents', managedPackages[0].source, '^0.22.0'],
    ['review', managedPackages[1].source, 'feature/next'],
    ['todo', managedPackages[2].source, '>=2 <3'],
    ['claude-code', managedPackages[3].source, 'v1'],
    ['ask-user', managedPackages[4].source, 'next'],
    ['web-access', managedPackages[5].source, '1.2.3'],
    ['footer', managedPackages[6].source, '~0.5.0'],
    ['pretty', managedPackages[7].source, '0.8.0'],
  ]) {
    assert.ok(fake.stdout.text.includes(
      `${id} (${source}): drift — pinned to ${pin} — ` + '`install` unpins it',
    ), `${id} is declared but pinned`);
  }
});

test('unrelated npm names and local paths do not satisfy managed identities', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    packages: [
      'npm:pi-subagents',
      'npm:@tintinweb/pi-subagents-extra',
      './local-package',
      'not-a-package-source',
    ],
  });

  const code = await run(['status'], fake.host);

  assert.equal(code, 1);
  assert.ok(fake.stdout.text.includes(
    'subagents (npm:@tintinweb/pi-subagents): drift — npm:pi-subagents still declared — `install` migrates it',
  ));
  assert.ok(fake.stdout.text.includes('review (git:github.com/earendil-works/pi-review): drift — not installed'));
  assert.doesNotMatch(fake.stdout.text, /subagents \(npm:@tintinweb\/pi-subagents\): ok/);
});

test('doctor gives the same managed-package inventory as status', async (t) => {
  const status = createFakeHost(t);
  const doctor = createFakeHost(t);
  await status.writeGlobalSettings({ packages: ['npm:pi-footer'] });
  await doctor.writeGlobalSettings({ packages: ['npm:pi-footer'] });

  const statusCode = await run(['status'], status.host);
  const doctorCode = await run(['doctor'], doctor.host);
  const inventory = (output) => managedPackages.map(({ id, source }) => {
    const name = `${id} (${source})`;
    const ok = `${name}: ok`;
    const drift = `${name}: drift — not installed — \`install\` adds it`;
    const okCount = output.split(ok).length - 1;
    const driftCount = output.split(drift).length - 1;
    assert.equal(okCount + driftCount, 1, `${name} appears exactly once`);
    return okCount === 1 ? ok : driftCount === 1 ? drift : null;
  });

  assert.equal(statusCode, 1);
  assert.equal(doctorCode, 1);
  assert.ok(inventory(status.stdout.text).every(Boolean));
  assert.deepEqual(inventory(doctor.stdout.text), inventory(status.stdout.text));
});

test('unreadable global settings report a failed settings item and unknown packages', async (t) => {
  const invalidSettings = [
    ['unparseable JSON', '{"packages": ['],
    ['zero-byte JSON', ''],
    ['non-object top level', '[]'],
    ['null top level', 'null'],
    ['non-array packages', '{"packages": {}}'],
  ];

  for (const [fixture, contents] of invalidSettings) {
    const fake = createFakeHost(t);
    await writeFile(join(fake.piCodingAgentDir, 'settings.json'), contents);

    const code = await run(['status'], fake.host);
    const unknownItems = fake.stdout.text.match(/: unknown — settings unreadable/g) ?? [];

    assert.equal(code, 2, fixture);
    assert.ok(fake.stdout.text.includes('Pi settings: failed — can\'t parse'), fixture);
    assert.equal((fake.stdout.text.match(/Pi settings: failed/g) ?? []).length, 1, fixture);
    assert.equal(unknownItems.length, 8, fixture);
    for (const { id, source } of managedPackages) {
      assert.ok(fake.stdout.text.includes(`${id} (${source}): unknown — settings unreadable`), fixture);
    }
  }

  const secret = 'credential-path-secret-value';
  const fake = createFakeHost(t, { env: { LEMON_ACCESS_TOKEN: secret } });
  const credentialDirectory = join(fake.home, `agent-${secret}`);
  await mkdir(credentialDirectory);
  fake.host.env.PI_CODING_AGENT_DIR = credentialDirectory;
  await writeFile(join(credentialDirectory, 'settings.json'), `{"token":"${secret}",}`);

  const code = await run(['status'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('Pi settings: failed — can\'t parse'));
  assert.doesNotMatch(`${fake.stdout.text}${fake.stderr.text}`, new RegExp(secret));
});

test('reported catalog sources are sanitized against environment secrets', async (t) => {
  const secret = 'npm:pi-footer';
  const fake = createFakeHost(t, { env: { PACKAGE_SOURCE_TOKEN: secret } });
  await fake.writeGlobalSettings({ packages: managedPackages.map(({ source }) => source) });

  const code = await run(['status'], fake.host);

  assert.equal(code, 0);
  assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
  assert.ok(fake.stdout.text.includes('footer ([redacted]): ok'));
});

test('status shows a skipped package as skipped rather than ok', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: managedPackages.map(({ source }) => source) });

  const code = await run(['status', '--skip', 'footer'], fake.host);

  assert.equal(code, 0);
  assert.ok(fake.stdout.text.includes('footer (npm:pi-footer): skipped — held back by --skip'));
  for (const { id, source } of managedPackages.filter(({ id }) => id !== 'footer')) {
    assert.ok(fake.stdout.text.includes(`${id} (${source}): ok`), `${id} remains in inventory`);
  }
});

test('status only probes Pi version and leaves the settings fixture byte-for-byte unchanged', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: managedPackages.map(({ source }) => source) });
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const before = await readFile(settingsPath);

  const code = await run(['status'], fake.host);

  const after = await readFile(settingsPath);
  assert.equal(code, 0);
  for (const { id, source } of managedPackages) {
    assert.ok(fake.stdout.text.includes(`${id} (${source}): ok`), `${id} is inventoried`);
  }
  assert.deepEqual(after, before);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
});

test('update pulls every configured managed package one at a time in catalog order', async (t) => {
  const fake = createFakeHost(t);
  const packages = managedPackages.map(({ source }) => source);
  await fake.writeGlobalSettings({ packages });

  const code = await run(['update'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args, options }) => [command, args, options.cwd]), [
    ['pi', ['--version'], undefined],
    ...managedPackages.map(({ source }) => [
      'pi', ['update', source, '--no-approve'], fake.tmpdir,
    ]),
  ]);
  assert.ok(fake.runnerCalls.every(({ args }) => args[0] !== 'install'));
  assert.match(fake.stdout.text, /OK: 8 items/);
  assert.deepEqual((await fake.readGlobalSettings()).packages, packages);
});

test('skills produces no managed-package inventory items', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['skills'], fake.host);

  assert.equal(code, 0);
  for (const { id, source } of managedPackages) {
    assert.ok(!fake.stdout.text.includes(`${id} (${source})`), `${id} is not listed by skills`);
  }
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
});
