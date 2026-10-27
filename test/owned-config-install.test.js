import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  readlink,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';

const shippedFiles = [
  'agents/explorer.md',
  'agents/implementer.md',
  'agents/merger.md',
  'agents/researcher.md',
  'agents/reviewer.md',
  'extensions/pi-footer.json',
];

async function seedShippedFiles(fake) {
  for (const path of shippedFiles) {
    const target = join(fake.piCodingAgentDir, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url)));
  }
}

async function snapshotTree(path) {
  const facts = await lstat(path);
  const mode = facts.mode & 0o777;
  if (facts.isSymbolicLink()) return { type: 'symlink', mode, target: await readlink(path) };
  if (facts.isDirectory()) {
    const entries = await Promise.all((await readdir(path)).sort().map(async (name) => [
      name,
      await snapshotTree(join(path, name)),
    ]));
    return { type: 'directory', mode, entries };
  }
  return { type: 'file', mode, bytes: await readFile(path) };
}

function observeHostWrites(fake) {
  const calls = [];
  for (const name of ['mkdir', 'writeFile', 'rename', 'chmod', 'rm']) {
    const original = fake.host[name];
    fake.host[name] = async (...args) => {
      calls.push({ name, paths: args.filter((argument) => typeof argument === 'string') });
      return original(...args);
    };
  }
  return calls;
}

test('install --dry-run previews additions without changing an empty agent directory', async (t) => {
  const fake = createFakeHost(t);
  const before = await snapshotTree(fake.piCodingAgentDir);
  const hostWrites = observeHostWrites(fake);

  const code = await run(['install', '--dry-run'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  assert.ok(
    fake.stdout.text.includes('default model (claude-code/claude-opus-5-5): would set to claude-code/claude-opus-5-5'),
    fake.stdout.text,
  );
  for (const path of shippedFiles) assert.ok(fake.stdout.text.includes(`${path}: would add`), fake.stdout.text);
  assert.deepEqual(await snapshotTree(fake.piCodingAgentDir), before);
  assert.deepEqual(hostWrites, []);
  assert.deepEqual(fake.runnerCalls.map(({ args }) => args[0]), ['--version']);
});

test('install --dry-run previews a model set and shipped-file restore without changing either file', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    lastChangelogVersion: '1.2.3',
    theme: 'dark',
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
    packages: [
      'npm:@tintinweb/pi-subagents',
      'git:github.com/earendil-works/pi-review',
      'npm:@juicesharp/rpiv-todo',
      'git:github.com/earendil-works/pi-claude-code',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:pi-web-access',
      'npm:pi-footer',
      'npm:@heyhuynhgiabuu/pi-pretty',
    ],
    modelThinkingLevels: { 'openai-codex/gpt-6-luna': 'high' },
  });
  await seedShippedFiles(fake);
  await writeFile(join(fake.piCodingAgentDir, 'agents/explorer.md'), 'local hand edit must remain');
  const before = await snapshotTree(fake.piCodingAgentDir);
  const hostWrites = observeHostWrites(fake);

  const code = await run(['install', '--dry-run'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  assert.ok(fake.stdout.text.includes('default model (claude-code/claude-opus-5-5): would set to claude-code/claude-opus-5-5'), fake.stdout.text);
  assert.ok(fake.stdout.text.includes('agents/explorer.md: would restore shipped version'), fake.stdout.text);
  assert.deepEqual(await snapshotTree(fake.piCodingAgentDir), before);
  assert.deepEqual(hostWrites, []);
});

test('update --dry-run previews the same owned-file and default-model changes without writes', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    theme: 'dark',
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
    packages: [],
  });
  await seedShippedFiles(fake);
  await writeFile(join(fake.piCodingAgentDir, 'agents/explorer.md'), 'local hand edit');
  await rm(join(fake.piCodingAgentDir, 'agents/reviewer.md'));
  const before = await snapshotTree(fake.piCodingAgentDir);
  const hostWrites = observeHostWrites(fake);

  const code = await run(['update', '--dry-run'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  assert.ok(fake.stdout.text.includes('default model (claude-code/claude-opus-5-5): would set to claude-code/claude-opus-5-5'), fake.stdout.text);
  assert.ok(fake.stdout.text.includes('agents/explorer.md: would restore shipped version'), fake.stdout.text);
  assert.ok(fake.stdout.text.includes('agents/reviewer.md: would add'), fake.stdout.text);
  assert.deepEqual(await snapshotTree(fake.piCodingAgentDir), before);
  assert.deepEqual(hostWrites, []);
  assert.deepEqual(fake.runnerCalls.map(({ args }) => args[0]), ['--version']);
});

