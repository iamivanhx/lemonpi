import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packages = [
  ['subagents', 'npm:@tintinweb/pi-subagents', 'Required'],
  ['review', 'git:github.com/earendil-works/pi-review', 'Required'],
  ['todo', 'npm:@juicesharp/rpiv-todo', 'Required'],
  ['claude-code', 'git:github.com/earendil-works/pi-claude-code', 'Required'],
  ['ask-user', 'npm:@juicesharp/rpiv-ask-user-question', 'Optional'],
  ['web-access', 'npm:pi-web-access', 'Optional'],
  ['footer', 'npm:pi-footer', 'Optional'],
  ['pretty', 'npm:@heyhuynhgiabuu/pi-pretty', 'Optional'],
];

async function readPackagesSection() {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const start = readme.indexOf('## Packages');
  assert.notEqual(start, -1, 'README has a Packages section');
  const end = readme.indexOf('\n## ', start + '## Packages'.length);
  return { readme, section: readme.slice(start, end === -1 ? undefined : end) };
}

test('README documents the built package scope without claiming later areas are built', async () => {
  const { readme } = await readPackagesSection();

  assert.match(readme, /Current scope — Areas 1–2/);
  assert.match(readme, /Owned config(?:uration)?[\s\S]*Private skills[\s\S]*Readiness[\s\S]*not implemented/i);
  assert.doesNotMatch(readme, /Current scope — Area 1:/);
});

test('README Packages section lists the catalog and its reconciliation promises', async () => {
  const { section } = await readPackagesSection();

  assert.doesNotMatch(section, /Placeholder — Area 2/i);
  for (const [id, source, requiredness] of packages) {
    assert.ok(
      section.includes(`| \`${id}\` | \`${source}\` | ${requiredness} |`),
      `catalog table lists ${id}, ${source}, and ${requiredness.toLowerCase()}`,
    );
  }

  for (const promise of [
    '**Managed package**',
    '**Unmanaged package**',
    '**Replaced package**',
    '**Drift**',
    '**Notice**',
    '**Skipped**',
    'installs missing Managed packages',
    'unpins pinned declarations',
    'npm:pi-subagents',
    'installs the replacement if needed, verifies its declaration',
    'already-present unpinned Managed packages are left alone',
    'one package at a time',
    '`--skip <id,…>`',
    'unknown ID is a usage error and exits 2',
    'failed Required package fails the run (exit 2)',
    'failed Optional package makes it partial (exit 1)',
    'usage error',
    'never a failure',
    'missing',
    'pinned',
    'duplicated',
    'migration',
    'project settings',
    'global Pi settings',
    'lemonpi never tests package releases',
    'never downgrades to an older release',
    'pi remove',
    '`claude` CLI',
    'never installs the `claude` CLI or Claude Code',
    'no provider configuration or credentials',
    'already-declared replacement',
    'does not transfer',
  ]) {
    assert.ok(section.includes(promise), `Packages section covers ${promise}`);
  }
});
