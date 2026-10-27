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
  assert.doesNotMatch(fake.stdout.text, /default model \(claude-code\/claude-opus-5-5\)/);
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
});

test('a second install leaves shipped-file mtimes unchanged and counts all six as ok', async (t) => {
  const fake = createFakeHost(t);
  await seedShippedFiles(fake);
  const paths = shippedFiles.map((path) => join(fake.piCodingAgentDir, path));
  const before = await Promise.all(paths.map((path) => stat(path, { bigint: true })));

  const firstCode = await run(['install'], fake.host);
  const secondCode = await run(['install'], fake.host);

  assert.equal(secondCode, 0);
  assert.match(fake.stdout.text, /OK: 14 items/, fake.stdout.text);
  const after = await Promise.all(paths.map((path) => stat(path, { bigint: true })));
  assert.deepEqual(after.map(({ mtimeNs }) => mtimeNs), before.map(({ mtimeNs }) => mtimeNs));
  await assert.rejects(access(join(fake.piCodingAgentDir, 'lemonpi-backups')));
  assert.equal(firstCode, 0);
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

test('abort after the first owned rename leaves only the first shipped file and no temp file', async (t) => {
  const fake = createFakeHost(t, { abortAfterRenames: 1 });

  const code = await run(['install'], fake.host);

  assert.equal(code, 130);
  const firstPath = join(fake.piCodingAgentDir, shippedFiles[0]);
  assert.deepEqual(
    await readFile(firstPath),
    await readFile(new URL(`../src/owned-config/shipped-content/${shippedFiles[0]}`, import.meta.url)),
  );
  for (const path of shippedFiles.slice(1)) {
    await assert.rejects(access(join(fake.piCodingAgentDir, path)));
  }
  const agentEntries = await readdir(join(fake.piCodingAgentDir, 'agents'));
  assert.deepEqual(agentEntries, ['explorer.md']);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130/);
});
