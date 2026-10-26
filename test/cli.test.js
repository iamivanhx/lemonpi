import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';
import { runner } from '../bin/runner.js';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('run prints the package version without invoking the runner', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['--version'], fake.host);

  assert.equal(code, 0);
  assert.equal(fake.stdout.text, `${manifest.version}\n`);
  assert.deepEqual(fake.runnerCalls, []);
});

const passingPi = { code: 0, signal: null, stdout: 'Pi 1.4.0\n', stderr: '' };

test('run defaults to install when argv is empty', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });

  const code = await run([], fake.host);

  assert.equal(code, 0);
  assert.match(fake.stdout.text, /lemonpi install/);
  assert.match(fake.stdout.text, /Pi 1\.4\.0/);
});

test('run accepts each supported command', async (t) => {
  for (const command of ['install', 'update', 'status', 'doctor', 'skills']) {
    const fake = createFakeHost(t, { runnerResults: [passingPi] });

    const code = await run([command], fake.host);

    assert.equal(code, 0);
    assert.match(fake.stdout.text, new RegExp(`lemonpi ${command}`));
    assert.match(fake.stdout.text, /Pi 1\.4\.0/);
    assert.match(fake.stdout.text, /Pi: ok/);
    assert.match(fake.stdout.text, /Result: ok.*exit 0/);
    assert.deepEqual(fake.runnerCalls.map(({ command: calledCommand, args }) => [calledCommand, args]), [['pi', ['--version']]]);
  }
});

test('run refuses unsupported platforms before running any command', async (t) => {
  for (const platform of ['win32', 'freebsd']) {
    const fake = createFakeHost(t, { platform });

    const code = await run(['status'], fake.host);

    assert.equal(code, 2);
    assert.ok(fake.stderr.text.includes('Windows is not supported; lemonpi runs on macOS and Debian/Linux'));
    assert.equal(fake.stdout.text, '');
    assert.deepEqual(fake.runnerCalls, []);
  }
});

test('run refuses Node versions below 22.19.0 before running any command', async (t) => {
  const fake = createFakeHost(t, { nodeVersion: '22.18.0' });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stderr.text, /22\.18\.0/);
  assert.match(fake.stderr.text, /22\.19\.0/);
  assert.equal(fake.stdout.text, '');
  assert.deepEqual(fake.runnerCalls, []);
});

