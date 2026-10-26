import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata matches the locked Node CLI foundation', () => {
  assert.deepEqual(
    {
      name: manifest.name,
      private: manifest.private,
      type: manifest.type,
      bin: manifest.bin,
      node: manifest.engines?.node,
      test: manifest.scripts?.test,
      dependencies: manifest.dependencies,
    },
    {
      name: 'lemonpi',
      private: true,
      type: 'module',
      bin: { lemonpi: 'bin/lemonpi.js' },
      node: '>=22.19.0',
      test: 'node --test',
      dependencies: undefined,
    },
  );
});
