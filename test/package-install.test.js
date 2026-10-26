import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';

const catalogSources = [
  'npm:@tintinweb/pi-subagents',
  'git:github.com/earendil-works/pi-review',
  'npm:@juicesharp/rpiv-todo',
  'git:github.com/earendil-works/pi-claude-code',
  'npm:@juicesharp/rpiv-ask-user-question',
  'npm:pi-web-access',
  'npm:pi-footer',
  'npm:@heyhuynhgiabuu/pi-pretty',
];

test('install dry-run previews missing packages without calling Pi or changing settings', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: [] });
  const before = await fake.readGlobalSettings();

  const code = await run(['install', '--dry-run'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  assert.deepEqual(await fake.readGlobalSettings(), before);
  for (const source of catalogSources) {
    assert.ok(fake.stdout.text.includes(`${source}): would install`), `${source} is previewed as install`);
  }
});

test('unknown skip IDs are rejected before all runner calls and list catalog IDs', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['install', '--skip', 'nope'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stderr.text, /nope/);
  for (const id of ['subagents', 'review', 'todo', 'claude-code', 'ask-user', 'web-access', 'footer', 'pretty']) {
    assert.ok(fake.stderr.text.includes(id), `${id} appears in the allowed ID list`);
  }
  assert.deepEqual(fake.runnerCalls, []);
});

test('skip leaves optional and required packages alone and never causes drift failure', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: [] });

  const skippedOptionalCode = await run(['install', '--skip', ' todo , pretty '], fake.host);

  assert.equal(skippedOptionalCode, 0);
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args[1]),
    catalogSources.filter((_, index) => ![2, 7].includes(index)));
  assert.match(fake.stdout.text, /Skipped:/);
  assert.ok(fake.stdout.text.includes('todo (npm:@juicesharp/rpiv-todo): held back by --skip'));
  assert.ok(fake.stdout.text.includes('pretty (npm:@heyhuynhgiabuu/pi-pretty): held back by --skip'));

  const required = createFakeHost(t);
  await required.writeGlobalSettings({ packages: catalogSources.slice(4) });
  const skippedRequiredCode = await run(
    ['install', '--skip', 'subagents,review,todo,claude-code'],
    required.host,
  );

  assert.equal(skippedRequiredCode, 0);
  assert.deepEqual(required.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  assert.match(required.stdout.text, /Skipped:/);
  for (const [id, source] of [
    ['subagents', catalogSources[0]],
    ['review', catalogSources[1]],
    ['todo', catalogSources[2]],
    ['claude-code', catalogSources[3]],
  ]) {
    assert.ok(required.stdout.text.includes(`${id} (${source}): held back by --skip`));
  }
});

test('install stops after aborting from the first package call', async (t) => {
  const fake = createFakeHost(t, { fakePi: { abortAfterCall: 2 } });
  await fake.writeGlobalSettings({ packages: [] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 130);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [
    ['pi', ['--version']],
    ['pi', ['install', catalogSources[0], '--no-approve']],
  ]);
  assert.match(fake.stdout.text, /interrupted/i);
  assert.match(fake.stdout.text, /Result: interrupted — exit 130/);
  assert.deepEqual(await fake.readGlobalSettings(), { packages: [catalogSources[0]] });
});

test('install stops before package calls when global settings cannot be read', async (t) => {
  const empty = createFakeHost(t);
  await writeFile(join(empty.piCodingAgentDir, 'settings.json'), '');

  const emptyCode = await run(['install'], empty.host);

  assert.equal(emptyCode, 2);
  assert.match(empty.stdout.text, /Pi settings: can't parse/);
  assert.deepEqual(empty.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);

  const secret = 'settings-path-secret-value';
  const fake = createFakeHost(t, { env: { LEMON_ACCESS_TOKEN: secret } });
  const agentDirectory = join(fake.home, `agent-${secret}`);
  await mkdir(agentDirectory);
  fake.host.env.PI_CODING_AGENT_DIR = agentDirectory;
  fake.host.readFile = async () => { throw new Error(`fixture read failed ${secret}`); };

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Failed:/);
  assert.match(fake.stdout.text, /Pi settings: can't parse .*fixture read failed \[redacted\]/);
  assert.doesNotMatch(`${fake.stdout.text}${fake.stderr.text}`, new RegExp(secret));
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
});

test('install reports spawn errors and sanitizes bare environment secrets', async (t) => {
  const secret = 'runner-error-secret-value';
  const fake = createFakeHost(t, {
    env: { APP_SECRET: secret },
    runnerResults: [
      { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' },
      { code: null, signal: null, stdout: '', stderr: '', error: `Error (EACCES): ${secret}` },
    ],
  });
  await fake.writeGlobalSettings({ packages: [] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Error \(EACCES\)/);
  assert.doesNotMatch(fake.stdout.text, new RegExp(secret));
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args[1]), catalogSources);
});

test('install reports Pi not found for a package as a failure', async (t) => {
  const fake = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'install',
        source: catalogSources[0],
        notFound: true,
      }],
    },
  });
  await fake.writeGlobalSettings({ packages: [] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.ok(fake.stdout.text.includes('subagents (npm:@tintinweb/pi-subagents): pi install npm:@tintinweb/pi-subagents --no-approve'));
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args[1]), catalogSources);
  assert.deepEqual(await fake.readGlobalSettings(), { packages: catalogSources.slice(1) });
});