test('missing Pi is a failed prerequisite in the summary without an install suggestion', async (t) => {
  const fake = createFakeHost(t, {
    runnerResults: [{ notFound: true, code: null, signal: null, stdout: '', stderr: '' }],
  });

  const code = await run(['status'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /lemonpi status/);
  assert.match(fake.stdout.text, /Pi: failed/i);
  assert.match(fake.stdout.text, /Pi not found on PATH; lemonpi configures an existing Pi and never installs it/);
  assert.match(fake.stdout.text, /command: pi --version/);
  assert.doesNotMatch(`${fake.stdout.text}${fake.stderr.text}`, /(?:run|try)\s+.*(?:install|upgrade)\s+pi/i);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
});

test('Pi version output must parse and meet the minimum, while supported Node and Pi versions pass', async (t) => {
  for (const stdout of ['garbage', '1.3.9']) {
    const fake = createFakeHost(t, { runnerResults: [{ ...passingPi, stdout }] });
    const code = await run(['install'], fake.host);

    assert.equal(code, 2);
    assert.match(fake.stdout.text, /Pi: failed/i);
    assert.match(fake.stdout.text, stdout === 'garbage' ? /unparseable/i : /1\.3\.9/);
    assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  }

  for (const [stdout, nodeVersion] of [
    ['1.4.0', '22.19.0'],
    ['v1.4.0', '24.14.1'],
    ['pi 1.4.0', '22.19.0'],
    ['pi v1.4.0+build.7', '22.19.0+build.7'],
    ['1.5.2', '24.14.1'],
  ]) {
    const fake = createFakeHost(t, { nodeVersion, runnerResults: [{ ...passingPi, stdout }] });
    const code = await run(['install'], fake.host);

    assert.equal(code, 0);
    assert.match(fake.stdout.text, /Pi: ok/);
    if (stdout.includes('+build.7')) assert.match(fake.stdout.text, /Pi 1\.4\.0\+build\.7/);
    assert.match(fake.stdout.text, /Result: ok.*exit 0/);
    assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  }
});

test('install --dry-run still checks Pi and refuses when Pi is missing', async (t) => {
  const fake = createFakeHost(t, {
    runnerResults: [{ notFound: true, code: null, signal: null, stdout: '', stderr: '' }],
  });

  const code = await run(['install', '--dry-run'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stdout.text, /Pi: failed/);
  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
});

test('a passing run calls pi --version exactly once', async (t) => {
  const fake = createFakeHost(t, { runnerResults: [passingPi] });

  await run(['install'], fake.host);

  assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
});

test('run rejects an unknown command with a one-line usage error', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['instal'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stderr.text, /unknown command.*lemonpi --help/);
  assert.equal(fake.stderr.text.trimEnd().split('\n').length, 1);
  assert.equal(fake.stdout.text, '');
});

test('run rejects cut flags as unknown options', async (t) => {
  for (const flag of ['--yes', '--verbose', '--json', '--network', '--repo', '--only', '--except']) {
    const fake = createFakeHost(t);

    const code = await run([flag], fake.host);

    assert.equal(code, 2);
    assert.ok(fake.stderr.text.includes(`unknown option '${flag}'`));
    assert.match(fake.stderr.text, /lemonpi --help/);
    assert.equal(fake.stderr.text.trimEnd().split('\n').length, 1);
    assert.equal(fake.stdout.text, '');
  }
});

test('run rejects flags that are not supported by a command', async (t) => {
  for (const args of [
    ['status', '--dry-run'],
    ['doctor', '--dry-run'],
    ['skills', '--skip', 'x'],
    ['status', '--skip-skills'],
    ['skills', '--skip-skills'],
  ]) {
    const fake = createFakeHost(t);

    const code = await run(args, fake.host);

    assert.equal(code, 2);
    assert.match(fake.stderr.text, /not valid for command/);
    assert.match(fake.stderr.text, /lemonpi --help/);
    assert.equal(fake.stderr.text.trimEnd().split('\n').length, 1);
    assert.equal(fake.stdout.text, '');
  }
});

test('run rejects --skip when it has no value', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['install', '--skip'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stderr.text, /missing value for --skip/);
  assert.match(fake.stderr.text, /lemonpi --help/);
  assert.equal(fake.stderr.text.trimEnd().split('\n').length, 1);
  assert.equal(fake.stdout.text, '');
});

test('run rejects extra positional arguments', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['install', 'extra'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stderr.text, /unexpected argument 'extra'.*lemonpi --help/);
  assert.equal(fake.stderr.text.trimEnd().split('\n').length, 1);
  assert.equal(fake.stdout.text, '');
});

test('help takes priority over command and option errors anywhere in argv', async (t) => {
  for (const args of [['status', '--help'], ['--bogus', '--help']]) {
    const fake = createFakeHost(t);

    const code = await run(args, fake.host);

    assert.equal(code, 0);
    assert.match(fake.stdout.text, /^Usage: lemonpi/);
    assert.equal(fake.stderr.text, '');
  }
});

test('run never invokes the runner for invalid usage', async (t) => {
  for (const args of [
    ['instal'],
    ['--yes'],
    ['status', '--dry-run'],
    ['install', '--skip'],
    ['install', 'extra'],
  ]) {
    const fake = createFakeHost(t);

    await run(args, fake.host);

    assert.deepEqual(fake.runnerCalls, []);
  }
});

