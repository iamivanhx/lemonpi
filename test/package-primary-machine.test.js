import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
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

const shippedFiles = [
  'agents/explorer.md',
  'agents/implementer.md',
  'agents/merger.md',
  'agents/researcher.md',
  'agents/reviewer.md',
  'extensions/pi-footer.json',
];

const primaryMachineSettings = {
  lastChangelogVersion: '1.4.0',
  theme: 'dark',
  defaultProvider: 'openai-codex',
  defaultModel: 'gpt-6-luna',
  packages: primaryMachinePackages,
  modelThinkingLevels: { 'openai-codex/gpt-6-luna': 'high' },
};

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

test('primary machine status shows only default-model owned drift and install restores it', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings(primaryMachineSettings);
  await seedOwnedConfigFixture(fake, { defaultModel: false });

  const initialStatusCode = await run(['status'], fake.host);
  const initialStatus = fake.stdout.text;

  assert.equal(initialStatusCode, 1);
  const defaultModelDrift = 'default model (claude-code/claude-opus-5-5): drift — differs from shipped — `install` restores it';
  assert.equal(initialStatus.split(defaultModelDrift).length - 1, 1, 'default model is the only owned drift');
  for (const path of shippedFiles) {
    assert.equal(initialStatus.split(`${path}: ok`).length - 1, 1, `${path} is ok before install`);
  }
  const shippedFilePaths = shippedFiles.map((path) => join(fake.piCodingAgentDir, path));
  const shippedFileStatsBeforeInstall = await Promise.all(
    shippedFilePaths.map((path) => stat(path, { bigint: true })),
  );
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
  assert.ok(
    installOutput.includes('default model (claude-code/claude-opus-5-5): set to claude-code/claude-opus-5-5'),
    installOutput,
  );
  assert.deepEqual(installCalls.map(({ command, args, options }) => [command, args, options.cwd]), [
    ['pi', ['install', 'npm:@juicesharp/rpiv-ask-user-question', '--no-approve'], fake.tmpdir],
    ['pi', ['install', 'npm:pi-web-access', '--no-approve'], fake.tmpdir],
    ['pi', ['install', 'npm:@heyhuynhgiabuu/pi-pretty', '--no-approve'], fake.tmpdir],
  ]);
  assert.match(installOutput, /Changed:/);
  // The changed default model is excluded from the OK count alongside three changed packages.
  assert.match(installOutput, /OK: 11 items/);
  const shippedFileStatsAfterInstall = await Promise.all(
    shippedFilePaths.map((path) => stat(path, { bigint: true })),
  );
  assert.deepEqual(
    shippedFileStatsAfterInstall.map(({ mtimeNs }) => mtimeNs),
    shippedFileStatsBeforeInstall.map(({ mtimeNs }) => mtimeNs),
    'install does not rewrite the six already-shipped files',
  );

  const backupRoot = join(fake.piCodingAgentDir, 'lemonpi-backups');
  const backupRun = join(backupRoot, '2026-10-26T12-00-00.000Z');
  assert.deepEqual(await readdir(backupRoot), ['2026-10-26T12-00-00.000Z'], 'install creates one backup folder');
  assert.deepEqual(await readdir(backupRun), ['settings.json'], 'only settings.json is backed up');
  const backupSettings = JSON.parse(await readFile(join(backupRun, 'settings.json'), 'utf8'));
  assert.equal(backupSettings.defaultProvider, 'openai-codex');
  assert.equal(backupSettings.defaultModel, 'gpt-6-luna');
  assert.equal(backupSettings.lastChangelogVersion, primaryMachineSettings.lastChangelogVersion);
  assert.equal(backupSettings.theme, primaryMachineSettings.theme);
  assert.deepEqual(backupSettings.modelThinkingLevels, primaryMachineSettings.modelThinkingLevels);

  const installedSettings = await fake.readGlobalSettings();
  assert.equal(installedSettings.defaultProvider, 'claude-code');
  assert.equal(installedSettings.defaultModel, 'claude-opus-5-5');
  assert.equal(installedSettings.lastChangelogVersion, primaryMachineSettings.lastChangelogVersion);
  assert.equal(installedSettings.theme, primaryMachineSettings.theme);
  assert.deepEqual(installedSettings.modelThinkingLevels, primaryMachineSettings.modelThinkingLevels);

  const beforeFinalStatus = fake.stdout.text;
  const finalStatusCode = await run(['status'], fake.host);
  const finalStatus = fake.stdout.text.slice(beforeFinalStatus.length);

  assert.equal(finalStatusCode, 0);
  for (const path of ['default model (claude-code/claude-opus-5-5)', ...shippedFiles]) {
    const item = `${path}: ok`;
    assert.equal(finalStatus.split(item).length - 1, 1, `${path} is ok exactly once after install`);
  }
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