test('install --dry-run reports no owned changes for a fully matching machine', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({
    defaultProvider: 'claude-code',
    defaultModel: 'claude-opus-5-5',
    packages: [],
  });
  await seedShippedFiles(fake);
  const before = await snapshotTree(fake.piCodingAgentDir);
  const hostWrites = observeHostWrites(fake);

  const code = await run(['install', '--dry-run'], fake.host);

  const ownedChangeLines = fake.stdout.text.split('\n').filter((line) => (
    line.includes('default model (claude-code/claude-opus-5-5)')
    || shippedFiles.some((path) => line.includes(path))
  ));
  assert.equal(code, 0, fake.stdout.text);
  assert.deepEqual(ownedChangeLines, []);
  assert.match(fake.stdout.text, /OK: 7 items/);
  assert.deepEqual(await snapshotTree(fake.piCodingAgentDir), before);
  assert.deepEqual(hostWrites, []);
});

test('install/update --dry-run never invoke a runner or host write against the agent directory', async (t) => {
  for (const command of ['install', 'update']) {
    const fake = createFakeHost(t);
    const before = await snapshotTree(fake.piCodingAgentDir);
    const realAgentDir = realpathSync(fake.piCodingAgentDir);
    const hostWrites = observeHostWrites(fake);

    const code = await run([command, '--dry-run'], fake.host);

    const writesToAgentDir = hostWrites.filter(({ paths }) => paths.some((path) => (
      path === realAgentDir || path.startsWith(`${realAgentDir}/`)
    )));
    assert.equal(code, 0, fake.stdout.text);
    assert.deepEqual(writesToAgentDir, []);
    assert.deepEqual(
      fake.runnerCalls.map(({ command: runner, args }) => [runner, ...args]),
      [['pi', '--version']],
    );
    assert.deepEqual(await snapshotTree(fake.piCodingAgentDir), before);
  }
});

test('install --dry-run keeps unparseable settings and the agent directory unchanged', async (t) => {
  const fake = createFakeHost(t);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const settingsBytes = Buffer.from('{"packages": [');
  await writeFile(settingsPath, settingsBytes);
  const before = await snapshotTree(fake.piCodingAgentDir);
  const hostWrites = observeHostWrites(fake);

  const code = await run(['install', '--dry-run'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  assert.ok(
    fake.stdout.text.includes('default model (claude-code/claude-opus-5-5): Pi settings unreadable; default model not set'),
    fake.stdout.text,
  );
  assert.deepEqual(await readFile(settingsPath), settingsBytes);
  assert.deepEqual(await snapshotTree(fake.piCodingAgentDir), before, 'the agent directory stays unchanged');
  assert.deepEqual(hostWrites, []);
});

test('install sets the default model after Pi writes packages without backing up newly-created settings', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  const settings = await fake.readGlobalSettings();
  assert.equal(settings.defaultProvider, 'claude-code');
  assert.equal(settings.defaultModel, 'claude-opus-5-5');
  assert.deepEqual(settings.packages, [
    'npm:@tintinweb/pi-subagents',
    'git:github.com/earendil-works/pi-review',
    'npm:@juicesharp/rpiv-todo',
    'git:github.com/earendil-works/pi-claude-code',
    'npm:@juicesharp/rpiv-ask-user-question',
    'npm:pi-web-access',
    'npm:pi-footer',
    'npm:@heyhuynhgiabuu/pi-pretty',
  ]);
  assert.match(fake.stdout.text, /default model \(claude-code\/claude-opus-5-5\): set to claude-code\/claude-opus-5-5/);
  assert.doesNotMatch(fake.stdout.text, /openai-codex|gpt-6-luna/);
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
});

test('install adds all shipped files to an empty agent directory without backups', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.match(fake.stdout.text, /Changed:/);
  assert.equal(fake.stdout.text.split('agents/explorer.md: added').length - 1, 1, fake.stdout.text);
  for (const path of shippedFiles) {
    const installed = await readFile(join(fake.piCodingAgentDir, path));
    const shipped = await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url));
    assert.deepEqual(installed, shipped, `${path} matches the shipped bytes`);
    assert.equal(fake.stdout.text.split(`${path}: added`).length - 1, 1);
  }
  assert.equal((fake.stdout.text.match(/: added/g) ?? []).length, 6);
  assert.match(fake.stdout.text, /default model \(claude-code\/claude-opus-5-5\): set to claude-code\/claude-opus-5-5/);
  assert.doesNotMatch(fake.stdout.text, /openai-codex|gpt-6-luna/);
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
});

