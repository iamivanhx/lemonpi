import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('.gitignore covers generated files and keeps the example env file', async () => {
  const contents = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  const entries = contents.split(/\r?\n/);

  for (const entry of [
    'node_modules/',
    '*.log',
    '.DS_Store',
    '.env',
    '.env.*',
    '!.env.example',
    'coverage/',
    '.tmp/',
  ]) {
    assert.ok(entries.includes(entry), `.gitignore should include ${entry}`);
  }
});
