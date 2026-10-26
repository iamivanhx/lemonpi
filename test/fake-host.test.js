import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
