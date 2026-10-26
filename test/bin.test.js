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

test('bin refuses Node 20.9.0 before loading unsupported CLI syntax', {
  skip: !process.env.LEMONPI_TEST_OLD_NODE && 'set LEMONPI_TEST_OLD_NODE to a Node 20.9.0 executable',
}, () => {
  const result = spawnSync(process.env.LEMONPI_TEST_OLD_NODE, [bin, 'install'], { encoding: 'utf8' });

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Node 20\.9\.0 is not supported; lemonpi requires Node 22\.19\.0 or newer\n$/);
});

for (const [interruptSignal, expectedCode, descendant] of [
  ['SIGINT', 130, false],
  ['SIGTERM', 143, true],
]) {
test(`bin handles ${interruptSignal}${descendant ? ' with inherited descendant pipes' : ''} and renders the interrupted summary`, { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lemonpi-bin-interruption-'));
  const fakePi = join(directory, 'pi');
  const readyMarker = join(directory, 'pi-ready');
  const probe = join(directory, 'probe.cjs');
  const descendantCode = `
    process.on('SIGTERM', () => {});
    require('node:fs').writeFileSync(process.env.LEMONPI_READY_MARKER, String(process.ppid));
    setInterval(() => {}, 1000);
  `;
  await writeFile(probe, descendant
    ? `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantCode)}], { stdio: 'inherit' });`
    : 'require("node:fs").writeFileSync(process.env.LEMONPI_READY_MARKER, String(process.pid)); setInterval(() => {}, 1000)');
  await writeFile(fakePi, `#!/bin/sh\nexec "$LEMONPI_TEST_NODE" "${probe}"\n`);
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

  let probePid;
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        probePid = Number(await readFile(readyMarker, 'utf8'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (Date.now() >= deadline) throw new Error('fake Pi did not reach its readiness marker');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    child.kill(interruptSignal);
    let deadlineTimer;
    const result = await Promise.race([
      exited,
      new Promise((resolve) => { deadlineTimer = setTimeout(() => resolve(null), 2000); }),
    ]);
    clearTimeout(deadlineTimer);
    assert.ok(result, 'bin must exit promptly even when descendants inherit its pipes');
    const { code, signal } = result;
    assert.equal(code, expectedCode, `bin exit was code=${code}, signal=${signal}; stderr=${stderr}`);
    assert.match(stdout, /interrupted/i);
  } finally {
    for (const pid of [probePid, child.pid].filter(Boolean)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        // Cleanup races with normal process exit; only an absent group is harmless.
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});
}