test('install changes only the primary-machine default model keys and backs up the old settings', async (t) => {
  const fake = createFakeHost(t);
  const oldSettings = {
    lastChangelogVersion: '1.2.3',
    theme: 'dark',
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
    packages: [
      'npm:@tintinweb/pi-subagents',
      'git:github.com/earendil-works/pi-review',
      'npm:@juicesharp/rpiv-todo',
      'git:github.com/earendil-works/pi-claude-code',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:pi-web-access',
      'npm:pi-footer',
      'npm:@heyhuynhgiabuu/pi-pretty',
    ],
    modelThinkingLevels: { 'openai-codex/gpt-6-luna': 'high' },
  };
  await fake.writeGlobalSettings(oldSettings);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const oldBytes = await readFile(settingsPath);
  const oldKeyOrder = Object.keys(oldSettings);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  const settings = await fake.readGlobalSettings();
  assert.equal(settings.defaultProvider, 'claude-code');
  assert.equal(settings.defaultModel, 'claude-opus-5-5');
  assert.deepEqual(Object.keys(settings), oldKeyOrder);
  for (const key of ['theme', 'modelThinkingLevels', 'lastChangelogVersion', 'packages']) {
    assert.deepEqual(settings[key], oldSettings[key], `${key} is unchanged`);
  }
  assert.equal(fake.stdout.text.split('default model (claude-code/claude-opus-5-5): set to claude-code/claude-opus-5-5').length - 1, 1);
  assert.doesNotMatch(fake.stdout.text, /openai-codex|gpt-6-luna/);
  const backup = join(fake.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z/settings.json');
  assert.deepEqual(await readFile(backup), oldBytes);
  assert.deepEqual(await readdir(join(fake.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z')), ['settings.json']);
  assert.doesNotMatch(fake.stdout.text, /lemonpi-backups/);
});

test('a second install leaves shipped-file mtimes unchanged and counts all six as ok', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const paths = shippedFiles.map((path) => join(fake.piCodingAgentDir, path));
  const before = await Promise.all(paths.map((path) => stat(path, { bigint: true })));

  const firstCode = await run(['install'], fake.host);
  const secondCode = await run(['install'], fake.host);

  assert.equal(secondCode, 0);
  assert.match(fake.stdout.text, /OK: 15 items/, fake.stdout.text);
  const after = await Promise.all(paths.map((path) => stat(path, { bigint: true })));
  assert.deepEqual(after.map(({ mtimeNs }) => mtimeNs), before.map(({ mtimeNs }) => mtimeNs));
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
  assert.equal(firstCode, 0);
});

test('install leaves an already-correct default model untouched and appends missing keys', async (t) => {
  const correct = createFakeHost(t);
  await correct.writeGlobalSettings({
    defaultProvider: 'claude-code',
    defaultModel: 'claude-opus-5-5',
    packages: [
      'npm:@tintinweb/pi-subagents',
      'git:github.com/earendil-works/pi-review',
      'npm:@juicesharp/rpiv-todo',
      'git:github.com/earendil-works/pi-claude-code',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:pi-web-access',
      'npm:pi-footer',
      'npm:@heyhuynhgiabuu/pi-pretty',
    ],
  });
  const settingsPath = join(correct.piCodingAgentDir, 'settings.json');
  const before = await stat(settingsPath, { bigint: true });

  const correctCode = await run(['install'], correct.host);

  const after = await stat(settingsPath, { bigint: true });
  assert.equal(correctCode, 0, correct.stdout.text);
  assert.deepEqual(after.mtimeNs, before.mtimeNs);
  assert.match(correct.stdout.text, /OK: 9 items/);
  assert.doesNotMatch(correct.stdout.text, /default model \(claude-code\/claude-opus-5-5\): set to/);
  await assert.rejects(access(join(correct.piCodingAgentDir, 'lemonpi-backups')));

  const missingKeys = createFakeHost(t);
  await missingKeys.writeGlobalSettings({});
  const missingKeysCode = await run(['install'], missingKeys.host);
  const settings = await missingKeys.readGlobalSettings();
  assert.equal(missingKeysCode, 0, missingKeys.stdout.text);
  assert.deepEqual(Object.keys(settings), ['packages', 'defaultProvider', 'defaultModel']);
  assert.equal(settings.defaultProvider, 'claude-code');
  assert.equal(settings.defaultModel, 'claude-opus-5-5');
});

test('install restores differing shipped bytes and keeps one private backup out of output', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const target = join(fake.piCodingAgentDir, 'agents/explorer.md');
  const shipped = await readFile(new URL('../src/owned-config/shipped-content/agents/explorer.md', import.meta.url));
  const oldBytes = Buffer.from('local hand edit must not appear in output\n');
  await writeFile(target, oldBytes);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(await readFile(target), shipped);
  assert.equal(fake.stdout.text.split('agents/explorer.md: restored shipped version').length - 1, 1);
  const backupRoot = join(fake.piCodingAgentDir, 'lemonpi-backups');
  const backupRun = join(backupRoot, '2026-10-26T12-00-00.000Z');
  let backupCreated = true;
  try {
    await access(backupRun);
  } catch {
    backupCreated = false;
  }
  assert.equal(backupCreated, true, fake.stdout.text);
  assert.deepEqual(await readdir(backupRun), ['agents']);
  assert.deepEqual(await readdir(join(backupRun, 'agents')), ['explorer.md']);
  const backup = join(backupRun, 'agents/explorer.md');
  assert.deepEqual(await readFile(backup), oldBytes);
  assert.equal((await stat(backupRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(backupRun)).mode & 0o777, 0o700);
  assert.equal((await stat(join(backupRun, 'agents'))).mode & 0o777, 0o700);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.doesNotMatch(fake.stdout.text, /lemonpi-backups|local hand edit must not appear in output/);
});

test('install restores a differing shipped file through an external symlink and backs up the real bytes', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const link = join(fake.piCodingAgentDir, 'extensions/pi-footer.json');
  const realTarget = join(fake.home, 'dotfiles/pi-footer.json');
  const oldBytes = Buffer.from('{"local":"footer edit"}\n');
  const shipped = await readFile(new URL('../src/owned-config/shipped-content/extensions/pi-footer.json', import.meta.url));
  await mkdir(join(realTarget, '..'), { recursive: true });
  await writeFile(realTarget, oldBytes);
  await rm(link);
  await symlink(realTarget, link);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal(await readlink(link), realTarget);
  assert.deepEqual(await readFile(realTarget), shipped);
  assert.match(fake.stdout.text, /extensions\/pi-footer\.json: restored shipped version/);
  assert.deepEqual(
    await readFile(join(fake.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z/extensions/pi-footer.json')),
    oldBytes,
  );
});

test('install creates the target of a dangling shipped-file symlink without backing up', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const link = join(fake.piCodingAgentDir, 'agents/explorer.md');
  const target = join(fake.home, 'dotfiles/agents/explorer.md');
  const shipped = await readFile(new URL('../src/owned-config/shipped-content/agents/explorer.md', import.meta.url));
  await rm(link);
  await symlink(target, link);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal(await readlink(link), target);
  assert.deepEqual(await readFile(target), shipped);
  assert.match(fake.stdout.text, /agents\/explorer\.md: added/);
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
});

test('install writes through a two-link chain and leaves both links in place', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const link = join(fake.piCodingAgentDir, 'agents/explorer.md');
  const secondLink = join(fake.home, 'dotfiles/agents/current-explorer.md');
  const realTarget = join(fake.home, 'dotfiles/revisions/explorer.md');
  const shipped = await readFile(new URL('../src/owned-config/shipped-content/agents/explorer.md', import.meta.url));
  await mkdir(join(realTarget, '..'), { recursive: true });
  await writeFile(realTarget, 'old two-link target');
  await rm(link);
  await symlink(secondLink, link);
  await mkdir(join(secondLink, '..'), { recursive: true });
  await symlink(realTarget, secondLink);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal((await lstat(secondLink)).isSymbolicLink(), true);
  assert.equal(await readlink(link), secondLink);
  assert.equal(await readlink(secondLink), realTarget);
  assert.deepEqual(await readFile(realTarget), shipped);
  assert.match(fake.stdout.text, /agents\/explorer\.md: restored shipped version/);
});

test('an equal shipped-file symlink is ok and install leaves it untouched without a backup', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const link = join(fake.piCodingAgentDir, 'extensions/pi-footer.json');
  const target = join(fake.home, 'dotfiles/pi-footer.json');
  const shipped = await readFile(new URL('../src/owned-config/shipped-content/extensions/pi-footer.json', import.meta.url));
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, shipped);
  await rm(link);
  await symlink(target, link);
  const before = await stat(target, { bigint: true });

  await run(['status'], fake.host);
  const installCode = await run(['install'], fake.host);

  const after = await stat(target, { bigint: true });
  assert.match(fake.stdout.text, /extensions\/pi-footer\.json: ok/);
  assert.equal(installCode, 0);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal(await readlink(link), target);
  assert.deepEqual(after.mtimeNs, before.mtimeNs);
  assert.deepEqual(await readFile(target), shipped);
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
});

