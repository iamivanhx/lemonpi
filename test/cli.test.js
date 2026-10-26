import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createFakeHost } from './helpers/fake-host.js';
import { run } from '../src/cli.js';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('run prints the package version without invoking the runner', async (t) => {
  const fake = createFakeHost(t);

  const code = await run(['--version'], fake.host);

  assert.equal(code, 0);
  assert.equal(fake.stdout.text, `${manifest.version}\n`);
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
