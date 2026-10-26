import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';

test('fake Pi replaces an equivalent Git declaration while preserving object settings', async (t) => {
  const fake = createFakeHost(t);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const original = {
    packages: [{
      source: 'https://github.com/earendil-works/pi-claude-code.git',
      autoload: false,
      filters: ['extensions/review'],
    }],
  };
  await writeFile(settingsPath, JSON.stringify(original));

  const result = await fake.host.runner('pi', [
    'install', 'git:github.com/earendil-works/pi-claude-code', '--no-approve',
  ], { cwd: fake.host.tmpdir });

  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
    packages: [{
      source: 'git:github.com/earendil-works/pi-claude-code',
      autoload: false,
      filters: ['extensions/review'],
    }],
  });
  assert.equal(result.stdout, 'Installed git:github.com/earendil-works/pi-claude-code\n');
  assert.deepEqual(fake.runnerCalls, [{
    command: 'pi',
    args: ['install', 'git:github.com/earendil-works/pi-claude-code', '--no-approve'],
    options: { cwd: fake.host.tmpdir },
  }]);
});

test('fake Pi treats an unprefixed GitHub-looking path as local and appends Git packages', async (t) => {
  const fake = createFakeHost(t);
  const local = 'github.com/earendil-works/pi-review';
  const canonical = 'git:github.com/earendil-works/pi-review';
  await fake.writeGlobalSettings({ packages: [local] });

  await fake.host.runner('pi', ['install', canonical, '--no-approve']);

  assert.deepEqual(await fake.readGlobalSettings(), { packages: [local, canonical] });
});

test('fake Pi independently matches prefixed HTTPS and SSH sources after trimming', async (t) => {
  const canonical = 'git:github.com/example/tool';
  for (const declaration of [
    'git:https://github.com/example/tool.git',
    ' git:  ssh://git@github.com:8443/example/tool.git ',
    'git:http://github.com/example/tool',
    'git:git://github.com/example/tool.git',
  ]) {
    const fake = createFakeHost(t);
    const existing = { source: declaration, extensions: ['extensions/*.ts'], autoload: false };
    await fake.writeGlobalSettings({ packages: [existing] });

    await fake.host.runner('pi', ['install', canonical, '--no-approve']);

    assert.deepEqual(await fake.readGlobalSettings(), {
      packages: [{ ...existing, source: canonical }],
    });
  }
});

test('fake Pi matches npm declarations without their pinned versions', async (t) => {
  const fake = createFakeHost(t);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ packages: ['npm:pi-footer@1.2.3'] }));

  await fake.host.runner('pi', ['install', 'npm:pi-footer', '--no-approve']);

  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
    packages: ['npm:pi-footer'],
  });
});

test('fake Pi npm identity ignores scoped package ranges and tags', async (t) => {
  const canonical = 'npm:@scope/tool';
  for (const declaration of ['npm:@scope/tool@^2.0.0', 'npm:@scope/tool@next']) {
    const fake = createFakeHost(t);
    await fake.writeGlobalSettings({ packages: [declaration] });

    await fake.host.runner('pi', ['install', canonical, '--no-approve']);

    assert.deepEqual(await fake.readGlobalSettings(), { packages: [canonical] });
  }
});

test('fake Pi identity matches SSH and git-at scp spellings with refs', async (t) => {
  const canonical = 'git:github.com/example/tool';
  for (const declaration of [
    'ssh://git@github.com/example/tool.git',
    'git:git@github.com:example/tool.git@main',
  ]) {
    const fake = createFakeHost(t);
    await fake.writeGlobalSettings({ packages: [declaration] });

    await fake.host.runner('pi', ['install', canonical, '--no-approve']);

    assert.deepEqual(await fake.readGlobalSettings(), { packages: [canonical] });
  }
});

