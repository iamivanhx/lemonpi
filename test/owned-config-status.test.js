import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const ownedItems = [
  'default model (claude-code/claude-opus-5-5)',
  ...shippedFiles,
];
const managedPackages = [
  'npm:@tintinweb/pi-subagents',
  'git:github.com/earendil-works/pi-review',
  'npm:@juicesharp/rpiv-todo',
  'git:github.com/earendil-works/pi-claude-code',
  'npm:@juicesharp/rpiv-ask-user-question',
  'npm:pi-web-access',
  'npm:pi-footer',
  'npm:@heyhuynhgiabuu/pi-pretty',
];

async function seedOwnedConfig(fake, settings = {}) {
  await fake.writeGlobalSettings({
    defaultProvider: 'claude-code',
    defaultModel: 'claude-opus-5-5',
    packages: managedPackages,
    ...settings,
  });
  for (const path of shippedFiles) {
    const contents = await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url));
    const target = join(fake.piCodingAgentDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

function assertOwnedItems(output, outcome, reason) {
  const lines = ownedItems.map((name) => `${name}: ${outcome}${reason ? ` — ${reason}` : ''}`);
  const positions = lines.map((line) => {
    assert.equal(output.split(line).length - 1, 1, `${line} appears once`);
    return output.indexOf(line);
  });
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
}

async function snapshotTree(root) {
  const snapshot = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = path.slice(root.length + 1);
      if (entry.isSymbolicLink()) {
        snapshot.push([relativePath, 'link', await readlink(path)]);
      } else if (entry.isDirectory()) {
        snapshot.push([relativePath, 'directory']);
        await visit(path);
      } else {
        snapshot.push([relativePath, 'file', await readFile(path)]);
      }
    }
  }
  await visit(root);
  return snapshot;
}

test('the shipped agent definitions and footer config are present and named correctly', async () => {
  for (const path of shippedFiles) {
    let contents;
    try {
      contents = await readFile(new URL(`../src/owned-config/shipped-content/${path}`, import.meta.url));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    assert.ok(contents?.length > 0, `${path} exists and is non-empty`);
    if (path.startsWith('agents/')) {
      const frontMatter = contents.toString('utf8').match(/^---\s*\n([\s\S]*?)\n---/);
      assert.ok(frontMatter, `${path} has front matter`);
      const name = frontMatter[1].match(/^name:\s*(.*?)\s*$/m)?.[1];
      assert.equal(name, path.split('/').at(-1).replace(/\.md$/, ''));
    }
  }
});

test('shipped implementer, researcher, and reviewer pin the requested 6.1 models', async () => {
  for (const [agent, model] of [
    ['implementer', 'openai-codex/gpt-6.1-terra'],
    ['researcher', 'openai-codex/gpt-6.1-sol'],
    ['reviewer', 'openai-codex/gpt-6.1-sol'],
  ]) {
    const contents = await readFile(new URL(`../src/owned-config/shipped-content/agents/${agent}.md`, import.meta.url), 'utf8');
    const frontMatter = contents.match(/^---\s*\n([\s\S]*?)\n---/);
    assert.ok(frontMatter, `${agent} has front matter`);
    assert.equal(frontMatter[1].match(/^model:\s*(.*?)\s*$/m)?.[1], model, agent);
  }
});

test('status lists missing owned config once in manifest order', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['status'], fake.host);

  const items = ownedItems.map((name) => `${name}: drift — missing — \`install\` adds it`);
  const positions = items.map((item) => {
    assert.equal(fake.stdout.text.split(item).length - 1, 1, `${item} appears once`);
    return fake.stdout.text.indexOf(item);
  });
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.equal(code, 1);
});

test('status and doctor list all correctly owned config as ok', async (t) => {
  const status = createFakeHost(t);
  const doctor = createFakeHost(t);
  await seedOwnedConfig(status);
  await seedOwnedConfig(doctor);

  const statusCode = await run(['status'], status.host);
  const doctorCode = await run(['doctor'], doctor.host);

  assert.equal(statusCode, 0);
  assert.equal(doctorCode, 0);
  assertOwnedItems(status.stdout.text, 'ok');
  assertOwnedItems(doctor.stdout.text, 'ok');
});