test('a failed write through a symlink leaves no temporary file next to either path', async (t) => {
  let realTarget;
  const fake = createFakeHost(t, {
    writeFailures: ({ home }) => {
      realTarget = join(home, 'dotfiles/pi-footer.json');
      return [join(realpathSync(home), 'dotfiles/pi-footer.json')];
    },
  });
  await seedShippedFiles(fake);
  const link = join(fake.piCodingAgentDir, 'extensions/pi-footer.json');
  await mkdir(join(realTarget, '..'), { recursive: true });
  const oldBytes = Buffer.from('{"local":"footer edit"}\n');
  await writeFile(realTarget, oldBytes);
  await rm(link);
  await symlink(realTarget, link);

  const code = await run(['install'], fake.host);

  assert.equal(code, 2, fake.stdout.text);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.match(fake.stdout.text, /Failed:\n  - extensions\/pi-footer\.json: extensions\/pi-footer\.json: EACCES/);
  assert.deepEqual(await readFile(realTarget), oldBytes);
  for (const directory of [join(link, '..'), join(realTarget, '..')]) {
    const entries = await readdir(directory);
    assert.ok(!entries.some((name) => name.includes('.lemonpi-') || name.endsWith('.tmp')), directory);
  }
});

test('install keeps a differing mode-0600 shipped file at mode 0600', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const target = join(fake.piCodingAgentDir, 'agents/explorer.md');
  const shipped = await readFile(new URL('../src/owned-config/shipped-content/agents/explorer.md', import.meta.url));
  await chmod(target, 0o600);
  await writeFile(target, 'local mode-0600 edit');

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(target), shipped);
});