test('fake Pi replaces a git declaration pinned to a slash-containing branch ref', async (t) => {
  const fake = createFakeHost(t);
  const canonical = 'git:github.com/example/tool';
  await fake.writeGlobalSettings({
    packages: [{
      source: `${canonical}@feature/next`,
      filters: ['extensions/*.ts'],
      autoload: false,
    }],
  });

  await fake.host.runner('pi', ['install', canonical, '--no-approve']);

  assert.deepEqual(await fake.readGlobalSettings(), {
    packages: [{ source: canonical, filters: ['extensions/*.ts'], autoload: false }],
  });
});

test('fake Pi appends a package with a new identity', async (t) => {
  const fake = createFakeHost(t);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ packages: ['npm:my-unmanaged-tool'] }));

  await fake.host.runner('pi', ['install', 'npm:pi-footer', '--no-approve']);

  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
    packages: ['npm:my-unmanaged-tool', 'npm:pi-footer'],
  });
});

test('fake Pi remove deletes every declaration with the same identity', async (t) => {
  const fake = createFakeHost(t);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({
    packages: ['npm:pi-footer@1.2.3', 'npm:unmanaged-tool', 'npm:pi-footer@2.0.0'],
  }));

  const result = await fake.host.runner('pi', ['remove', 'npm:pi-footer', '--no-approve']);

  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
    packages: ['npm:unmanaged-tool'],
  });
  assert.equal(result.stdout, 'Removed npm:pi-footer\n');
});

test('fake Pi update reports success without changing the declaration', async (t) => {
  const fake = createFakeHost(t);
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const contents = JSON.stringify({ packages: [{ source: 'npm:pi-footer@1.2.3', autoload: false }] });
  await writeFile(settingsPath, contents);

  const result = await fake.host.runner('pi', ['update', 'npm:pi-footer', '--no-approve']);

  assert.equal(await readFile(settingsPath, 'utf8'), contents);
  assert.equal(result.stdout, 'Updated npm:pi-footer\n');
});

test('scripted fake Pi failure preserves settings and returns the chosen result', async (t) => {
  const source = 'npm:pi-footer';
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'install',
        source,
        code: 12,
        stdout: 'chosen stdout',
        stderr: 'chosen stderr',
      }],
    },
  });
  const settingsPath = join(fake.piCodingAgentDir, 'settings.json');
  const contents = JSON.stringify({ packages: ['npm:other-package'] });
  await writeFile(settingsPath, contents);

  const result = await fake.host.runner('pi', ['install', source, '--no-approve']);

  assert.equal(await readFile(settingsPath, 'utf8'), contents);
  assert.deepEqual(result, {
    code: 12,
    signal: null,
    stdout: 'chosen stdout',
    stderr: 'chosen stderr',
  });
});

test('scripted fake Pi notFound leaves the fixture unchanged', async (t) => {
  const source = 'npm:missing-package';
  const fake = createFakeHost(t, {
    fakePi: { failures: [{ subcommand: 'install', source, notFound: true }] },
  });
  const contents = JSON.stringify({ packages: ['npm:kept-package'] });
  await writeFile(join(fake.piCodingAgentDir, 'settings.json'), contents);

  const result = await fake.host.runner('pi', ['install', source, '--no-approve']);

  assert.equal(result.notFound, true);
  assert.equal(await readFile(join(fake.piCodingAgentDir, 'settings.json'), 'utf8'), contents);
});

test('fake Pi can abort the host controller after a selected call', async (t) => {
  const fake = createFakeHost(t, { fakePi: { abortAfterCall: 1 } });

  await fake.host.runner('pi', ['install', 'npm:pi-footer', '--no-approve']);

  assert.equal(fake.host.signal.aborted, true);
  assert.equal(fake.host.signal.reason, 'SIGINT');
  assert.equal(fake.runnerCalls.length, 1);
});

test('fake host writes project and global settings fixtures and reads the global fixture', async (t) => {
  const fake = createFakeHost(t);
  const globalSettings = { packages: ['npm:global-package'] };
  const projectSettings = { packages: ['npm:project-package'] };

  assert.equal(typeof fake.writeGlobalSettings, 'function');
  await fake.writeGlobalSettings(globalSettings);
  await fake.writeProjectSettings(projectSettings);

  assert.deepEqual(await fake.readGlobalSettings(), globalSettings);
  assert.equal(
    await fake.host.readFile(join(fake.cwd, '.pi', 'settings.json')),
    `${JSON.stringify(projectSettings, null, 2)}\n`,
  );
});