test('Pi failure diagnostics retain useful details without leaking sensitive values', async (t) => {
  const secret = 'fixture-known-secret-value';
  const environmentSecrets = [
    'fixture-env-credential',
    'fixture-env-password',
    'fixture-env-secret',
    'fixture-env-api-key',
    'fixture-env-auth',
  ];
  const fake = createFakeHost(t, {
    env: {
      LEMON_ACCESS_TOKEN: secret,
      APP_CREDENTIAL: environmentSecrets[0],
      DATABASE_PASSWORD: environmentSecrets[1],
      APP_SECRET: environmentSecrets[2],
      SERVICE_API_KEY: environmentSecrets[3],
      AUTH_HEADER: environmentSecrets[4],
    },
    runnerResults: [{
      code: 13,
      signal: null,
      stdout: 'stdout diagnostic is available',
      stderr: [
        'harmless stderr diagnostic',
        `environment values: ${environmentSecrets.join(' ')}`,
        `request for ivan@example.test org_123456 failed; token=${secret}`,
        'Authorization: Bearer ghp_fixtureTokenValue123456789',
        'Authorization: Basic fixture-basic-credential',
        'opaque forms: github_pat_fixtureOpaqueToken0123456789 sk-live_fixtureSecretValue123456 xoxb-fixtureOpaqueToken987654 eyJabcdefghijk.eyJabcdefghijk.signaturevalue123',
        'credentials: {"apiKey":"fixture-api-key","password":"fixture-password"}',
        'organizationId=org-987654',
        'private key -----BEGIN PRIVATE KEY----- fixture-private-key',
        'unstructured token output fixture-unstructured-token',
        'url https://fixture-user:fixture-password@example.test/path',
      ].join('\n'),
    }],
  });
  let partCalls = 0;

  const code = await run(['install'], fake.host, {
    parts: [{ name: 'must not run', commands: ['install'], run: async () => { partCalls += 1; return []; } }],
  });

  assert.equal(code, 2);
  assert.equal(partCalls, 0);
  assert.match(fake.stdout.text, /pi --version failed with exit 13/i);
  assert.match(fake.stdout.text, /harmless stderr diagnostic/);
  assert.match(fake.stdout.text, /\[diagnostic withheld\]/);
  for (const sensitive of [secret, ...environmentSecrets, 'ivan@example.test', 'org_123456', 'org-987654', 'ghp_fixtureTokenValue123456789', 'fixture-basic-credential', 'github_pat_fixtureOpaqueToken0123456789', 'sk-live_fixtureSecretValue123456', 'xoxb-fixtureOpaqueToken987654', 'eyJabcdefghijk.eyJabcdefghijk.signaturevalue123', 'fixture-api-key', 'fixture-password', 'fixture-user', 'fixture-unstructured-token']) {
    assert.ok(!fake.stdout.text.includes(sensitive), `summary must not disclose ${sensitive}`);
    assert.ok(!fake.stderr.text.includes(sensitive), `stderr must not disclose ${sensitive}`);
  }
});

test('unparseable Pi output reports the command without echoing arbitrary payloads', async (t) => {
  const payload = 'not-a-semver ivan@example.test organization_id=org_9bf2 and api_key=fixture-api-key';
  const fake = createFakeHost(t, {
    runnerResults: [{
      code: 0,
      signal: null,
      stdout: payload,
      stderr: 'stderr must also be treated as untrusted: password=fixture-password',
    }],
  });
  let partCalls = 0;

  const code = await run(['install'], fake.host, {
    parts: [{ name: 'must not run', commands: ['install'], run: async () => { partCalls += 1; return []; } }],
  });

  assert.equal(code, 2);
  assert.equal(partCalls, 0);
  assert.doesNotMatch(fake.stdout.text, /not-a-semver|ivan@example\.test|org_9bf2|fixture-api-key/);
  assert.match(fake.stdout.text, /pi --version.*unparseable/i);
  assert.doesNotMatch(fake.stderr.text, /fixture-password/);
});

test('run reports a real non-ENOENT spawn error with its command and code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lemonpi-prerequisite-'));
  const executable = join(directory, 'not-executable');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(executable, 'non-executable fixture');
  await chmod(executable, 0o600);
  const spawnFailure = await runner(executable, []);
  const fake = createFakeHost(t);
  fake.host.runner = async () => spawnFailure;
  let partCalls = 0;

  const code = await run(['install'], fake.host, {
    parts: [{ name: 'must not run', commands: ['install'], run: async () => { partCalls += 1; return []; } }],
  });

  assert.equal(code, 2);
  assert.equal(partCalls, 0);
  assert.match(fake.stdout.text, /pi --version/);
  assert.match(fake.stdout.text, /Error/);
  assert.match(fake.stdout.text, /EACCES/);
});

