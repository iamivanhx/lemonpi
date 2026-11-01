import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.js';
import { mergeModelsConfig } from '../src/owned-config/models-config.js';
import { openaiModels } from '../src/owned-config/openai-models.js';
import { createFakeHost } from './helpers/fake-host.js';
import { seedOwnedConfigFixture as seedFixture } from './helpers/owned-config-fixture.js';

async function seedOwnedConfigFixture(fake) {
  await fake.writeGlobalSettings({});
  await seedFixture(fake);
}

const name = 'OpenAI models (models.json)';
const backupStamp = '2026-10-26T12-00-00.000Z';

function model(provider, id) {
  const config = openaiModels.providers[provider];
  return { ...config.models.find((entry) => entry.id === id), ...config.modelOverrides[id] };
}

test('OpenAI models use documented API limits, reasoning efforts, modalities and tiered Standard prices', () => {
  const expected = [
    ['gpt-6-astra', 10, 50, 1, 12.5, false],
    ['gpt-6.1-sol', 2, 10, 0.1, 2.5, false],
    ['gpt-6.1-terra', 1, 5, 0.05, 1.25, true],
    ['gpt-6-luna', 0.1, 0.5, 0.01, 0.125, true],
  ];
  for (const [id, input, output, cacheRead, cacheWrite, none] of expected) {
    const api = model('openai', id);
    assert.equal(api.contextWindow, 1050000, id);
    assert.equal(api.maxTokens, 128000);
    assert.deepEqual(api.input, ['text', 'image']);
    assert.equal(api.reasoning, true);
    assert.deepEqual(api.thinkingLevelMap, {
      off: none ? 'none' : null, minimal: null,
      low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
    });
    assert.deepEqual(api.cost, {
      input, output, cacheRead, cacheWrite,
      tiers: [{ inputTokensAbove: 272000, input: input * 2, output: output * 1.5, cacheRead: cacheRead * 2, cacheWrite: cacheWrite * 2 }],
    });
    assert.equal(model('openai-codex', id).contextWindow, id === 'gpt-6.1-sol' ? 500000 : 272000);
  }
  assert.equal(model('openai', 'gpt-6.1-terra').api, 'openai-responses');
  assert.equal(model('openai-codex', 'gpt-6.1-terra').api, 'openai-codex-responses');
  assert.equal(model('openai', 'gpt-6.1-terra').compat.supportsExplicitPromptCacheMode, true);
  for (const provider of Object.values(openaiModels.providers)) {
    assert.equal(provider.apiKey, undefined);
    assert.equal(provider.baseUrl, undefined);
    assert.equal(provider.models[0].baseUrl, undefined, 'inherit configured provider URL');
  }
});

test('merging owns only declared metadata, preserves user models, endpoints, credentials and extra fields', () => {
  const existing = {
    $schema: 'https://pi.dev/schemas/models.schema.json',
    providers: {
      other: { baseUrl: 'http://localhost:1234', models: [{ id: 'local' }] },
      openai: {
        apiKey: '$MY_OPENAI_KEY', baseUrl: 'https://proxy.example/v1', headers: { custom: 'keep' },
        models: [{ id: 'private' }, { id: 'gpt-6.1-terra', contextWindow: 1, headers: { extra: 'keep' } }],
        modelOverrides: { 'gpt-6-astra': { contextWindow: 1, compat: { supportsToolSearch: true } }, custom: { maxTokens: 100 } },
      },
    },
  };
  const snapshot = structuredClone(existing);
  const merged = mergeModelsConfig(existing);
  assert.deepEqual(existing, snapshot, 'input must not be mutated');
  assert.deepEqual(merged.providers.other, existing.providers.other);
  const api = merged.providers.openai;
  assert.equal(api.apiKey, '$MY_OPENAI_KEY');
  assert.equal(api.baseUrl, 'https://proxy.example/v1');
  assert.deepEqual(api.headers, { custom: 'keep' });
  assert.deepEqual(api.models[0], { id: 'private' });
  assert.deepEqual(api.models[1].headers, { extra: 'keep' });
  assert.equal(api.models[1].contextWindow, 1050000);
  assert.deepEqual(api.modelOverrides['gpt-6-astra'].compat, { supportsToolSearch: true });
  assert.deepEqual(api.modelOverrides.custom, { maxTokens: 100 });
  assert.deepEqual(mergeModelsConfig(merged), merged);
});

for (const command of ['install', 'update']) {
  test(`${command} adds models.json, backs up changes privately, and is idempotent`, async (t) => {
    const fake = createFakeHost(t);
    const target = join(fake.piCodingAgentDir, 'models.json');
    assert.equal(await run([command], fake.host), 0, fake.stdout.text);
    const initial = await readFile(target);
    assert.deepEqual(JSON.parse(initial), openaiModels);
    const drifted = JSON.parse(initial);
    drifted.providers.openai.apiKey = '$CUSTOM_KEY';
    drifted.providers.openai.modelOverrides['gpt-6-astra'].contextWindow = 1;
    const before = `\uFEFF${JSON.stringify(drifted)}`;
    await writeFile(target, before);
    await chmod(target, 0o600);
    assert.equal(await run([command], fake.host), 0, fake.stdout.text);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    const backup = join(fake.piCodingAgentDir, 'lemonpi-backups', backupStamp, 'models.json');
    assert.equal(await readFile(backup, 'utf8'), before);
    assert.equal((await stat(backup)).mode & 0o777, 0o600);
    const corrected = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(corrected.providers.openai.apiKey, '$CUSTOM_KEY');
    assert.equal(corrected.providers.openai.modelOverrides['gpt-6-astra'].contextWindow, 1050000);
    const mtime = (await stat(target)).mtimeMs;
    assert.equal(await run([command], fake.host), 0, fake.stdout.text);
    assert.equal((await stat(target)).mtimeMs, mtime);
    assert.ok(!fake.stdout.text.includes('$CUSTOM_KEY'));
  });
}

