import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const bin = fileURLToPath(new URL('../bin/lemonpi.js', import.meta.url));

test('real bin prints version and help without Pi', () => {
  const version = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `${manifest.version}\n`);

  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: lemonpi/);
  assert.match(help.stdout, /Exit codes:/);
});

test('bin handles SIGINT with a fake Pi and renders the interrupted summary', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lemonpi-bin-interruption-'));
  const fakePi = join(directory, 'pi');
  const readyMarker = join(directory, 'pi-ready');
  await writeFile(fakePi, '#!/bin/sh\nexec "$LEMONPI_TEST_NODE" -e \'require("node:fs").writeFileSync(process.env.LEMONPI_READY_MARKER, "ready"); setInterval(() => {}, 1000)\'\n');
  await chmod(fakePi, 0o755);
  t.after(() => rm(directory, { recursive: true, force: true }));

  const child = spawn(process.execPath, [bin, 'install'], {
    detached: true,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      LEMONPI_READY_MARKER: readyMarker,
      LEMONPI_TEST_NODE: process.execPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  try {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await readFile(readyMarker, 'utf8');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (Date.now() >= deadline) throw new Error('fake Pi did not reach its readiness marker');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    child.kill('SIGINT');
    const { code, signal } = await exited;
    assert.equal(code, 130, `bin exit was code=${code}, signal=${signal}; stderr=${stderr}`);
    assert.match(stdout, /interrupted/i);
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
});