test('fake Pi reports its default Pi version', async (t) => {
  const fake = createFakeHost(t);

  assert.deepEqual(await fake.host.runner('pi', ['--version']), {
    code: 0,
    signal: null,
    stdout: 'Pi 1.4.0\n',
    stderr: '',
  });
});

test('shared fake host supplies isolated homes, captured streams, runner, stdin, and abort control', async (t) => {
  const fake = createFakeHost(t, {
    platform: 'test-platform',
    nodeVersion: 'v22.19.0',
    runnerResults: [
      { code: 7, signal: null, stdout: 'captured out', stderr: 'captured err' },
      { notFound: true },
    ],
  });

  assert.ok(fake.host.env.HOME);
  assert.ok(fake.host.env.PI_CODING_AGENT_DIR);
  await access(fake.host.env.HOME);
  await access(fake.host.env.PI_CODING_AGENT_DIR);
  assert.equal(fake.host.platform, 'test-platform');
  assert.equal(fake.host.nodeVersion, 'v22.19.0');

  fake.stdout.isTTY = true;
  fake.stdout.write('hello');
  fake.stderr.write('problem');
  assert.equal(fake.stdout.isTTY, true);
  assert.equal(fake.stdout.text, 'hello');
  assert.equal(fake.stderr.text, 'problem');

  const result = await fake.host.runner('pi', ['--version']);
  assert.deepEqual(result, { code: 7, signal: null, stdout: 'captured out', stderr: 'captured err' });
  assert.deepEqual(fake.runnerCalls, [{ command: 'pi', args: ['--version'], options: {} }]);
  assert.deepEqual(await fake.host.runner('missing-command'), { notFound: true });
  assert.throws(() => fake.host.stdin.isTTY, /stdin must not be read/);
  assert.equal(fake.host.signal, fake.abortController.signal);
  fake.abortController.abort('SIGINT');
  assert.equal(fake.host.signal.reason, 'SIGINT');
});

test('fake-host byte reads, symlink stats, and realpath support regular, chained, and dangling links', async (t) => {
  const fake = createFakeHost(t);
  const directory = join(fake.tmpdir, 'symlinks');
  const file = join(directory, 'file.bin');
  const firstLink = join(directory, 'first-link');
  const secondLink = join(directory, 'second-link');
  const danglingLink = join(directory, 'dangling-link');
  const missingFile = join(directory, 'missing.bin');
  await fake.host.mkdir(directory, { recursive: true });
  await writeFile(file, Buffer.from([0, 32, 255]));
  await symlink(secondLink, firstLink);
  await symlink(file, secondLink);
  await symlink('missing.bin', danglingLink);

  assert.deepEqual(await fake.host.readBytes(file), Buffer.from([0, 32, 255]));
  assert.deepEqual(await fake.host.readBytes(missingFile), { notFound: true });
  const linkFacts = await fake.host.lstat(firstLink);
  assert.equal(linkFacts.isFile, false);
  assert.equal(linkFacts.isDirectory, false);
  assert.equal(linkFacts.isSymbolicLink, true);
  assert.equal(typeof linkFacts.mode, 'number');
  assert.equal((await fake.host.stat(firstLink)).isFile, true);
  assert.equal((await fake.host.lstat(danglingLink)).isSymbolicLink, true);
  assert.deepEqual(await fake.host.stat(danglingLink), { notFound: true });
  assert.equal(await fake.host.realpath(firstLink), await realpath(file));
  let danglingRealpath;
  await assert.doesNotReject(async () => {
    danglingRealpath = await fake.host.realpath(danglingLink);
  });
  assert.equal(danglingRealpath, join(await realpath(directory), 'missing.bin'));
});