test('status detects metadata drift, ignores formatting and extra fields, and never writes models.json', async (t) => {
  const fake = createFakeHost(t);
  await seedOwnedConfigFixture(fake);
  const target = join(fake.piCodingAgentDir, 'models.json');
  const config = mergeModelsConfig({ extra: 'secret-not-in-output' });
  const bytes = `\uFEFF${JSON.stringify(config)}`;
  await writeFile(target, bytes);
  assert.equal(await run(['status'], fake.host), 1); // Packages remain missing.
  assert.ok(fake.stdout.text.includes(`- ${name}: ok`), fake.stdout.text);
  assert.equal(await readFile(target, 'utf8'), bytes);
  config.providers['openai-codex'].modelOverrides['gpt-6-luna'].thinkingLevelMap.max = null;
  await writeFile(target, JSON.stringify(config));
  const outputOffset = fake.stdout.text.length;
  await run(['status'], fake.host);
  assert.ok(fake.stdout.text.slice(outputOffset).includes(`${name}: drift`), fake.stdout.text);
  assert.ok(!fake.stdout.text.includes('secret-not-in-output'));
});

for (const contents of ['{ "apiKey": "secret-never-print",', 'null', '[]', '{"providers":[]}', '{"providers":{"openai":{"models":{}}}}']) {
  test(`invalid models.json is preserved without leaking its contents: ${contents.slice(0, 20)}`, async (t) => {
    const fake = createFakeHost(t);
    await seedOwnedConfigFixture(fake);
    const target = join(fake.piCodingAgentDir, 'models.json');
    await writeFile(target, contents);
    for (const args of [['install'], ['install', '--dry-run'], ['status'], ['doctor']]) {
      const code = await run(args, fake.host);
      if (args.includes('--dry-run')) assert.equal(code, 0); // Existing preview exit policy.
      else assert.equal(code, 2);
      assert.equal(await readFile(target, 'utf8'), contents);
    }
    assert.ok(!fake.stdout.text.includes('secret-never-print'));
    assert.ok(fake.stdout.text.includes('models.json unreadable or invalid; not changed'));
  });
}

test('models dry-run previews changes without writes; a symlink install writes through and keeps the link', async (t) => {
  const fake = createFakeHost(t);
  await seedOwnedConfigFixture(fake);
  const target = join(fake.piCodingAgentDir, 'models.json');
  const external = join(fake.home, 'external-models.json');
  const original = '{"providers":{"other":{"models":[{"id":"user"}]}}}';
  await writeFile(external, original);
  await rm(target);
  await symlink(external, target);
  const before = (await stat(external)).mtimeMs;
  assert.equal(await run(['install', '--dry-run'], fake.host), 0, fake.stdout.text);
  assert.equal(await readFile(external, 'utf8'), original);
  assert.equal((await stat(external)).mtimeMs, before);
  assert.ok(fake.stdout.text.includes('would configure OpenAI models'));
  assert.equal(await run(['install'], fake.host), 0, fake.stdout.text);
  assert.equal(await readlink(target), external);
  assert.equal((await lstat(target)).isSymbolicLink(), true);
  assert.equal(JSON.parse(await readFile(external)).providers.other.models[0].id, 'user');
  assert.equal(await readFile(join(fake.piCodingAgentDir, 'lemonpi-backups', backupStamp, 'models.json'), 'utf8'), original);
});

test('a models backup failure preserves the target and reports a required failure', async (t) => {
  const fake = createFakeHost(t, { writeFailures: ({ agentDir }) => [join(agentDir, 'lemonpi-backups')] });
  await seedOwnedConfigFixture(fake);
  const target = join(fake.piCodingAgentDir, 'models.json');
  await writeFile(target, '{}');
  assert.equal(await run(['install'], fake.host), 2, fake.stdout.text);
  assert.equal(await readFile(target, 'utf8'), '{}');
  assert.ok(fake.stdout.text.includes(`${name}: backup failed; not changed`));
  assert.ok(!(await readdir(fake.piCodingAgentDir)).some((entry) => entry.endsWith('.tmp')));
});

test('a directory at models.json fails safely while later shipped files are installed', async (t) => {
  const fake = createFakeHost(t);
  await mkdir(join(fake.piCodingAgentDir, 'models.json'));
  assert.equal(await run(['install'], fake.host), 2);
  assert.ok(fake.stdout.text.includes('models.json: EISDIR'), fake.stdout.text);
  assert.equal((await stat(join(fake.piCodingAgentDir, 'agents/explorer.md'))).isFile(), true);
});
