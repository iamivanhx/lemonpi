import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Unknown covers readiness and inventory that depends on unreadable Pi settings', async () => {
  const glossary = await readFile(new URL('../GLOSSARY.md', import.meta.url), 'utf8');
  const definition = glossary.match(/\*\*Unknown\*\*:\n([^\n]+)/)?.[1] ?? '';

  assert.match(definition, /readiness/i);
  assert.match(definition, /inventory/i);
  assert.match(definition, /unreadable Pi settings/i);
});
