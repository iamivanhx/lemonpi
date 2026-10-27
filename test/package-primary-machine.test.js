import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { seedOwnedConfigFixture } from './helpers/owned-config-fixture.js';
import { run } from '../src/cli.js';

const primaryMachinePackages = [
  'npm:@juicesharp/rpiv-todo',
  'npm:pi-footer',
  'npm:@heyhuynhgiabuu/pi-pretty@0.6.29',
  'git:github.com/earendil-works/pi-review',
  'npm:@tintinweb/pi-subagents',
  'https://github.com/earendil-works/pi-claude-code',
];

const catalog = [
  ['subagents', 'npm:@tintinweb/pi-subagents'],
  ['review', 'git:github.com/earendil-works/pi-review'],
  ['todo', 'npm:@juicesharp/rpiv-todo'],
  ['claude-code', 'git:github.com/earendil-works/pi-claude-code'],
  ['ask-user', 'npm:@juicesharp/rpiv-ask-user-question'],
  ['web-access', 'npm:pi-web-access'],
  ['footer', 'npm:pi-footer'],
  ['pretty', 'npm:@heyhuynhgiabuu/pi-pretty'],
];

test('primary machine status and install reconcile only its three package differences', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: primaryMachinePackages });
  await seedOwnedConfigFixture(fake);

  const initialStatusCode = await run(['status'], fake.host);
  const initialStatus = fake.stdout.text;

  assert.equal(initialStatusCode, 1);
  const installHint = '`install`';
  const statusItems = catalog.map(([id, source]) => {
    if (id === 'pretty') {
      return `${id} (${source}): drift — pinned to 0.6.29 — ${installHint} unpins it`;
    }
    if (id === 'ask-user' || id === 'web-access') {
      return `${id} (${source}): drift — not installed — ${installHint} adds it`;
    }
    return `${id} (${source}): ok`;
  });
  const positions = statusItems.map((item) => {
    assert.equal(initialStatus.split(item).length - 1, 1, `one status item for ${item}`);
    return initialStatus.indexOf(item);
  });
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.doesNotMatch(initialStatus, /Notices:/, 'status has no notice items');

  const callsBeforeInstall = fake.runnerCalls.length;
  const installCode = await run(['install'], fake.host);
  const installOutput = fake.stdout.text.slice(initialStatus.length);
  const installCalls = fake.runnerCalls.slice(callsBeforeInstall + 1);

  assert.equal(installCode, 0);
  assert.deepEqual(installCalls.map(({ command, args, options }) => [command, args, options.cwd]), [
    ['pi', ['install', 'npm:@juicesharp/rpiv-ask-user-question', '--no-approve'], fake.tmpdir],
    ['pi', ['install', 'npm:pi-web-access', '--no-approve'], fake.tmpdir],
    ['pi', ['install', 'npm:@heyhuynhgiabuu/pi-pretty', '--no-approve'], fake.tmpdir],
  ]);
  assert.match(installOutput, /Changed:/);
  // Managed packages plus the owned default model and six seeded files share this count.
  assert.match(installOutput, /OK: 12 items/);

  const beforeFinalStatus = fake.stdout.text;
  const finalStatusCode = await run(['status'], fake.host);
  const finalStatus = fake.stdout.text.slice(beforeFinalStatus.length);

  assert.equal(finalStatusCode, 0);
  for (const [id, source] of catalog) {
    const item = `${id} (${source}): ok`;
    assert.equal(finalStatus.split(item).length - 1, 1, `${id} is ok exactly once after install`);
  }
  assert.doesNotMatch(finalStatus, /Notices:/, 'final status has no notice items');
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['--version']],
    ['pi', ['install', 'npm:@juicesharp/rpiv-ask-user-question', '--no-approve']],
    ['pi', ['install', 'npm:pi-web-access', '--no-approve']],
    ['pi', ['install', 'npm:@heyhuynhgiabuu/pi-pretty', '--no-approve']],
    ['pi', ['--version']],
  ]);
});