test('fake-host filesystem writes honor modes, rename, chmod, and missing rm', async (t) => {
  const fake = createFakeHost(t);
  const directory = join(fake.tmpdir, 'writes', 'nested');
  const source = join(directory, 'source.bin');
  const destination = join(directory, 'destination.bin');
  await fake.host.mkdir(directory, { recursive: true, mode: 0o700 });
  assert.equal((await fake.host.stat(join(fake.tmpdir, 'writes'))).mode & 0o777, 0o700);
  await fake.host.writeFile(source, Buffer.from('original'), { mode: 0o600 });
  assert.equal((await fake.host.stat(source)).mode & 0o777, 0o600);
  await fake.host.rename(source, destination);
  assert.deepEqual(await fake.host.readBytes(source), { notFound: true });
  assert.deepEqual(await fake.host.readBytes(destination), Buffer.from('original'));
  await fake.host.chmod(destination, 0o640);
  assert.equal((await fake.host.stat(destination)).mode & 0o777, 0o640);
  await assert.doesNotReject(() => fake.host.rm(join(directory, 'already-missing.bin')));
});

test('fake-host clock is fixed by default and can be overridden', (t) => {
  const defaultFake = createFakeHost(t);
  const configuredFake = createFakeHost(t, { now: new Date('2031-04-05T06:07:08.009Z') });

  assert.equal(defaultFake.host.now().toISOString(), '2026-10-26T12:00:00.000Z');
  assert.equal(configuredFake.host.now().toISOString(), '2031-04-05T06:07:08.009Z');
});

test('fake-host write failures deny listed paths and descendants without changing disk', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lemonpi-write-failures-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const exactTarget = join(directory, 'exact.txt');
  const subtree = join(directory, 'subtree');
  const childTarget = join(subtree, 'existing.txt');
  const exactRenameSource = join(directory, 'exact-source.txt');
  const childRenameSource = join(directory, 'child-source.txt');
  await mkdir(subtree, { recursive: true });
  await writeFile(exactTarget, 'keep exact');
  await writeFile(childTarget, 'keep child');
  await writeFile(exactRenameSource, 'exact source');
  await writeFile(childRenameSource, 'child source');
  const fake = createFakeHost(t, { writeFailures: [exactTarget, subtree] });

  await assert.rejects(fake.host.writeFile(exactTarget, 'overwrite'), { code: 'EACCES' });
  await assert.rejects(fake.host.writeFile(childTarget, 'overwrite'), { code: 'EACCES' });
  await assert.rejects(fake.host.rename(exactRenameSource, exactTarget), { code: 'EACCES' });
  await assert.rejects(fake.host.rename(childRenameSource, join(subtree, 'renamed.txt')), { code: 'EACCES' });
  await assert.rejects(fake.host.mkdir(exactTarget, { recursive: true }), { code: 'EACCES' });
  await assert.rejects(fake.host.mkdir(join(subtree, 'new-directory'), { recursive: true }), { code: 'EACCES' });

  assert.equal(await readFile(exactTarget, 'utf8'), 'keep exact');
  assert.equal(await readFile(childTarget, 'utf8'), 'keep child');
  assert.equal(await readFile(exactRenameSource, 'utf8'), 'exact source');
  assert.equal(await readFile(childRenameSource, 'utf8'), 'child source');
  await assert.rejects(access(join(subtree, 'renamed.txt')), { code: 'ENOENT' });
  await assert.rejects(access(join(subtree, 'new-directory')), { code: 'ENOENT' });
});

test('fake-host aborts its signal after the configured successful rename', async (t) => {
  const fake = createFakeHost(t, { abortAfterRenames: 1 });
  const source = join(fake.tmpdir, 'before.txt');
  const destination = join(fake.tmpdir, 'after.txt');
  await writeFile(source, 'renamed');

  await fake.host.rename(source, destination);

  assert.equal(fake.host.signal.aborted, true);
  assert.equal(fake.host.signal.reason, 'SIGINT');
  assert.equal(await readFile(destination, 'utf8'), 'renamed');
});