test('status detects byte and CRLF-only changes to shipped files', async (t) => {
  for (const change of [
    ['one changed byte', (bytes) => {
      const changed = Buffer.from(bytes);
      changed[0] ^= 0xff;
      return changed;
    }],
    ['CRLF-only line endings', (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'))],
  ]) {
    const fake = createFakeHost(t);
    await seedOwnedConfig(fake);
    const target = join(fake.piCodingAgentDir, 'agents/explorer.md');
    const shipped = await readFile(new URL('../src/owned-config/shipped-content/agents/explorer.md', import.meta.url));
    await writeFile(target, change[1](shipped));

    const code = await run(['status'], fake.host);

    const changedItem = 'agents/explorer.md: drift — differs from shipped — `install` restores it';
    assert.equal(code, 1, change[0]);
    assert.equal(fake.stdout.text.split(changedItem).length - 1, 1, change[0]);
  }
});

test('default-model drift distinguishes absent keys without printing their values', async (t) => {
  const wrong = createFakeHost(t);
  await seedOwnedConfig(wrong, {
    defaultProvider: 'openai-codex',
    defaultModel: 'gpt-6-luna',
  });

  const wrongCode = await run(['status'], wrong.host);

  assert.equal(wrongCode, 1);
  assert.equal(
    wrong.stdout.text.split('default model (claude-code/claude-opus-5-5): drift — differs from shipped — `install` restores it').length - 1,
    1,
  );
  assert.doesNotMatch(wrong.stdout.text, /openai-codex|gpt-6-luna/);

  for (const missingKey of [
    { defaultModel: 'claude-opus-5-5', defaultProvider: undefined },
    { defaultProvider: 'claude-code', defaultModel: undefined },
  ]) {
    const fake = createFakeHost(t);
    await seedOwnedConfig(fake, missingKey);

    const code = await run(['status'], fake.host);

    assert.equal(code, 1);
    assert.equal(
      fake.stdout.text.split('default model (claude-code/claude-opus-5-5): drift — missing — `install` adds it').length - 1,
      1,
    );
  }
});

test('status follows owned-file symlinks and treats a dangling link as missing', async (t) => {
  const linked = createFakeHost(t);
  await seedOwnedConfig(linked);
  const linkedTarget = join(linked.piCodingAgentDir, 'agents/explorer.md');
  const outside = join(linked.home, 'dotfiles/explorer.md');
  await mkdir(dirname(outside), { recursive: true });
  const equalBytes = await readFile(new URL('../src/owned-config/shipped-content/agents/explorer.md', import.meta.url));
  await writeFile(outside, equalBytes);
  await rm(linkedTarget);
  await symlink(outside, linkedTarget);

  const linkedCode = await run(['status'], linked.host);

  assert.equal(linkedCode, 0);
  assert.ok(linked.stdout.text.includes('agents/explorer.md: ok'));

  const dangling = createFakeHost(t);
  await seedOwnedConfig(dangling);
  const danglingTarget = join(dangling.piCodingAgentDir, 'agents/explorer.md');
  await rm(danglingTarget);
  await symlink(join(dangling.home, 'not-present.md'), danglingTarget);

  const danglingCode = await run(['status'], dangling.host);

  assert.equal(danglingCode, 1);
  assert.ok(dangling.stdout.text.includes('agents/explorer.md: drift — missing — `install` adds it'));
});

test('status tolerates settings BOM and reports unreadable settings as one failure plus unknown model', async (t) => {
  const bom = createFakeHost(t);
  await seedOwnedConfig(bom);
  const settingsPath = join(bom.piCodingAgentDir, 'settings.json');
  const settingsBytes = await readFile(settingsPath);
  await writeFile(settingsPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), settingsBytes]));

  const bomCode = await run(['status'], bom.host);

  assert.equal(bomCode, 0);
  assert.ok(bom.stdout.text.includes('default model (claude-code/claude-opus-5-5): ok'));

  for (const [label, contents] of [
    ['unparseable settings', '{"packages": ['],
    ['array settings', '[]'],
  ]) {
    const fake = createFakeHost(t);
    await seedOwnedConfig(fake);
    await writeFile(join(fake.piCodingAgentDir, 'settings.json'), contents);

    const code = await run(['status'], fake.host);

    assert.equal(code, 2, label);
    assert.ok(fake.stdout.text.includes(
      'default model (claude-code/claude-opus-5-5): unknown — Pi settings unreadable',
    ), label);
    assert.equal((fake.stdout.text.match(/Pi settings: failed/g) ?? []).length, 1, label);
    for (const path of shippedFiles) assert.ok(fake.stdout.text.includes(`${path}: ok`), `${label}: ${path}`);
  }
});