test('install preserves and never reports unowned agent and extension files', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const oldOwnedPath = join(fake.piCodingAgentDir, 'agents/explorer.md');
  await writeFile(oldOwnedPath, 'drifted owned file');
  const unowned = [
    ['agents/mine.md', Buffer.from('private agent file bytes')],
    ['extensions/local.json', Buffer.from('{"local":"extension"}')],
    ['agents/old.md', Buffer.from('previously shipped file bytes')],
  ];
  for (const [path, bytes] of unowned) {
    const target = join(fake.piCodingAgentDir, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, bytes);
  }

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.match(fake.stdout.text, /agents\/explorer\.md: restored shipped version/);
  for (const [path, bytes] of unowned) {
    assert.deepEqual(await readFile(join(fake.piCodingAgentDir, path)), bytes);
    assert.ok(!fake.stdout.text.includes(path));
  }
  assert.doesNotMatch(fake.stdout.text, /private agent file bytes|previously shipped file bytes|\"local\"/);
});

test('install and update leave unreadable settings untouched, fail the model item, and restore shipped files', async (t) => {
  for (const [command, contents] of [
    ['install', Buffer.from('{"packages": [')],
    ['update', Buffer.from('[]')],
  ]) {
    const fake = createFakeHost(t);
    const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
    await writeFile(settingsPath, contents);

    const code = await run([command], fake.host);

    assert.equal(code, 2, fake.stdout.text);
    assert.deepEqual(await readFile(settingsPath), contents);
    assert.match(fake.stdout.text, /Failed:[\s\S]*default model \(claude-code\/claude-opus-5-5\): Pi settings unreadable; default model not set/);
    for (const path of shippedFiles) {
      assert.deepEqual(
        await readFile(join(fake.piCodingAgentDir, path)),
        await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url)),
        `${command} still restores ${path}`,
      );
    }
  }
});