test('install reports success without a declaration as a failed action', async (t) => {
  const fake = createFakeHost(t, {
    runnerResults: [
      { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' },
      { code: 0, signal: null, stdout: 'claiming success only', stderr: '' },
    ],
  });
  await fake.writeGlobalSettings({ packages: [] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Failed:/);
  assert.ok(fake.stdout.text.includes('subagents (npm:@tintinweb/pi-subagents): pi install npm:@tintinweb/pi-subagents --no-approve'));
  assert.match(fake.stdout.text, /claiming success only/);
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args[1]), catalogSources);
  assert.deepEqual(await fake.readGlobalSettings(), { packages: catalogSources.slice(1) });
});

test('install continues after required and optional failures and sanitizes all Pi diagnostics', async (t) => {
  const outputSecret = 'bare-output-secret-value';
  const fake = createFakeHost(t, {
    env: { LEMON_BEARER_TOKEN: outputSecret },
    fakePi: {
      failures: [
        {
          subcommand: 'install',
          source: catalogSources[0],
          code: 17,
          stdout: 'required package stdout',
          stderr: `latest requires Pi upgrade; ${outputSecret}`,
        },
        {
          subcommand: 'install',
          source: catalogSources[5],
          code: 23,
          stdout: 'optional package stdout',
          stderr: 'optional package stderr',
        },
      ],
    },
  });
  await fake.writeGlobalSettings({ packages: [] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.deepEqual(fake.runnerCalls.slice(1).map(({ args }) => args[1]), catalogSources);
  assert.match(fake.stdout.text, /Failed:/);
  assert.match(fake.stdout.text, /pi install npm:@tintinweb\/pi-subagents --no-approve/);
  assert.match(fake.stdout.text, /required package stdout/);
  assert.match(fake.stdout.text, /latest requires Pi upgrade/);
  assert.match(fake.stdout.text, /pi install npm:pi-web-access --no-approve/);
  assert.match(fake.stdout.text, /optional package stderr/);
  assert.doesNotMatch(fake.stdout.text, new RegExp(outputSecret));
  assert.match(fake.stdout.text, /Changed:/);
  assert.match(fake.stdout.text, /npm:@juicesharp\/rpiv-todo\): installed/);

  const optional = createFakeHost(t, {
    fakePi: {
      failures: [{
        subcommand: 'install',
        source: catalogSources[5],
        code: 23,
        stderr: 'optional failure',
      }],
    },
  });
  await optional.writeGlobalSettings({ packages: [] });

  const optionalCode = await run(['install'], optional.host);

  assert.equal(optionalCode, 1);
  assert.deepEqual(optional.runnerCalls.slice(1).map(({ args }) => args[1]), catalogSources);
  assert.match(optional.stdout.text, /optional failure/);
});

test('skills stays separate from packages and --skip-skills does not skip package install', async (t) => {
  const skills = createFakeHost(t);
  const skillsCode = await run(['skills'], skills.host);

  assert.equal(skillsCode, 0);
  assert.deepEqual(skills.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  for (const source of catalogSources) assert.ok(!skills.stdout.text.includes(source));

  const packages = createFakeHost(t);
  await packages.writeGlobalSettings({ packages: [] });
  const installCode = await run(['install', '--skip-skills'], packages.host);

  assert.equal(installCode, 0);
  assert.deepEqual(packages.runnerCalls.slice(1).map(({ args }) => args[1]), catalogSources);
});

test('install adds only undeclared packages when some managed packages are present', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: [catalogSources[0], catalogSources[2], catalogSources[5]] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 0);
  assert.deepEqual(
    fake.runnerCalls.slice(1).map(({ args, options }) => [args, options.cwd]),
    catalogSources
      .filter((_, index) => ![0, 2, 5].includes(index))
      .map((source) => [['install', source, '--no-approve'], fake.tmpdir]),
  );
  assert.match(fake.stdout.text, /OK: 3 items/);
  assert.match(fake.stdout.text, /Changed:/);
  assert.equal((fake.stdout.text.match(/: installed/g) ?? []).length, 5);
});

test('install adds every missing package in catalog order and is idempotent', async (t) => {
  const fake = createFakeHost(t);
  await fake.writeGlobalSettings({ packages: [] });

  const firstCode = await run(['install'], fake.host);

  assert.equal(firstCode, 0);
  assert.match(fake.stdout.text, /Changed:/);
  assert.equal((fake.stdout.text.match(/: installed/g) ?? []).length, 8);
  assert.deepEqual(
    fake.runnerCalls.map(({ command, args, options }) => [command, args, options.cwd]),
    [
      ['pi', ['--version'], undefined],
      ...catalogSources.map((source) => ['pi', ['install', source, '--no-approve'], fake.tmpdir]),
    ],
  );
  for (const source of catalogSources) assert.ok(fake.stdout.text.includes(`${source}): installed`), `${source} is reported installed`);

  const secondCode = await run(['install'], fake.host);

  assert.equal(secondCode, 0);
  assert.equal(fake.runnerCalls.length, 10);
  assert.deepEqual(fake.runnerCalls.slice(9).map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  assert.match(fake.stdout.text, /OK: 8 items/);
});