test('status fails an owned file that exists as a directory with a sanitized path and code', async (t) => {
  const fake = createFakeHost(t);
  await seedOwnedConfig(fake);
  const target = join(fake.piCodingAgentDir, 'agents/explorer.md');
  await rm(target);
  await mkdir(target);

  const code = await run(['status'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('agents/explorer.md: failed — agents/explorer.md: EISDIR'));
});

test('status limits owned-file failure reasons to a relative path and error code', async (t) => {
  const invalidCode = createFakeHost(t);
  await seedOwnedConfig(invalidCode);
  const invalidTarget = join(invalidCode.piCodingAgentDir, 'agents/explorer.md');
  const stat = invalidCode.host.stat;
  invalidCode.host.stat = async (path) => {
    if (path === invalidTarget) {
      const error = new Error('permission denied');
      error.code = 'EACCES /synthetic/private-agent-path';
      throw error;
    }
    return stat(path);
  };

  const invalidCodeResult = await run(['status'], invalidCode.host);

  assert.equal(invalidCodeResult, 2);
  assert.match(
    invalidCode.stdout.text,
    /agents\/explorer\.md: failed — agents\/explorer\.md: UNKNOWN/,
  );
  assert.doesNotMatch(invalidCode.stdout.text, /synthetic\/private-agent-path/);

  const unreadable = createFakeHost(t);
  await seedOwnedConfig(unreadable);
  const unreadableTarget = join(unreadable.piCodingAgentDir, 'agents/explorer.md');
  const readBytes = unreadable.host.readBytes;
  unreadable.host.readBytes = async (path) => {
    if (path === unreadableTarget) {
      const error = new Error('read failed: /synthetic/private-agent-path');
      error.code = 'EACCES';
      throw error;
    }
    return readBytes(path);
  };

  const unreadableResult = await run(['status'], unreadable.host);

  assert.equal(unreadableResult, 2);
  assert.match(
    unreadable.stdout.text,
    /agents\/explorer\.md: failed — agents\/explorer\.md: EACCES/,
  );
  assert.doesNotMatch(unreadable.stdout.text, /synthetic\/private-agent-path/);
});

test('status never reports unowned agent files, extension configs, or settings keys', async (t) => {
  const fake = createFakeHost(t);
  await seedOwnedConfig(fake, {
    localOnlySettingsMarker: 'unowned-setting-value',
    theme: 'unowned-theme-value',
  });
  await writeFile(join(fake.piCodingAgentDir, 'agents/mine.md'), 'unowned agent content');
  await writeFile(join(fake.piCodingAgentDir, 'extensions/other-config.json'), '{"local":true}');

  const code = await run(['status'], fake.host);

  assert.equal(code, 0);
  for (const marker of [
    'mine.md', 'other-config.json', 'localOnlySettingsMarker', 'unowned-setting-value',
    'unowned-theme-value', 'unowned agent content',
  ]) {
    assert.ok(!fake.stdout.text.includes(marker), `${marker} is not reported`);
  }
});

test('status and doctor leave the agent directory byte-identical without backups', async (t) => {
  const fake = createFakeHost(t);
  await seedOwnedConfig(fake);
  await writeFile(join(fake.piCodingAgentDir, 'agents/mine.md'), 'keep this file');
  const before = await snapshotTree(fake.piCodingAgentDir);

  const statusCode = await run(['status'], fake.host);
  const doctorCode = await run(['doctor'], fake.host);
  const after = await snapshotTree(fake.piCodingAgentDir);

  assert.equal(statusCode, 0);
  assert.equal(doctorCode, 0);
  assert.deepEqual(after, before);
  assert.ok(!after.some(([path]) => path === 'lemonpi-backups'));
});

test('skills retains its existing output and exit code without owned-config inventory', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['skills'], fake.host);

  assert.equal(code, 0);
  assert.equal(fake.stdout.text, 'lemonpi skills — Pi 1.4.0\nPrerequisites:\n  Pi: ok (1.4.0)\nResult: ok — exit 0 means the run completed successfully.\n');
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  for (const name of ownedItems) assert.ok(!fake.stdout.text.includes(name));
});