test('install reports one required write failure and continues without temporary files', async (t) => {
  const fake = createFakeHost(t, {
    writeFailures: ({ agentDir }) => [join(agentDir, 'agents/merger.md')],
  });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Failed:\n  - agents\/merger\.md: agents\/merger\.md: EACCES/);
  for (const path of ['agents/researcher.md', 'agents/reviewer.md', 'extensions/pi-footer.json']) {
    const installed = await readFile(join(fake.piCodingAgentDir, path));
    const shipped = await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url));
    assert.deepEqual(installed, shipped, `${path} is still attempted after the failure`);
  }
  const agentEntries = await readdir(join(fake.piCodingAgentDir, 'agents'));
  assert.ok(!agentEntries.some((name) => name.includes('.lemonpi-') || name.endsWith('.tmp')));
});

test('install writes settings through a symlink, keeps the link and target mode, and backs up old bytes', async (t) => {
  const fake = createFakeHost(t);
  const link = join(fake.piCodingAgentDir, 'settings.json');
  const target = join(fake.home, 'dotfiles/settings.json');
  const oldSettings = {
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
    packages: [
      'npm:@tintinweb/pi-subagents',
      'git:github.com/earendil-works/pi-review',
      'npm:@juicesharp/rpiv-todo',
      'git:github.com/earendil-works/pi-claude-code',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:pi-web-access',
      'npm:pi-footer',
      'npm:@heyhuynhgiabuu/pi-pretty',
    ],
  };
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, `${JSON.stringify(oldSettings, null, 2)}\n`);
  await chmod(target, 0o600);
  const oldBytes = await readFile(target);
  await symlink(target, link);

  const code = await run(['install'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal(await readlink(link), target);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  const settings = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(settings.defaultProvider, 'claude-code');
  assert.equal(settings.defaultModel, 'claude-opus-5-5');
  assert.deepEqual(
    await readFile(join(fake.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z/settings.json')),
    oldBytes,
  );
});

test('update rewrites BOM-prefixed settings without the BOM and preserves unowned values', async (t) => {
  const fake = createFakeHost(t);
  const oldSettings = {
    lastChangelogVersion: '1.2.3',
    theme: 'dark',
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
    packages: [
      'npm:@tintinweb/pi-subagents',
      'git:github.com/earendil-works/pi-review',
      'npm:@juicesharp/rpiv-todo',
      'git:github.com/earendil-works/pi-claude-code',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:pi-web-access',
      'npm:pi-footer',
      'npm:@heyhuynhgiabuu/pi-pretty',
    ],
    modelThinkingLevels: { 'openai-codex/gpt-6-luna': 'high' },
  };
  await fake.writeGlobalSettings(oldSettings);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const oldJson = await readFile(settingsPath);
  const oldBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), oldJson]);
  await writeFile(settingsPath, oldBytes);

  const code = await run(['update'], fake.host);

  assert.equal(code, 0, fake.stdout.text);
  const writtenBytes = await readFile(settingsPath);
  assert.notDeepEqual(writtenBytes.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
  const settings = JSON.parse(writtenBytes.toString('utf8'));
  assert.equal(settings.defaultProvider, 'claude-code');
  assert.equal(settings.defaultModel, 'claude-opus-5-5');
  for (const key of ['theme', 'modelThinkingLevels', 'lastChangelogVersion', 'packages']) {
    assert.deepEqual(settings[key], oldSettings[key], `${key} is unchanged`);
  }
  assert.deepEqual(
    await readFile(join(fake.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z/settings.json')),
    oldBytes,
  );
});

test('a settings write failure names settings.json, keeps restoring shipped files, and removes its temp file', async (t) => {
  const fake = createFakeHost(t, {
    writeFailures: ({ agentDir }) => [join(agentDir, 'settings.json')],
  });
  await fake.writeGlobalSettings({
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
    packages: [
      'npm:@tintinweb/pi-subagents',
      'git:github.com/earendil-works/pi-review',
      'npm:@juicesharp/rpiv-todo',
      'git:github.com/earendil-works/pi-claude-code',
      'npm:@juicesharp/rpiv-ask-user-question',
      'npm:pi-web-access',
      'npm:pi-footer',
      'npm:@heyhuynhgiabuu/pi-pretty',
    ],
  });
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const originalSettings = await readFile(settingsPath);

  const code = await run(['install'], fake.host);

  assert.equal(code, 2, fake.stdout.text);
  assert.match(fake.stdout.text, /Failed:[\s\S]*default model \(claude-code\/claude-opus-5-5\): settings\.json: EACCES/);
  assert.deepEqual(await readFile(settingsPath), originalSettings);
  for (const path of shippedFiles) {
    assert.deepEqual(
      await readFile(join(fake.piCodingAgentDir, path)),
      await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url)),
      `${path} is still restored after settings failure`,
    );
  }
  for (const directory of [
    fake.piCodingAgentDir,
    join(fake.piCodingAgentDir, 'agents'),
    join(fake.piCodingAgentDir, 'extensions'),
    join(fake.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z'),
  ]) {
    const entries = await readdir(directory);
    assert.ok(!entries.some((name) => name.includes('.lemonpi-') || name.endsWith('.tmp')), directory);
  }
});

test('install leaves a shipped-file directory in place and reports EISDIR', async (t) => {
  const fake = createFakeHost(t);
  const target = join(fake.piCodingAgentDir, 'agents/merger.md');
  await mkdir(target, { recursive: true });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Failed:\n  - agents\/merger\.md: agents\/merger\.md: EISDIR/);
  assert.equal((await stat(target)).isDirectory(), true);
});

test('a failed backup leaves the differing shipped file unchanged and fails the run', async (t) => {
  const fake = createFakeHost(t, {
    writeFailures: ({ agentDir }) => [join(agentDir, 'lemonpi-backups')],
  });
  await seedShippedFiles(fake);
  const target = join(fake.piCodingAgentDir, 'agents/explorer.md');
  const oldBytes = Buffer.from('keep this content when backup fails');
  await writeFile(target, oldBytes);

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Failed:\n  - agents\/explorer\.md: backup failed; not changed/);
  assert.deepEqual(await readFile(target), oldBytes);
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
});