test('run preserves both prerequisite streams and sanitizes runner errors', async (t) => {
  const knownSecret = 'runner-known-secret-value';
  const fake = createFakeHost(t, {
    env: { PRIVATE_API_TOKEN: knownSecret },
    runnerResults: [{
      code: null,
      signal: null,
      stdout: 'stdout diagnostic retained',
      stderr: 'stderr diagnostic retained; credential=fixture-credential-value',
      error: `Error (EACCES): token=${knownSecret}; user=ivan@example.test org_987654`,
    }],
  });
  let partCalls = 0;

  const code = await run(['install'], fake.host, {
    parts: [{ name: 'must not run', commands: ['install'], run: async () => { partCalls += 1; return []; } }],
  });

  assert.equal(code, 2);
  assert.equal(partCalls, 0);
  assert.match(fake.stdout.text, /pi --version/);
  assert.match(fake.stdout.text, /error: Error \(EACCES\)/i);
  assert.match(fake.stdout.text, /stdout: stdout diagnostic retained/);
  assert.match(fake.stdout.text, /stderr: stderr diagnostic retained/);
  for (const sensitive of [knownSecret, 'fixture-credential-value', 'ivan@example.test', 'org_987654']) {
    assert.ok(!fake.stdout.text.includes(sensitive), `summary must not disclose ${sensitive}`);
    assert.ok(!fake.stderr.text.includes(sensitive), `stderr must not disclose ${sensitive}`);
  }
});

test('run rejects empty or repeated Pi build-metadata identifiers', async (t) => {
  for (const stdout of ['1.4.0+.', '1.4.0+foo..bar']) {
    const fake = createFakeHost(t, { runnerResults: [{ ...passingPi, stdout }] });

    const code = await run(['install'], fake.host);

    assert.equal(code, 2, `${stdout} must be rejected as unparseable`);
    assert.match(fake.stdout.text, /unparseable/i);
    assert.deepEqual(fake.runnerCalls.map(({ command, args }) => [command, args]), [['pi', ['--version']]]);
  }
});

test('run refuses Node build metadata with empty identifiers', async (t) => {
  const fake = createFakeHost(t, { nodeVersion: '22.19.0+foo..bar', runnerResults: [passingPi] });

  const code = await run(['install'], fake.host);

  assert.equal(code, 2);
  assert.match(fake.stderr.text, /Node 22\.19\.0\+foo\.\.bar is not supported/);
  assert.deepEqual(fake.runnerCalls, []);
});

test('run prints help for --help and -h without invoking the runner', async (t) => {
  const outputs = [];

  for (const argument of ['--help', '-h']) {
    const fake = createFakeHost(t);
    const code = await run([argument], fake.host);
    assert.equal(code, 0);
    assert.deepEqual(fake.runnerCalls, []);
    outputs.push(fake.stdout.text);
  }

  for (const command of ['install', 'update', 'status', 'doctor', 'skills']) {
    assert.ok(outputs[0].includes(command), `help should list ${command}`);
  }
  for (const flag of ['--help', '-h', '--version', '--dry-run', '--skip <id,…>', '--skip-skills']) {
    assert.ok(outputs[0].includes(flag), `help should list ${flag}`);
  }
  assert.match(outputs[0], /--dry-run[^\n]*install, update, skills/);
  assert.match(outputs[0], /--skip <id,…>[^\n]*install, update, status, doctor/);
  assert.match(outputs[0], /--skip-skills[^\n]*install, update, doctor/);
  assert.match(outputs[0], /0\s+ok/);
  assert.match(outputs[0], /1\s+partial result or drift/);
  assert.match(outputs[0], /2\s+failed/);
  assert.match(outputs[0], /130[^\n]*SIGINT/);
  assert.match(outputs[0], /143[^\n]*SIGTERM/);
  assert.equal(outputs[1], outputs[0]);
});