test('update applies the same shipped-file additions and restores as install', async (t) => {
  const install = createFakeHost(t);
  const update = createFakeHost(t);
  const oldBytes = Buffer.from('same old bytes on both hosts');
  for (const fake of [install, update]) {
    await seedShippedFiles(fake);
    await writeFile(join(fake.piCodingAgentDir, 'agents/explorer.md'), oldBytes);
    await rm(join(fake.piCodingAgentDir, 'agents/reviewer.md'));
  }

  const installCode = await run(['install'], install.host);
  const updateCode = await run(['update'], update.host);
  const fileActionLines = (output) => output.split('\n').filter((line) => (
    shippedFiles.some((path) => line.includes(path))
  ));
  const installLines = fileActionLines(install.stdout.text);
  const updateLines = fileActionLines(update.stdout.text);

  assert.equal(installCode, 0);
  assert.equal(updateCode, 0);
  assert.equal(updateLines.length, 2, update.stdout.text);
  assert.deepEqual(updateLines, installLines);
  assert.match(update.stdout.text, /agents\/explorer\.md: restored shipped version/);
  assert.match(update.stdout.text, /agents\/reviewer\.md: added/);
  for (const path of shippedFiles) {
    assert.deepEqual(
      await readFile(join(update.piCodingAgentDir, path)),
      await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url)),
    );
  }
  assert.deepEqual(
    await readFile(join(update.piCodingAgentDir, 'lemonpi-backups/2026-10-26T12-00-00.000Z/agents/explorer.md')),
    oldBytes,
  );
});

test('status reports the default model ok after install', async (t) => {
  const fake = createFakeHost(t);

  const installCode = await run(['install'], fake.host);
  const outputOffset = fake.stdout.text.length;
  const statusCode = await run(['status'], fake.host);
  const statusOutput = fake.stdout.text.slice(outputOffset);

  assert.equal(installCode, 0);
  assert.equal(statusCode, 0, statusOutput);
  assert.equal(
    statusOutput.split('default model (claude-code/claude-opus-5-5): ok').length - 1,
    1,
    statusOutput,
  );
});

test('install --skip footer still writes the footer config and skips only the package', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['install', '--skip', 'footer'], fake.host);

  assert.equal(code, 0);
  assert.match(fake.stdout.text, /extensions\/pi-footer\.json: added/);
  assert.match(fake.stdout.text, /footer \(npm:pi-footer\): held back by --skip/);
  assert.ok(!fake.runnerCalls.some(({ args }) => args[1] === 'npm:pi-footer'));
  assert.deepEqual(
    await readFile(join(fake.piCodingAgentDir, 'extensions/pi-footer.json')),
    await readFile(new URL('../src/owned-config/shipped-content/extensions/pi-footer.json', import.meta.url)),
  );
});

test('abort after the first owned rename leaves only the default-model write and no temp file', async (t) => {
  const fake = createFakeHost(t, { abortAfterRenames: 1 });

  const code = await run(['install'], fake.host);

  assert.equal(code, 130);
  const settings = await fake.readGlobalSettings();
  assert.equal(settings.defaultProvider, 'claude-code');
  assert.equal(settings.defaultModel, 'claude-opus-5-5');
  for (const path of shippedFiles) {
    await assert.rejects(access(join(fake.piCodingAgentDir, path)));
  }
  assert.deepEqual(await readdir(fake.piCodingAgentDir), ['settings.json']);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130/);
});
